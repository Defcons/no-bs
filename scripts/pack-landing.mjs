// Package the NoBS landing page (artifact body HTML) into a standalone site:
// a full HTML document with head/meta/OG + favicon + OG image.
// Usage: node scripts/pack-landing.mjs [srcHtml] [outDir]
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import sharp from "sharp";

// Repo-relative defaults; override via CLI args. Drop the landing artifact's
// body HTML at assets/nobs-landing.html (or pass a path) to (re)generate.
const SRC = process.argv[2] ?? "assets/nobs-landing.html";
const OUT = process.argv[3] ?? "landing-dist";
mkdirSync(OUT, { recursive: true });

const body = readFileSync(SRC, "utf8");
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>NoBS – Workout Log</title>
<meta name="description" content="A no-BS gym app — only the stuff you use at the rack: sets, reps, kg, a rest timer, heart rate. Local-first, no account, no subscription.">
<meta name="theme-color" content="#0b0e13">
<link rel="icon" type="image/png" href="/icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="NoBS – Workout Log">
<meta property="og:description" content="No ads. No subs. No BS. Only the stuff you actually use at the gym.">
<meta property="og:image" content="https://nobs.agentas.net/og.png">
<meta property="og:url" content="https://nobs.agentas.net">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
`;
writeFileSync(`${OUT}/index.html`, head + body + "\n</body>\n</html>\n");

await sharp("assets/icon.png").resize(192, 192).png().toFile(`${OUT}/icon.png`);
await sharp({ create: { width: 1200, height: 630, channels: 4, background: { r: 11, g: 14, b: 19, alpha: 1 } } })
  .composite([{ input: await sharp("assets/icon.png").resize(340, 340).png().toBuffer(), gravity: "center" }])
  .png()
  .toFile(`${OUT}/og.png`);

console.log("packed →", OUT);
