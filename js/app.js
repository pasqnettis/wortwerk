import { loadAll } from "./data.js";
import { S, onChange } from "./store.js";
import { icon, esc } from "./ui.js";
import { dueCards } from "./srs.js";
import { hasKey, aiLabel } from "./ai.js";
import { closeWord } from "./wordpanel.js";
import "./pwa.js";
import * as home from "./views/home.js";
import * as library from "./views/library.js";
import * as reader from "./views/reader.js";
import * as listen from "./views/listen.js";
import * as speak from "./views/speak.js";
import * as chat from "./views/chat.js";
import * as write from "./views/write.js";
import * as grammar from "./views/grammar.js";
import * as review from "./views/review.js";
import * as settings from "./views/settings.js";

const ROUTES = { home, library, read: reader, grammar, listen, speak, write, chat, review, settings };
const NAV = [
  ["home", "home", "Heute", "Home"],
  ["library", "book", "Lesen", "Reading"],
  ["grammar", "grammar", "Grammatik", "Grammar"],
  ["listen", "headphones", "Hören", "Listening"],
  ["speak", "mic", "Sprechen", "Speaking"],
  ["write", "pen", "Schreiben", "Writing"],
  ["chat", "chat", "Gespräch", "Conversation"],
  ["review", "cards", "Wortschatz", "Flashcards"],
  ["settings", "settings", "Einstellungen", "Settings"],
];

const view = document.getElementById("view");
let cleanup = null;

function drawNav(active) {
  const due = dueCards().length;
  document.getElementById("nav").innerHTML = NAV.map(([id, ic, de, en]) => `
    <a href="#/${id}" class="${active === id || (active === "read" && id === "library") ? "active" : ""}">
      ${icon(ic)}<span>${de}<span class="nav-sub">${en}</span></span>
      ${id === "review" && due ? `<span class="badge">${due}</span>` : ""}
    </a>`).join("");
  document.getElementById("sidebar-foot").innerHTML = `
    <a class="api-pill ${hasKey() ? "on" : ""}" href="#/settings" title="AI provider and model (change in Settings)"><span class="dot"></span>${hasKey() ? esc(aiLabel()) : "AI: not set up"}</a>`;
}

function route() {
  const [, name = "home", arg] = location.hash.split("/");
  const r = ROUTES[name] ? name : "home";
  cleanup?.();
  cleanup = null;
  closeWord();
  drawNav(r);
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  cleanup = ROUTES[r].render(view, arg && decodeURIComponent(arg)) || null;
}

async function boot() {
  view.innerHTML = `<div class="empty"><span class="spinner"></span><p style="margin-top:12px">Loading corpus…</p></div>`;
  try {
    await loadAll();
  } catch (e) {
    view.innerHTML = `<div class="page empty"><div class="big">⚠️</div><h2>Couldn't load the data files</h2>
      <p class="muted" style="margin-top:8px">Start the app through a local web server (see README.md), not by opening index.html directly.</p></div>`;
    return;
  }
  window.addEventListener("hashchange", route);
  let navTimer;
  onChange(() => { clearTimeout(navTimer); navTimer = setTimeout(() => drawNav((location.hash.split("/")[1]) || "home"), 200); });
  if (!S.onboarded) home.onboarding(route);
  route();
}

boot();
