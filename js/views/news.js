// "Nachrichten": three news stories a day, rewritten by the AI as A1–A2 reading texts.
import { S, changed, today } from "../store.js";
import { coverage } from "../data.js";
import { esc, icon, levelChip, toast } from "../ui.js";
import * as ai from "../ai.js";

const KEEP_DAYS = 30;
const REGION = {
  Italien: { flag: "🇮🇹", en: "Italy" },
  Deutschland: { flag: "🇩🇪", en: "Germany" },
  Europa: { flag: "🇪🇺", en: "Europe" },
  KI: { flag: "🤖", en: "Artificial intelligence" },
};

// One generation at a time, even if the learner navigates away and back.
const job = { promise: null, key: null, step: 0, error: null };

/** The two tabs at the top of the reading section. */
export function readingTabs(active) {
  const hasToday = !!S.news[today()];
  return `<div class="read-tabs">
    <a href="#/library" class="${active === "library" ? "on" : ""}">${icon("book")}<span>Bibliothek<small>Library</small></span></a>
    <a href="#/library/news" class="${active === "news" ? "on" : ""}"><span class="news-ico">📰</span><span>Nachrichten<small>Today's news in easy German</small></span>
      ${!hasToday && ai.hasKey() ? `<span class="badge">neu</span>` : ""}</a>
  </div>`;
}

const dateLabel = (key, opts = { weekday: "long", day: "numeric", month: "long" }) =>
  new Date(key + "T12:00:00").toLocaleDateString("de-DE", opts);

export function renderNews(root) {
  const key = today();
  const day = S.news[key];
  const archive = Object.keys(S.news).filter((k) => k !== key).sort().reverse();

  root.innerHTML = `<div class="page">
    ${readingTabs("news")}
    <div class="page-head">
      <div><div class="eyebrow">Nachrichten · ${esc(dateLabel(key))}</div><h1>Die Nachrichten des Tages</h1>
      <p>Every day the AI picks three important stories (Italy, Germany, Europe and AI) and rewrites them in easy German (A1–A2). They open in the normal reader with all its tools.</p></div>
      ${day ? `<button class="btn sm ghost" id="again">${icon("replay")} Get other stories</button>` : ""}
    </div>
    <div id="today"></div>
    ${archive.length ? `<div class="section-title"><h2>Archiv</h2><span class="subtle">last ${KEEP_DAYS} days</span></div>
      <div class="stack" style="gap:10px">${archive.map((k) => `
        <div class="card news-day"><div class="subtle" style="font-weight:600;margin-bottom:6px">${esc(dateLabel(k))}</div>
          ${S.news[k].texts.map((t) => `<a class="news-line" href="#/read/${esc(t.id)}"><span>${REGION[t.topic]?.flag || "📰"}</span><span class="serif">${esc(t.title)}</span>${levelChip(t.level)}${S.read[t.id] ? icon("check") : ""}</a>`).join("")}
        </div>`).join("")}</div>` : ""}
  </div>`;

  const box = root.querySelector("#today");
  if (!ai.hasKey()) {
    box.innerHTML = `<div class="card empty"><div class="big">📰</div><h2>Daily news needs an AI provider</h2>
      <p class="muted" style="margin:8px auto 18px;max-width:460px">The AI finds the day's most relevant news (with its own web search, or from Wikipedia's daily news page) and writes three easy German texts about it, with translations, questions and key words.</p>
      <a class="btn primary" href="#/settings">${icon("key")} Add API key</a></div>`;
  } else if (day) {
    box.innerHTML = `<div class="news-grid">${day.texts.map(card).join("")}</div>`;
  } else {
    if (!job.promise && !(job.error && job.key === key)) start(root, key);
    drawProgress(box, root, key);
  }

  const again = root.querySelector("#again");
  if (again) again.onclick = () => {
    if (!confirm("Replace today's three texts with different stories? This uses your API key again.")) return;
    delete S.news[key];
    changed();
    start(root, key, true);
    renderNews(root);
  };
}

function card(t) {
  const r = REGION[t.topic] || { flag: "📰", en: t.topic };
  const c = Math.round(coverage(t) * 100);
  return `<a class="card news-card ${S.read[t.id] ? "done" : ""}" href="#/read/${esc(t.id)}">
    <div class="news-region"><span class="flag">${r.flag}</span>${esc(t.topic)}<span class="subtle">· ${esc(r.en)}</span></div>
    <div class="t">${esc(t.title)}</div>
    <div class="te">${esc(t.title_en)}</div>
    <p class="news-lead">${esc(t.paragraphs[0]?.[0]?.de || "")}</p>
    <div class="meta">${levelChip(t.level)}<span class="chip">${t.words} words</span>${S.read[t.id] ? `<span class="chip">${icon("check")} read</span>` : ""}</div>
    <div class="cov"><div class="progress green"><span style="width:${c}%"></span></div>${c}% known</div>
  </a>`;
}

function drawProgress(box, root, key) {
  if (job.error && job.key === key && !job.promise) {
    box.innerHTML = `<div class="card stack" style="align-items:flex-start">
      <h2>Couldn't get today's news</h2><p class="muted">${esc(job.error)}</p>
      <button class="btn primary" id="retry">${icon("replay")} Try again</button></div>`;
    box.querySelector("#retry").onclick = () => { start(root, key, true); renderNews(root); };
    return;
  }
  const step = (n, label) => `<div class="news-step ${job.step > n ? "done" : job.step === n ? "now" : ""}">
    <span class="dot">${job.step > n ? icon("check") : job.step === n ? '<span class="spinner"></span>' : n}</span>${label}</div>`;
  box.innerHTML = `<div class="card stack news-progress">
    <h2>Preparing today's news…</h2>
    ${step(1, "Finding today's most relevant news (Italy, Germany, Europe, AI)")}
    ${step(2, "Writing three easy German texts with translations and questions")}
    <p class="subtle">This takes about one to two minutes and happens once a day. It uses your AI API key; the cost depends on the model (roughly 20–40 cents with Claude Opus 5.5, a few cents with small models). You can keep using the app meanwhile.</p>
  </div>`;
}

function start(root, key, force = false) {
  if (job.promise && !force) return;
  job.key = key;
  job.step = 1;
  job.error = null;
  const p = ai.dailyNews({
    dateKey: key,
    dateLabel: dateLabel(key, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    level: S.level,
    onStep: (n) => {
      job.step = n;
      if (location.hash.startsWith("#/library/news")) drawProgress(root.querySelector("#today"), root, key);
    },
  });
  job.promise = p;
  p.then((texts) => {
    if (job.promise !== p) return;
    S.news[key] = { at: new Date().toISOString(), texts };
    for (const k of Object.keys(S.news).sort().slice(0, -KEEP_DAYS)) delete S.news[k];
    changed();
    toast("Today's news is ready 📰");
  }).catch((err) => {
    if (job.promise !== p) return;
    job.error = err.message;
  }).finally(() => {
    if (job.promise !== p) return;
    job.promise = null;
    if (location.hash.startsWith("#/library/news")) renderNews(root);
  });
}
