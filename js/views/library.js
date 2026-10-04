import { S, changed } from "../store.js";
import { allTexts, coverage } from "../data.js";
import { esc, icon, levelChip, modal, aiButton, busy, toast } from "../ui.js";
import * as ai from "../ai.js";
import { readingTabs, renderNews } from "./news.js";

const SOURCES = [
  { id: "all", label: "All" },
  { id: "generated", label: "Course texts" },
  { id: "ai", label: "My AI texts" },
  { id: "miniklexikon", label: "MiniKlexikon" },
];
const ui = { level: "all", source: "all", q: "" };

export function render(root, tab) {
  if (tab === "news") return renderNews(root);
  root.innerHTML = `<div class="page">
    ${readingTabs("library")}
    <div class="page-head">
      <div><div class="eyebrow">Lesen</div><h1>Library</h1><p>Blue words are new to you, yellow ones you're learning. Aim for texts where you know about 90% of the words.</p></div>
      ${aiButton("Generate a new text", 'id="gen"', "primary")}
    </div>
    <div class="toolbar">
      <div class="seg" id="lv">${["all", "A1", "A2", "B1"].map((l) => `<button data-v="${l}" class="${ui.level === l ? "on" : ""}">${l === "all" ? "All levels" : l}</button>`).join("")}</div>
      <div class="seg" id="src">${SOURCES.map((s) => `<button data-v="${s.id}" class="${ui.source === s.id ? "on" : ""}">${s.label}</button>`).join("")}</div>
      <div class="search"><input class="input" id="q" placeholder="Search titles…" value="${esc(ui.q)}">${icon("search")}</div>
    </div>
    <div id="list"></div>
  </div>`;

  const list = root.querySelector("#list");
  const draw = () => {
    const q = ui.q.toLowerCase();
    const items = allTexts()
      .filter((t) => ui.level === "all" || t.level === ui.level)
      .filter((t) => ui.source === "all" || t.source === ui.source)
      .filter((t) => !q || (t.title + " " + (t.title_en || "") + " " + (t.topic || "")).toLowerCase().includes(q));
    const groups = [
      ["My AI texts", items.filter((t) => t.source === "ai")],
      ["Course texts", items.filter((t) => t.source === "generated")],
      ["MiniKlexikon: real German children's encyclopedia", items.filter((t) => t.source === "miniklexikon")],
    ].filter(([, g]) => g.length);
    list.innerHTML = groups.map(([title, g]) => `
      <div class="section-title"><h2>${esc(title)}</h2><span class="subtle">${g.length}</span></div>
      <div class="lib-grid">${g.map(card).join("")}</div>`).join("") || `<div class="empty"><div class="big">🔍</div>No texts match.</div>`;
  };
  draw();

  root.querySelector("#lv").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.level = b.dataset.v; render(root); };
  root.querySelector("#src").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.source = b.dataset.v; render(root); };
  root.querySelector("#q").oninput = (e) => { ui.q = e.target.value; draw(); };
  root.querySelector("#gen").onclick = () => generateModal();
}

function card(t) {
  const c = Math.round(coverage(t) * 100);
  const kind = t.kind === "dialogue" ? `<span class="chip">Dialog</span>` : "";
  const src = t.source === "ai" ? `<span class="chip ai">${icon("sparkle")} AI</span>` : "";
  return `<a class="card text-card ${S.read[t.id] ? "done" : ""}" href="#/read/${esc(t.id)}">
    <div class="meta">${levelChip(t.level)}${kind}${src}<span class="chip">${t.words || "?"} words</span>${S.read[t.id] ? `<span class="chip" style="margin-left:auto">${icon("check")} read</span>` : ""}</div>
    <div class="t">${esc(t.title)}</div>
    ${t.title_en ? `<div class="te">${esc(t.title_en)}</div>` : ""}
    <div class="cov"><div class="progress green"><span style="width:${c}%"></span></div>${c}% known</div>
  </a>`;
}

const TOPICS = ["Ein Tag im Büro", "Im Supermarkt", "Urlaub am Meer", "Mein Lieblingsessen", "Ein Missgeschick in der Bahn", "Fußball am Wochenende", "Eine neue Nachbarin", "Ein Ausflug nach Hamburg"];

export function generateModal() {
  if (!ai.hasKey()) { location.hash = "#/settings"; toast("Set up an AI provider in Settings first"); return; }
  const learning = Object.keys(S.cards);
  modal(`
    <div><span class="chip ai">${icon("sparkle")} Uses your AI API key</span><h2 style="margin-top:10px">Generate a new text</h2>
    <p class="muted" style="margin-top:6px">The AI writes a text at your level, with a translation, questions and vocabulary.</p></div>
    <label class="field">Topic <input class="input" id="g-topic" placeholder="e.g. Ein Wochenende in Wien"></label>
    <div class="row">${TOPICS.map((t) => `<button class="chip" style="border:0;cursor:pointer" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>
    <div class="row between">
      <label class="field">Level <div class="seg" id="g-lv">${["A1", "A2", "B1"].map((l) => `<button data-v="${l}" class="${l === S.level ? "on" : ""}">${l}</button>`).join("")}</div></label>
      <label class="field">Type <div class="seg" id="g-kind"><button data-v="text" class="on">Story</button><button data-v="dialogue">Dialogue</button></div></label>
      <label class="field">Length <div class="seg" id="g-len"><button data-v="short">Short</button><button data-v="medium" class="on">Medium</button><button data-v="long">Long</button></div></label>
    </div>
    <label class="toggle"><input type="checkbox" id="g-words" ${learning.length ? "checked" : "disabled"}> Include words I'm learning (${learning.length})</label>
    <button class="btn primary lg" id="g-go">${icon("sparkle")} Write my text</button>
  `, {
    onMount(m, close) {
      const segVal = (id) => m.querySelector(`#${id} .on`).dataset.v;
      m.querySelectorAll(".seg").forEach((seg) => (seg.onclick = (e) => {
        const b = e.target.closest("button"); if (!b) return;
        e.preventDefault();
        seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      }));
      m.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => (m.querySelector("#g-topic").value = b.dataset.t)));
      m.querySelector("#g-go").onclick = async (e) => {
        const btn = e.currentTarget;
        const topic = m.querySelector("#g-topic").value.trim() || TOPICS[Math.floor(Math.random() * TOPICS.length)];
        const targetWords = m.querySelector("#g-words").checked ? learning.sort(() => Math.random() - 0.5).slice(0, 12) : [];
        busy(btn, true, " Writing… (20–60 s)");
        try {
          const t = await ai.generateText({ level: segVal("g-lv"), kind: segVal("g-kind"), length: segVal("g-len"), topic, targetWords });
          t.words = t.paragraphs.flat().reduce((n, s) => n + s.de.split(/\s+/).length, 0);
          S.myTexts.unshift(t);
          changed();
          close();
          location.hash = `#/read/${t.id}`;
        } catch (err) {
          busy(btn, false);
          toast(err.message, "err");
        }
      };
    },
  });
}
