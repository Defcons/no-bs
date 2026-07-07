// Regenerate all app icons from assets/icon.png:
//  - Android legacy (full-bleed) + adaptive foreground (padded to the safe zone so
//    the wide dumbbell doesn't clip on round/squircle launcher masks)
//  - PWA icons (any + maskable) + favicon
import sharp from "sharp";

const RAW = "assets/icon.png";
const DARK = { r: 11, g: 14, b: 19, alpha: 1 }; // #0b0e13
const base = "android/app/src/main/res";

const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const fg = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

// Center `src` (already a Buffer) at `scale` of a transparent/dark `size` canvas.
async function padded(size, scale, bg) {
  const inner = Math.round(size * scale);
  const scaled = await sharp(RAW).resize(inner, inner).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: scaled, gravity: "center" }])
    .png()
    .toBuffer();
}

for (const [d, sz] of Object.entries(legacy)) {
  const buf = await sharp(RAW).resize(sz, sz).png().toBuffer();
  await sharp(buf).toFile(`${base}/mipmap-${d}/ic_launcher.png`);
  await sharp(buf).toFile(`${base}/mipmap-${d}/ic_launcher_round.png`);
}
for (const [d, sz] of Object.entries(fg)) {
  const buf = await padded(sz, 0.7, { r: 0, g: 0, b: 0, alpha: 0 });
  await sharp(buf).toFile(`${base}/mipmap-${d}/ic_launcher_foreground.png`);
}

await sharp(RAW).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(RAW).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(await padded(512, 0.72, DARK)).toFile("public/icon-maskable-512.png");
await sharp(RAW).resize(48, 48).png().toFile("public/favicon.png");
await sharp(RAW).resize(160, 160).png().toFile("assets/icon-160.png"); // for the landing page data URI

console.log("icons generated");
