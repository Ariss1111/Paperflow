// Generates the Pagelyt identity from one geometry: the mark, horizontal logos (light/dark),
// the app icon, favicons and PWA icons. Run: node scripts/make-brand.mjs
import fs from "node:fs";
import sharp from "sharp";

const BLUE = "#3478F6";
const BLUE_DEEP = "#1F5FD9";
const INK = "#1D1D1F";

// The mark on a 32-unit grid: a P whose bowl is a page with its top-right corner folded over.
// Stem and bowl are one shape; the counter (the hole of the P) is cut out with evenodd.
const P_SHAPE =
  "M10.6 6.5H19.3L24.5 11.7V14.6A5.9 5.9 0 0 1 18.6 20.5H14.3V24.1A1.9 1.9 0 0 1 12.4 26H10.6A1.9 1.9 0 0 1 8.7 24.1V8.4A1.9 1.9 0 0 1 10.6 6.5Z" +
  "M14.3 10.6V16.4H18.2A2.1 2.1 0 0 0 20.3 14.3V12.7A2.1 2.1 0 0 0 18.2 10.6Z";
// the folded-over flap
const FOLD = "M19.3 6.5V10.2A1.5 1.5 0 0 0 20.8 11.7H24.5Z";

function mark({ shape, fold, size = 32 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"><path fill="${shape}" fill-rule="evenodd" d="${P_SHAPE}"/><path fill="${fold}" d="${FOLD}"/></svg>`;
}

function appIcon(size = 512) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4F8BFF"/><stop offset="1" stop-color="${BLUE_DEEP}"/></linearGradient></defs>
<rect width="32" height="32" rx="7.2" fill="url(#g)"/>
<rect width="32" height="32" rx="7.2" fill="none" stroke="#000" stroke-opacity=".08" stroke-width=".25"/>
<path fill="#fff" fill-rule="evenodd" d="${P_SHAPE}"/><path fill="#BCD3FF" d="${FOLD}"/></svg>`;
}

function horizontal({ text, shape, fold }) {
  // the wordmark uses the UI font stack; the in-app logo renders it as live text instead
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 32" width="300" height="64"><g><path fill="${shape}" fill-rule="evenodd" d="${P_SHAPE}"/><path fill="${fold}" d="${FOLD}"/></g><text x="31" y="22.4" font-family="Inter, -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif" font-size="19" font-weight="650" letter-spacing="-0.6" fill="${text}">Pagelyt</text></svg>`;
}

const out = "public/brand";
fs.mkdirSync(out, { recursive: true });
const files = {
  "pagelyt-mark.svg": mark({ shape: BLUE, fold: "#9DBFFF" }),
  "pagelyt-mark-dark.svg": mark({ shape: "#FFFFFF", fold: "#9DBFFF" }),
  "pagelyt-logo-light.svg": horizontal({ text: INK, shape: BLUE, fold: "#9DBFFF" }),
  "pagelyt-logo-dark.svg": horizontal({ text: "#F5F5F7", shape: "#5B93FF", fold: "#2D5BB8" }),
  "pagelyt-app-icon.svg": appIcon(512),
};
for (const [name, svg] of Object.entries(files)) fs.writeFileSync(`${out}/${name}`, svg);

// favicon / app icons (Next.js picks up app/icon.svg and app/apple-icon.png automatically)
fs.writeFileSync("app/icon.svg", appIcon(32));
const icon = Buffer.from(appIcon(1024));
await sharp(icon).resize(180).png().toFile("app/apple-icon.png");
await sharp(icon).resize(192).png().toFile(`${out}/icon-192.png`);
await sharp(icon).resize(512).png().toFile(`${out}/icon-512.png`);
fs.writeFileSync(
  "public/manifest.webmanifest",
  JSON.stringify(
    {
      name: "Pagelyt",
      short_name: "Pagelyt",
      description: "Every page. In its place.",
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: BLUE,
      icons: [
        { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    null,
    2,
  ),
);
// preview sheet for review
const sheet = await sharp({ create: { width: 900, height: 300, channels: 4, background: "#ffffff" } })
  .composite([
    { input: await sharp(Buffer.from(appIcon(512))).resize(200).png().toBuffer(), left: 30, top: 50 },
    { input: await sharp(Buffer.from(appIcon(512))).resize(32).png().toBuffer(), left: 250, top: 134 },
    { input: await sharp(Buffer.from(appIcon(512))).resize(16).png().toBuffer(), left: 300, top: 142 },
    { input: await sharp(Buffer.from(files["pagelyt-logo-light.svg"])).resize(420).png().toBuffer(), left: 350, top: 40 },
    {
      input: await sharp({ create: { width: 460, height: 120, channels: 4, background: "#161618" } })
        .composite([{ input: await sharp(Buffer.from(files["pagelyt-logo-dark.svg"])).resize(420).png().toBuffer(), left: 20, top: 16 }])
        .png()
        .toBuffer(),
      left: 330,
      top: 160,
    },
  ])
  .png()
  .toBuffer();
fs.writeFileSync(process.argv[2] ?? "brand-preview.png", sheet);
console.log("brand assets written");
