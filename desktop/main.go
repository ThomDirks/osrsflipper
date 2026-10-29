//go:build windows

// OSRS GE Flipper desktop launcher.
//
// Everything the app needs (a private copy of Node.js and the built web app)
// is embedded in this exe. On start it unpacks that once to
// %LOCALAPPDATA%\OSRS GE Flipper, starts the local server in the background,
// opens the browser and sits in the system tray until you choose Quit.
//
// Standard library only: the tray icon and dialogs use the Win32 API directly.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed payload.zip
var payload []byte

const (
	appName = "OSRS GE Flipper"
	// Fixed port: browser storage (trades, settings, watchlist) is tied to the
	// address, so it must stay the same between runs.
	port uint16 = 47813
)

var (
	baseURL = fmt.Sprintf("http://127.0.0.1:%d", port)
	server  *exec.Cmd
	exited  = make(chan struct{})
	logFile *os.File
)

func init() { runtime.LockOSThread() } // the Win32 message loop must stay on one thread

func main() {
	root := filepath.Join(os.Getenv("LOCALAPPDATA"), appName)
	runtimeRoot := filepath.Join(root, "runtime")

	if running, build := healthCheck(); running {
		// Same version already running: just open another browser tab.
		if build == buildID() {
			openBrowser(baseURL)
			return
		}
		// Older (or newer) version still running: stop it so this one takes over.
		if !stopOldServer(runtimeRoot) {
			fail(fmt.Sprintf("An older %s is still running and could not be stopped.\n\nRight-click the GE coin in the tray, choose Quit, then start this file again.", appName))
		}
	}
	if portTaken() {
		fail(fmt.Sprintf("Port %d is already used by another program, so %s can't start.\n\nClose that program (or restart Windows) and try again.", port, appName))
	}

	if err := os.MkdirAll(root, 0o755); err != nil {
		fail("Could not create the app folder:\n\n" + err.Error())
	}
	runtimeDir, err := unpack(root)
	if err != nil {
		fail("Could not unpack the app files:\n\n" + err.Error())
	}
	if err := startServer(root, runtimeDir); err != nil {
		fail("Could not start the app:\n\n" + err.Error())
	}
	if !waitHealthy(60 * time.Second) {
		stopServer()
		fail("The app did not start in time.\n\nDetails are in:\n" + filepath.Join(root, "server.log"))
	}
	openBrowser(baseURL)
	runTray()
	stopServer()
}

// buildID identifies this exe's app version (hash of the embedded payload).
func buildID() string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])[:12]
}

