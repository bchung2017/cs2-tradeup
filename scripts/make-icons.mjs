// Renders the app icons in public/icons from one SVG: the "$ _" prompt in
// phosphor green on black. Run with `node scripts/make-icons.mjs` after
// changing the mark. "maskable" keeps the mark inside Android's safe zone
// (the inner 80%) so a circle or squircle crop never clips it.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const mark = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <rect x="40" y="40" width="432" height="432" rx="56" fill="#0a120a" stroke="#19a019" stroke-width="12"/>
    <text x="128" y="318" font-family="DejaVu Sans Mono, monospace" font-weight="700" font-size="200" fill="#33ff33">$</text>
    <rect x="266" y="276" width="118" height="34" fill="#33ff33"/>
  </g>
</svg>`;

mkdirSync("public/icons", { recursive: true });
const out = [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["maskable-512.png", 512, 0.78],
  ["apple-touch-icon.png", 180, 1],
];
for (const [name, size, scale] of out) {
  await sharp(Buffer.from(mark(scale))).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log(name);
}
