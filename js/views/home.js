import { S, streak, dayTotal, fmt, changed } from "../store.js";
import { allTexts, coverage, D } from "../data.js";
import { dueCards } from "../srs.js";
import { esc, icon, levelChip, modal } from "../ui.js";
import { hasKey } from "../ai.js";
import { PROVIDERS, providerById } from "../llm/providers.js";
import { nextChapter } from "./grammar.js";

const LEVELS_ORDER = ["A1", "A2", "B1"];

export function recommendations(n = 3) {
  const lvIdx = LEVELS_ORDER.indexOf(S.level);
  const pool = allTexts().filter((t) => !S.read[t.id] && LEVELS_ORDER.indexOf(t.level) <= lvIdx + 1);
  return pool
    .map((t) => ({ t, c: coverage(t) }))
    // sweet spot: you know ~90-98% of the words; prefer course texts at your level
    .sort((a, b) => score(b) - score(a))
    .slice(0, n);
  function score({ t, c }) {
    let s = -Math.abs(c - 0.93) * 10;
    if (t.level === S.level) s += 1.5;
    if (t.source !== "miniklexikon") s += 1;
    return s;
  }
}

export function render(root) {
  const due = dueCards().length;
  const hour = new Date().getHours();
  const greet = hour < 11 ? "Guten Morgen!" : hour < 18 ? "Guten Tag!" : "Guten Abend!";
  const date = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const recos = recommendations(3);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push({ label: d.toLocaleDateString("de-DE", { weekday: "short" }).slice(0, 2), v: dayTotal(fmt(d)) });
  }
  const max = Math.max(5, ...days.map((d) => d.v));

  root.innerHTML = `<div class="page">
    <div class="page-head">
      <div><div class="eyebrow">${esc(date)}</div><h1>${greet}</h1><p>A little reading, listening and speaking every day beats one long session a week.</p></div>
    </div>

    <div class="stats">
      <div class="card stat"><div class="label">${icon("brain")}Known words</div><div class="num">${Object.keys(S.known).length.toLocaleString("de-DE")}</div></div>
      <div class="card stat"><div class="label">${icon("cards")}Due today</div><div class="num">${due}</div></div>
      <div class="card stat"><div class="label">${icon("flame")}Day streak</div><div class="num">${streak()}</div></div>
      <div class="card stat"><div class="label">${icon("book")}Texts read</div><div class="num">${Object.keys(S.read).length}</div></div>
    </div>

    <div class="hero">
      <div class="card">
        <div class="row between"><h2>Recommended reading</h2><a class="btn sm ghost" href="#/library">Library ${icon("arrowRight")}</a></div>
        <p class="subtle" style="margin-top:4px">Picked so that you already know most of the words.</p>
        <div class="reco" style="margin-top:10px">
          ${recos.map(({ t, c }) => `
            <a class="reco-item" href="#/read/${esc(t.id)}">
              <div style="flex:1;min-width:0">
                <div class="title">${esc(t.title)}</div>
                <div class="subtle">${esc(t.title_en || t.topic || "")}</div>
              </div>
              ${levelChip(t.level)}
              <div style="width:84px;white-space:nowrap"><div class="progress green"><span style="width:${Math.round(c * 100)}%"></span></div><div class="subtle" style="text-align:right;margin-top:3px">${Math.round(c * 100)}% known</div></div>
            </a>`).join("") || `<div class="empty">You've read everything. Generate a new text in the Library!</div>`}
        </div>
      </div>
      <div class="card">
        <h2>This week</h2>
        <p class="subtle" style="margin-top:4px">Exercises completed per day</p>
        <div class="week">${days.map((d) => `<div class="bar ${d.v ? "" : "zero"}"><span style="height:${Math.max(4, (d.v / max) * 100)}%" title="${d.v}"></span><small>${d.label}</small></div>`).join("")}</div>
      </div>
    </div>

    <div class="skills">
      ${tile("#/library", "book", "Lesen", "Read graded texts. Click any word for meaning, grammar and flashcards.", "var(--blue-soft)", "var(--blue)")}
      ${grammarTile()}
      ${tile("#/listen", "headphones", "Hören", `Dictation with ${D.sentences.filter((s) => s.a).length.toLocaleString("de-DE")} sentences recorded by native speakers.`, "var(--green-soft)", "var(--green)")}
      ${tile("#/speak", "mic", "Sprechen", "Shadow native audio, then let speech recognition check what you said.", "var(--accent-soft)", "var(--accent)")}
      ${tile("#/write", "pen", "Schreiben", "Build sentences, translate, and write short texts that the AI corrects line by line.", "var(--blue-soft)", "var(--blue)")}
      ${tile("#/library/news", "book", "Nachrichten", "Three of today's news stories (Italy, Germany, Europe, AI) rewritten in easy German.", "var(--accent-soft)", "var(--accent)", true)}
      ${tile("#/chat", "chat", "Gespräch", "Role-play real situations with an AI partner. It corrects your mistakes as you go.", "var(--gold-soft)", "color-mix(in srgb, var(--gold) 70%, var(--ink))", true)}
      ${tile("#/review", "cards", "Wortschatz", due ? `${due} card${due === 1 ? "" : "s"} due. Spaced repetition keeps words in long-term memory.` : "Spaced-repetition flashcards for the words you're learning.", "var(--surface-2)", "var(--ink)")}
    </div>
  </div>`;
}

function grammarTile() {
  if (!D.grammar.length) return "";
  const next = nextChapter();
  const text = next
    ? `Next: Kapitel ${next.num}, ${esc(next.title)}. Short explanations, examples and exercises.`
    : "All A1 chapters completed. Revisit any chapter to practise.";
  return tile(next ? `#/grammar/${next.id}` : "#/grammar", "grammar", "Grammatik", text, "var(--green-soft)", "var(--green)");
}

