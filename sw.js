// Wortwerk service worker (generated from pwa/sw.template.js by pipeline/build_site.py).
// - App code (HTML/JS/CSS): network first, so updates arrive as soon as you're online;
//   the cached copy is used offline.
// - Data (data/*.json, icons, vendor): served from the cache, refreshed in the background.
// - Google Fonts: cached when first used, so the app looks the same offline.
// - AI APIs, Wikipedia, Tatoeba audio and everything else: never cached; always go to the network.
//   (Audio uses range requests, which don't mix well with cached responses; offline, the app
//   falls back to the built-in text-to-speech voice.)

const VERSION = "20261004-152014";
const CACHE = `wortwerk-${VERSION}`;
const RUNTIME = "wortwerk-runtime";
const PRECACHE = [
  "./",
  "./css/style.css",
  "./data/dict.json",
  "./data/grammar.json",
  "./data/sentences.json",
  "./data/texts.json",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./js/ai.js",
  "./js/app.js",
  "./js/data.js",
  "./js/diff.js",
  "./js/llm/client.js",
  "./js/llm/providers.js",
  "./js/news-source.js",
  "./js/pwa.js",
  "./js/speech.js",
  "./js/srs.js",
  "./js/store.js",
  "./js/ui.js",
  "./js/views/chat.js",
  "./js/views/grammar.js",
  "./js/views/home.js",
  "./js/views/library.js",
  "./js/views/listen.js",
  "./js/views/news.js",
  "./js/views/practice-common.js",
  "./js/views/reader.js",
  "./js/views/review.js",
  "./js/views/settings.js",
  "./js/views/speak.js",
  "./js/views/write.js",
  "./js/wordpanel.js",
  "./manifest.webmanifest",
  "./vendor/anthropic-sdk.mjs",
  "./vendor/node-async_hooks.mjs",
  "./vendor/node-buffer.mjs",
  "./vendor/node-events.mjs",
  "./vendor/node-process.mjs",
  "./vendor/node-tty.mjs",
  "./vendor/ts-fsrs.mjs"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key !== RUNTIME) await caches.delete(key);
    await self.clients.claim();
  })());
});

const isAppCode = (url) => url.origin === self.location.origin && !url.pathname.includes("/vendor/") && /\.(html|js|css|webmanifest)$|\/$/.test(url.pathname);
const isLocalAsset = (url) => url.origin === self.location.origin;
const isRuntimeCacheable = (url) => /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) || (await cache.match("./index.html")) || Response.error();
  }
}

async function cacheFirstRefresh(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request).then((r) => { if (r.ok) cache.put(request, r.clone()); return r; }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

async function runtimeCache(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // AI requests are POSTs: never touched
  const url = new URL(request.url);
  if (request.mode === "navigate" || isAppCode(url)) event.respondWith(networkFirst(request));
  else if (isLocalAsset(url)) event.respondWith(cacheFirstRefresh(request));
  else if (isRuntimeCacheable(url)) event.respondWith(runtimeCache(request));
  // anything else (AI providers, Wikipedia, MiniKlexikon links…) goes straight to the network
});
