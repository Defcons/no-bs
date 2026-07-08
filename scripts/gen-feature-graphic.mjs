// Generates the Play Store feature graphic (1024x500) → assets/feature-graphic.png
// from the app icon + brand palette. Run: node scripts/gen-feature-graphic.mjs
import sharp from "sharp";
import { readFileSync } from "fs";

const W = 1024;
const H = 500;
const icon = readFileSync("public/icon-512.png").toString("base64");

const svg = `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#141a24"/>
      <stop offset="1" stop-color="#05070a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.26" cy="0.5" r="0.55">
      <stop offset="0" stop-color="#4f8cff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#4f8cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <image href="data:image/png;base64,${icon}" x="96" y="140" width="220" height="220"/>
  <text x="384" y="226" font-family="Arial, Helvetica, sans-serif" font-size="92" font-weight="800" fill="#eaf0f7">NoBS</text>
  <text x="388" y="284" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="600" fill="#c9d3df">Workout Log</text>
  <text x="388" y="344" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700" fill="#4ade80" letter-spacing="0.5">No ads. No subs. No BS.</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile("assets/feature-graphic.png");
const meta = await sharp("assets/feature-graphic.png").metadata();
console.log(`feature graphic → assets/feature-graphic.png (${meta.width}x${meta.height})`);
