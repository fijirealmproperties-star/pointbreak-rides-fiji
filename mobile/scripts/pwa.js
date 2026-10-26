#!/usr/bin/env node
/* Post-process the Expo web export:
 *   1. copy mobile/public/ (manifest, service worker, icons, /download page)
 *   2. inject the manifest + install metadata into index.html
 * Runs automatically via `npm run export`.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, process.argv[2] || "dist");
const publicDir = path.join(root, "public");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const TAGS = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#0A1628" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Pointbreak" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
    <script>
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
          navigator.serviceWorker.register("/sw.js").catch(function () {});
        });
      }
    </script>`;

const indexFile = path.join(dist, "index.html");
if (!fs.existsSync(indexFile)) {
  console.error("pwa: " + indexFile + " not found — run `expo export` first.");
  process.exit(1);
}

copyDir(publicDir, dist);

let html = fs.readFileSync(indexFile, "utf8");
if (!html.includes('rel="manifest"')) {
  html = html.replace("</head>", TAGS + "\n  </head>");
  fs.writeFileSync(indexFile, html);
}

// Stamp the service-worker cache name with a hash of this build's HTML (which
// references the hashed JS/CSS names). A new deploy therefore gets a new cache
// and the activate handler deletes the previous one.
const build = require("crypto").createHash("sha1").update(html).digest("hex").slice(0, 10);
const swFile = path.join(dist, "sw.js");
if (fs.existsSync(swFile)) {
  const sw = fs.readFileSync(swFile, "utf8").replace(/const VERSION = "[^"]*";/, `const VERSION = "pb-${build}";`);
  fs.writeFileSync(swFile, sw);
}

console.log("pwa: manifest, service worker and /download page added to " + path.relative(root, dist) + " (cache pb-" + build + ")");