function tile(href, ic, title, text, bg, fg, isAI = false) {
  return `<a class="card skill" href="${href}">
    ${isAI ? `<span class="chip ai ai-tag">${icon("sparkle")} AI</span>` : ""}
    <div class="ico" style="background:${bg};color:${fg}">${icon(ic)}</div>
    <h3 class="serif" style="font-size:20px">${title}</h3>
    <p>${text}</p>
  </a>`;
}

// ------------------------------------------------------------ onboarding
const LEVEL_SEEDS = [
  { id: "a0", level: "A1", seed: 0, t: "Complete beginner", d: "I know almost nothing yet" },
  { id: "a1a", level: "A1", seed: 150, t: "Early A1", d: "Greetings, numbers, a few hundred words" },
  { id: "a1b", level: "A1", seed: 350, t: "Mid A1", d: "Simple sentences about myself and daily life" },
  { id: "a2", level: "A2", seed: 900, t: "A2", d: "Everyday conversations, the Perfekt tense" },
  { id: "b1", level: "B1", seed: 1800, t: "B1", d: "I can follow most everyday texts" },
];

export function onboarding(done) {
  let pick = "a1b";
  modal(`
    <div>
      <div class="brand-mark" style="margin-bottom:14px">W</div>
      <h2>Willkommen bei Wortwerk!</h2>
      <p class="muted" style="margin-top:6px">How much German do you already know? The app will mark the most common words as known so texts are highlighted sensibly. You can change any word later.</p>
    </div>
    <div class="level-pick">${LEVEL_SEEDS.map((l) => `<button data-id="${l.id}" class="${l.id === pick ? "on" : ""}"><div style="flex:1"><b>${l.t}</b><span>${l.d}</span></div><span class="chip ${l.level}">${l.level}</span></button>`).join("")}</div>
    <div class="field">AI provider & API key <span class="hint">Optional. Turns on conversation practice, explanations, corrections, daily news and new texts. Any provider works; you can change it later in Settings.</span>
      <div class="row" style="flex-wrap:nowrap"><select class="input select" id="ob-prov" style="max-width:46%">${PROVIDERS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
      <input class="input" type="password" id="ob-key" placeholder="API key" autocomplete="off"></div></div>
    <button class="btn primary lg" id="ob-go">Los geht's ${icon("arrowRight")}</button>
  `, {
    dismissable: false,
    onMount(m, close) {
      m.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => {
        pick = b.dataset.id;
        m.querySelectorAll("[data-id]").forEach((x) => x.classList.toggle("on", x === b));
      }));
      m.querySelector("#ob-go").onclick = () => {
        const l = LEVEL_SEEDS.find((x) => x.id === pick);
        S.level = l.level;
        D.dict.order.slice(0, l.seed).forEach((w) => (S.known[w] = 1));
        const key = m.querySelector("#ob-key").value.trim();
        const prov = m.querySelector("#ob-prov").value;
        if (key || providerById(prov).noKey) {
          S.settings.provider = prov;
          if (key) S.settings.keys = { ...S.settings.keys, [prov]: key };
        }
        S.onboarded = true;
        changed();
        close();
        done();
      };
    },
  });
}

export { hasKey };
