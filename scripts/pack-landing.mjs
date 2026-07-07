// Package the NoBS landing page (artifact body) into a standalone site under
// codecrafts-sites/nobs/ — full HTML document with head/meta/OG + favicon + OG image.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import sharp from "sharp";

const SRC = "REDACTED_LOCAL_PATH";
const OUT = "C:/Dev/codecrafts-sites/nobs";
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
<meta property="og:image" content="https://nobs.codecrafts.cc/og.png">
<meta property="og:url" content="https://nobs.codecrafts.cc">
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
