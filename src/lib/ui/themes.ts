import type { Settings } from "../storage/settings-schema";

export const THEMES: Array<{ key: Settings["theme"]; label: string; swatch: [string, string, string] }> = [
  { key: "light", label: "Light (parchment)", swatch: ["#c8b28c", "#e9e0c9", "#a55d16"] },
  { key: "dark", label: "Dark (wood)", swatch: ["#1d1712", "#2a221a", "#ffad33"] },
  { key: "grey", label: "Grey", swatch: ["#262624", "#30302e", "#d97757"] },
  { key: "grey-light", label: "Grey light", swatch: ["#f0eee6", "#faf9f5", "#c2603f"] },
];