// stopOldServer ends the node.exe that listens on our port, but only if it
// runs from our own runtime folder. Its launcher then closes by itself.
func stopOldServer(runtimeRoot string) bool {
	pid := listenerPID(port)
	if pid == 0 {
		return false
	}
	const queryLimited, terminate, synchronize = 0x1000, 0x0001, 0x00100000
	h, _, _ := pOpenProcess.Call(queryLimited|terminate|synchronize, 0, uintptr(pid))
	if h == 0 {
		return false
	}
	defer pCloseHandle.Call(h)
	buf := make([]uint16, 1024)
	size := uint32(len(buf))
	if r, _, _ := pQueryFullProcessImageNameW.Call(h, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size))); r == 0 {
		return false
	}
	exe := strings.ToLower(syscall.UTF16ToString(buf[:size]))
	if !strings.HasPrefix(exe, strings.ToLower(runtimeRoot)+`\`) || !strings.HasSuffix(exe, `\node.exe`) {
		return false // not ours: never touch other programs
	}
	pTerminateProcess.Call(h, 0)
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if !portTaken() {
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}

// listenerPID returns the process listening on 127.0.0.1/0.0.0.0:port (IPv4), or 0.
func listenerPID(port uint16) uint32 {
	const afInet, tcpTableOwnerPidListener = 2, 3
	var size uint32
	pGetExtendedTcpTable.Call(0, uintptr(unsafe.Pointer(&size)), 0, afInet, tcpTableOwnerPidListener, 0)
	if size == 0 {
		return 0
	}
	buf := make([]byte, size+1024)
	size = uint32(len(buf))
	if r, _, _ := pGetExtendedTcpTable.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0, afInet, tcpTableOwnerPidListener, 0); r != 0 {
		return 0
	}
	n := *(*uint32)(unsafe.Pointer(&buf[0]))
	// MIB_TCPROW_OWNER_PID: state, localAddr, localPort, remoteAddr, remotePort, owningPid (6 × uint32)
	for i := uint32(0); i < n; i++ {
		off := 4 + i*24
		if int(off+24) > len(buf) {
			break
		}
		row := (*[6]uint32)(unsafe.Pointer(&buf[off]))
		p := row[2]
		if uint16((p&0xff)<<8|(p>>8)&0xff) == port {
			return row[5]
		}
	}
	return 0
}

// ---------------------------------------------------------------------------
// Unpacking and server

// unpack extracts the embedded payload into a folder named after its hash,
// so a new version lands in a fresh folder and old ones get cleaned up.
func unpack(root string) (string, error) {
	ver := buildID()
	dir := filepath.Join(root, "runtime", ver)
	done := filepath.Join(dir, ".complete")
	if _, err := os.Stat(done); err == nil {
		return dir, nil
	}
	_ = os.RemoveAll(dir)
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return "", err
	}
	for _, f := range zr.File {
		dst := filepath.Join(dir, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(dst, dir+string(os.PathSeparator)) {
			continue
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return "", err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return "", err
		}
		if err := extract(f, dst); err != nil {
			return "", err
		}
	}
	if err := os.WriteFile(done, []byte(ver), 0o644); err != nil {
		return "", err
	}
	if entries, err := os.ReadDir(filepath.Join(root, "runtime")); err == nil {
		for _, e := range entries {
			if e.Name() != ver {
				_ = os.RemoveAll(filepath.Join(root, "runtime", e.Name()))
			}
		}
	}
	return dir, nil
}

func extract(f *zip.File, dst string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

const createNoWindow = 0x08000000

func startServer(root, dir string) error {
	var err error
	logFile, err = os.Create(filepath.Join(root, "server.log"))
	if err != nil {
		return err
	}
	server = exec.Command(filepath.Join(dir, "node.exe"), "server.js")
	server.Dir = filepath.Join(dir, "app")
	server.Stdout = logFile
	server.Stderr = logFile
	server.Env = append(os.Environ(),
		"NODE_ENV=production",
		"NEXT_TELEMETRY_DISABLED=1",
		"HOSTNAME=127.0.0.1",
		fmt.Sprintf("PORT=%d", port),
		"APP_BUILD="+buildID(),
	)
	server.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if err := server.Start(); err != nil {
		return err
	}
	tieToLauncher(server.Process.Pid)
	go func() {
		_ = server.Wait()
		close(exited)
	}()
	return nil
}

func stopServer() {
	if server != nil && server.Process != nil {
		_ = server.Process.Kill()
	}
	if logFile != nil {
		_ = logFile.Close()
	}
}

func healthCheck() (bool, string) {
	c := http.Client{Timeout: 1500 * time.Millisecond}
	res, err := c.Get(baseURL + "/api/health")
	if err != nil {
		return false, ""
	}
	defer res.Body.Close()
	var body struct {
		OK    bool   `json:"ok"`
		Build string `json:"build"`
	}
	if res.StatusCode != 200 || json.NewDecoder(res.Body).Decode(&body) != nil || !body.OK {
		return false, ""
	}
	return true, body.Build
}

func healthy() bool {
	ok, _ := healthCheck()
	return ok
}

func waitHealthy(limit time.Duration) bool {
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		select {
		case <-exited:
			return false
		default:
		}
		if healthy() {
			return true
		}
		time.Sleep(300 * time.Millisecond)
	}
	return false
}

func portTaken() bool {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return true
	}
	l.Close()
	return false
}

// ---------------------------------------------------------------------------
// Win32

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	pRegisterClassExW           = user32.NewProc("RegisterClassExW")
	pCreateWindowExW            = user32.NewProc("CreateWindowExW")
	pDefWindowProcW             = user32.NewProc("DefWindowProcW")
	pDestroyWindow              = user32.NewProc("DestroyWindow")
	pGetMessageW                = user32.NewProc("GetMessageW")
	pTranslateMessage           = user32.NewProc("TranslateMessage")
	pDispatchMessageW           = user32.NewProc("DispatchMessageW")
	pPostQuitMessage            = user32.NewProc("PostQuitMessage")
	pPostMessageW               = user32.NewProc("PostMessageW")
	pCreatePopupMenu            = user32.NewProc("CreatePopupMenu")
	pAppendMenuW                = user32.NewProc("AppendMenuW")
	pDestroyMenu                = user32.NewProc("DestroyMenu")
	pTrackPopupMenu             = user32.NewProc("TrackPopupMenu")
	pSetForegroundWindow        = user32.NewProc("SetForegroundWindow")
	pGetCursorPos               = user32.NewProc("GetCursorPos")
	pMessageBoxW                = user32.NewProc("MessageBoxW")
	pLoadImageW                 = user32.NewProc("LoadImageW")
	pGetSystemMetrics           = user32.NewProc("GetSystemMetrics")
	pRegisterWindowMessageW     = user32.NewProc("RegisterWindowMessageW")
	pShellNotifyIconW           = shell32.NewProc("Shell_NotifyIconW")
	pShellExecuteW              = shell32.NewProc("ShellExecuteW")
	pGetModuleHandleW           = kernel32.NewProc("GetModuleHandleW")
	pCreateJobObjectW           = kernel32.NewProc("CreateJobObjectW")
	pSetInformationJobObject    = kernel32.NewProc("SetInformationJobObject")
	pAssignProcessToJobObject   = kernel32.NewProc("AssignProcessToJobObject")
	pOpenProcess                = kernel32.NewProc("OpenProcess")
	pCloseHandle                = kernel32.NewProc("CloseHandle")
	pTerminateProcess           = kernel32.NewProc("TerminateProcess")
	pQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
	pGetExtendedTcpTable        = syscall.NewLazyDLL("iphlpapi.dll").NewProc("GetExtendedTcpTable")
)

const (
	wmDestroy      = 0x0002
	wmClose        = 0x0010
	wmNull         = 0x0000
	wmLButtonUp    = 0x0202
	wmRButtonUp    = 0x0205
	wmTray         = 0x8000 + 1 // WM_APP + 1
	nimAdd         = 0
	nimModify      = 1
	nimDelete      = 2
	nifMessage     = 0x1
	nifIcon        = 0x2
	nifTip         = 0x4
	nifInfo        = 0x10
	niifUser       = 0x4
	mfString       = 0x0
	mfSeparator    = 0x800
	tpmRightBtn    = 0x2
	tpmReturnCmd   = 0x100
	imageIcon      = 1
	smCxSmIcon     = 49
	smCySmIcon     = 50
	smCxIcon       = 11
	smCyIcon       = 12
	mbIconError    = 0x10
	mbOK           = 0x0
	swShowNormal   = 1
	cmdOpen        = 1
	cmdQuit        = 2
	jobExtLimits   = 9
	jobKillOnClose = 0x2000
)

type wndClassEx struct {
	size       uint32
	style      uint32
	wndProc    uintptr
	clsExtra   int32
	wndExtra   int32
	instance   uintptr
	icon       uintptr
	cursor     uintptr
	background uintptr
	menuName   *uint16
	className  *uint16
	iconSm     uintptr
}

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	ptX     int32
	ptY     int32
	private uint32
}

type notifyIconData struct {
	size            uint32
	hwnd            uintptr
	id              uint32
	flags           uint32
	callbackMessage uint32
	icon            uintptr
	tip             [128]uint16
	state           uint32
	stateMask       uint32
	info            [256]uint16
	version         uint32
	infoTitle       [64]uint16
	infoFlags       uint32
	guid            [16]byte
	balloonIcon     uintptr
}

type point struct{ x, y int32 }

func u16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func copyU16(dst []uint16, s string) {
	src, _ := syscall.UTF16FromString(s)
	if len(src) > len(dst) {
		src = src[:len(dst)-1]
		src = append(src, 0)
	}
	copy(dst, src)
}

var (
	trayHwnd       uintptr
	trayData       notifyIconData
	taskbarCreated uintptr
)

func runTray() {
	inst, _, _ := pGetModuleHandleW.Call(0)
	taskbarCreated, _, _ = pRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(u16("TaskbarCreated"))))

	cls := u16("OSRSGEFlipperTray")
	wc := wndClassEx{wndProc: syscall.NewCallback(wndProc), instance: inst, className: cls}
	wc.size = uint32(unsafe.Sizeof(wc))
	pRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	trayHwnd, _, _ = pCreateWindowExW.Call(0, uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(u16(appName))), 0, 0, 0, 0, 0, 0, 0, inst, 0)

	cx, _, _ := pGetSystemMetrics.Call(smCxSmIcon)
	cy, _, _ := pGetSystemMetrics.Call(smCySmIcon)
	icon, _, _ := pLoadImageW.Call(inst, 1, imageIcon, cx, cy, 0) // icon resource #1 in the exe
	bx, _, _ := pGetSystemMetrics.Call(smCxIcon)
	by, _, _ := pGetSystemMetrics.Call(smCyIcon)
	bigIcon, _, _ := pLoadImageW.Call(inst, 1, imageIcon, bx, by, 0)

	trayData = notifyIconData{hwnd: trayHwnd, id: 1, flags: nifMessage | nifIcon | nifTip, callbackMessage: wmTray, icon: icon}
	trayData.size = uint32(unsafe.Sizeof(trayData))
	copyU16(trayData.tip[:], appName+" is running")
	pShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&trayData)))

	// One-time hint so people know where the app went.
	balloon := trayData
	balloon.flags = nifInfo
	balloon.infoFlags = niifUser
	balloon.balloonIcon = bigIcon
	copyU16(balloon.infoTitle[:], appName+" is running")
	copyU16(balloon.info[:], "It lives here in the tray. Click the coin to open it, right-click to quit.")
	pShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&balloon)))

	// Close the tray if the server stops on its own.
	go func() {
		<-exited
		pPostMessageW.Call(trayHwnd, wmClose, 0, 0)
	}()

	var m msg
	for {
		r, _, _ := pGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		pDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func wndProc(hwnd, message, wParam, lParam uintptr) uintptr {
	switch {
	case message == wmTray:
		switch lParam & 0xffff {
		case wmLButtonUp:
			openBrowser(baseURL)
		case wmRButtonUp:
			showMenu(hwnd)
		}
		return 0
	case taskbarCreated != 0 && message == taskbarCreated: // Explorer restarted: re-add icon
		pShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&trayData)))
		return 0
	case message == wmClose:
		pDestroyWindow.Call(hwnd)
		return 0
	case message == wmDestroy:
		pShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&trayData)))
		pPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProcW.Call(hwnd, message, wParam, lParam)
	return r
}

func showMenu(hwnd uintptr) {
	menu, _, _ := pCreatePopupMenu.Call()
	pAppendMenuW.Call(menu, mfString, cmdOpen, uintptr(unsafe.Pointer(u16("Open "+appName))))
	pAppendMenuW.Call(menu, mfSeparator, 0, 0)
	pAppendMenuW.Call(menu, mfString, cmdQuit, uintptr(unsafe.Pointer(u16("Quit"))))
	var pt point
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	pSetForegroundWindow.Call(hwnd)
	cmd, _, _ := pTrackPopupMenu.Call(menu, tpmRightBtn|tpmReturnCmd, uintptr(pt.x), uintptr(pt.y), 0, hwnd, 0)
	pPostMessageW.Call(hwnd, wmNull, 0, 0)
	pDestroyMenu.Call(menu)
	switch cmd {
	case cmdOpen:
		openBrowser(baseURL)
	case cmdQuit:
		pDestroyWindow.Call(hwnd)
	}
}

// tieToLauncher puts the server in a job object so Windows stops it
// automatically however the launcher ends (even via Task Manager).
func tieToLauncher(pid int) {
	job, _, _ := pCreateJobObjectW.Call(0, 0)
	if job == 0 {
		return
	}
	// JOBOBJECT_EXTENDED_LIMIT_INFORMATION (amd64 layout)
	var info struct {
		perProcessUserTimeLimit int64
		perJobUserTimeLimit     int64
		limitFlags              uint32
		minWorkingSet           uintptr
		maxWorkingSet           uintptr
		activeProcessLimit      uint32
		affinity                uintptr
		priorityClass           uint32
		schedulingClass         uint32
		io                      [6]uint64
		processMemoryLimit      uintptr
		jobMemoryLimit          uintptr
		peakProcessMemoryUsed   uintptr
		peakJobMemoryUsed       uintptr
	}
	info.limitFlags = jobKillOnClose
	if r, _, _ := pSetInformationJobObject.Call(job, jobExtLimits, uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info)); r == 0 {
		return
	}
	const processSetQuota, processTerminate = 0x0100, 0x0001
	h, _, _ := pOpenProcess.Call(processSetQuota|processTerminate, 0, uintptr(pid))
	if h == 0 {
		return
	}
	pAssignProcessToJobObject.Call(job, h)
	pCloseHandle.Call(h)
	// the job handle stays open for the launcher's lifetime on purpose
}

func openBrowser(url string) {
	pShellExecuteW.Call(0, uintptr(unsafe.Pointer(u16("open"))), uintptr(unsafe.Pointer(u16(url))), 0, 0, swShowNormal)
}

func fail(text string) {
	pMessageBoxW.Call(0, uintptr(unsafe.Pointer(u16(text))), uintptr(unsafe.Pointer(u16(appName))), mbOK|mbIconError)
	os.Exit(1)
}
