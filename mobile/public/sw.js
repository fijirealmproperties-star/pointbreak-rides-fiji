/* Pointbreak Rides Fiji — service worker.
 * Makes the web app installable and keeps the shell available offline.
 * Never caches API or socket traffic.
 */
const VERSION = "pb-v1";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/admin")) return false;
  if (url.pathname.startsWith("/socket.io/")) return false;
  return (
    url.pathname.startsWith("/_expo/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:js|css|png|jpg|jpeg|svg|woff2?|ttf|ico)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // App navigation: always try the network first so deploys are picked up,
  // fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error()))
    );
    return;
  }

  if (!isCacheable(url)) return;

  // Static build output: cache-first, refreshed in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || network;
    })
  );
});
