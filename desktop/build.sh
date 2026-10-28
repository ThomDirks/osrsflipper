#!/usr/bin/env bash
# Baut "OSRS GE Flipper.exe" (Windows x64). Benötigt: Node/npm, Go >= 1.22, llvm-rc + llvm-cvtres, zip.
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_VERSION="${NODE_VERSION:-22.23.4}"
OUT="$(pwd)/desktop/build"; rm -rf "$OUT"; mkdir -p "$OUT/payload/app"

npm ci --no-audit --no-fund
NEXT_TELEMETRY_DISABLED=1 npx next build
cp -r .next/standalone/. "$OUT/payload/app/"
cp -r .next/static "$OUT/payload/app/.next/static"
# Bildoptimierung ist aus; plattformspezifische sharp-Binaries werden nicht gebraucht
rm -rf "$OUT/payload/app/node_modules/"{@img,sharp,detect-libc,@emnapi}

# Offizielle node.exe (OpenJS-signiert) aus dem npm-Paket node-win-x64
(cd "$OUT" && npm pack "node-win-x64@$NODE_VERSION" --silent && tar xzf node-win-x64-*.tgz && cp package/bin/node.exe payload/node.exe)

(cd "$OUT/payload" && zip -q -9 -r ../payload.zip node.exe app)
cp desktop/{main.go,go.mod,app.rc,icon.ico} "$OUT/"
cd "$OUT"
llvm-rc -fo app.res app.rc && llvm-cvtres -machine:x64 -out:rsrc_windows_amd64.syso app.res
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w" -o "../OSRS GE Flipper.exe" .
echo "Fertig: desktop/OSRS GE Flipper.exe"
