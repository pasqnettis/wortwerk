// ------------------------------------------------------------ installable app (PWA)
// The service worker only exists in the built site (pipeline/build_site.py), not in local
// development, so code changes never get stuck in a cache while you work on the app.
export const install = { prompt: null };

/** True when running as an installed app (home-screen icon, no browser bar). */
export const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); install.prompt = e; });
window.addEventListener("appinstalled", () => { install.prompt = null; });
const isLocalDev = /^(localhost|127\.0\.0\.1|.*\.localhost)$/.test(location.hostname) && !new URLSearchParams(location.search).has("sw");
if ("serviceWorker" in navigator && !isLocalDev) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker not registered:", e));
}
