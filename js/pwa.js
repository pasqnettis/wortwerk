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
  // When an updated service worker takes over, reload once so the new app code is used
  // right away (not on the first install, when there was no previous worker).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
    .then((reg) => reg.update())
    .catch((e) => console.warn("Service worker not registered:", e));
}

/** Version of the published site (written by build_site.py), or null in local development. */
export async function siteVersion() {
  try {
    const r = await fetch("version.json", { cache: "no-store" });
    return r.ok ? (await r.json()).version : null;
  } catch {
    return null;
  }
}
