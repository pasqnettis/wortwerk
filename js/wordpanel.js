// Clickable German text + the side panel that opens when you click a word.
import { esc, icon, aiButton, busy, toast } from "./ui.js";
import { tokenize, lemmasFor, keyFor, entry, status, ARTICLE, POS_DE, headword, saveUserWord } from "./data.js";
import { S, changed } from "./store.js";
import { addCard, removeCard } from "./srs.js";
import { speak } from "./speech.js";
import * as ai from "./ai.js";

/** Render a German sentence as clickable word spans. */
export function wordsHTML(sentence) {
  let initial = true;
  return tokenize(sentence).map((t) => {
    if (!t.word) {
      if (/[.!?:;„“"–]/.test(t.s)) initial = true;
      return esc(t.s);
    }
    const ini = initial;
    initial = false;
    const k = keyFor(t.s, ini);
    return `<span class="w ${status(k)}" data-w="${esc(t.s)}" data-k="${esc(k)}"${ini ? ' data-ini="1"' : ""}>${esc(t.s)}</span>`;
  }).join("");
}

/** Refresh highlight classes inside a container after the learner's word states change. */
export function refreshWords(root) {
  root.querySelectorAll(".w").forEach((el) => {
    el.dataset.k = keyFor(el.dataset.w, !!el.dataset.ini); // may change when a word is added to the personal dictionary
    const st = status(el.dataset.k);
    el.classList.remove("new", "learning", "known");
    el.classList.add(st);
  });
}

/**
 * Wire up click-to-lookup on a container. getContext(el) must return
 * { sentence, translation? } for the clicked word element.
 */
export function attachWordClicks(root, getContext) {
  root.addEventListener("click", (e) => {
    const el = e.target.closest(".w");
    if (!el || !root.contains(el)) return;
    root.querySelectorAll(".w.sel").forEach((x) => x.classList.remove("sel"));
    el.classList.add("sel");
    openWord(el.dataset.w, { ...getContext(el), initial: !!el.dataset.ini }, () => refreshWords(document));
  });
}

// ------------------------------------------------------------ panel
const panel = () => document.getElementById("word-panel");
let onUpdate = null;

export function closeWord() {
  panel().classList.remove("open");
  panel().setAttribute("aria-hidden", "true");
  document.querySelectorAll(".w.sel").forEach((x) => x.classList.remove("sel"));
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWord(); });

function lemmaHTML(lemma) {
  return entry(lemma).map((e) => {
    const art = e.p === "noun" && e.g ? `<span class="art ${e.g}">${ARTICLE[e.g]}</span> ` : "";
    let extra = "";
    if (e.p === "noun" && e.pl) extra += `<div class="wp-forms">Plural: <b class="serif">die ${esc(e.pl)}</b></div>`;
    if (e.p === "verb") {
      if (e.pres) {
        const P = ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];
        extra += `<div class="conj">${[0, 3, 1, 4, 2, 5].map((i) => `<span class="p">${P[i]}</span><span class="f">${esc(e.pres[i])}</span>`).join("")}</div>`;
      }
      const bits = [];
      if (e.past) bits.push(`Präteritum: <b class="serif">${esc(e.past)}</b>`);
      if (e.pp) bits.push(`Perfekt: <b class="serif">${esc((e.aux || "hat").split("/")[0] === "sein" ? "ist" : "hat")} ${esc(e.pp)}</b>`);
      if (bits.length) extra += `<div class="wp-forms">${bits.join(" · ")}</div>`;
    }
    return `<div class="lemma">
      <div class="lemma-top"><span class="lemma-word">${art}${esc(lemma)}</span><span class="pos">${esc(POS_DE[e.p] || e.p)}</span>${e.ai ? `<span class="chip ai" title="Saved from an AI explanation">${icon("sparkle")} my dictionary</span>` : ""}</div>
      <ul class="glosses">${e.gl.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>${extra}
    </div>`;
  }).join("");
}

export function openWord(word, ctx = {}, update) {
  onUpdate = update;
  const lemmas = lemmasFor(word, ctx.initial ?? true);
  const key = keyFor(word, ctx.initial ?? true);
  const p = panel();
  const sentence = ctx.sentence || "";
  const markSentence = sentence ? esc(sentence).replace(new RegExp(`(^|[^\\wäöüßÄÖÜ])(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^\\wäöüßÄÖÜ])`), "$1<mark>$2</mark>") : "";

  p.innerHTML = `
    <button class="btn ghost icon wp-close" aria-label="Close">${icon("x")}</button>
    <div class="wp-head">
      <div class="surface">${esc(word)} <button class="btn ghost icon" data-act="say" title="Listen">${icon("volume")}</button></div>
      ${lemmas.length && lemmas[0] !== word ? `<div class="subtle" style="margin-top:4px">Dictionary form: <b>${esc(headword(lemmas[0]))}</b></div>` : ""}
    </div>
    <div class="wp-body">
      <div>
        <div class="subtle" style="margin-bottom:8px;font-weight:600">Word status</div>
        <div class="status-seg">
          <button data-st="new"><i style="background:var(--blue-soft)"></i>New</button>
          <button data-st="learning"><i style="background:var(--gold-soft);box-shadow:inset 0 -2px var(--gold)"></i>Learning</button>
          <button data-st="known"><i style="border:1px solid var(--line)"></i>Known</button>
        </div>
      </div>
      ${lemmas.length ? lemmas.slice(0, 3).map(lemmaHTML).join("") : `<div class="notice">This word isn't in the offline dictionary (maybe a name or a rare compound).${ai.hasKey() ? " Ask the AI below: its answer is saved to your dictionary, so next time it works offline." : ""}</div>`}
      ${markSentence ? `<div><div class="subtle" style="margin-bottom:6px;font-weight:600">In context</div><div class="ctx">${markSentence}</div></div>` : ""}
      <div class="ai-area">
        ${ai.hasKey()
          ? aiButton("Explain in this sentence", 'data-act="explain"')
          : `<a class="notice" href="#/settings" style="display:block;text-decoration:none">${icon("sparkle")} Set up an AI provider in Settings to get explanations in context.</a>`}
      </div>
      <div class="subtle">Dictionary: Wiktionary (CC BY-SA) via kaikki.org</div>
    </div>`;

  const setSeg = () => {
    const st = status(key);
    p.querySelectorAll("[data-st]").forEach((b) => b.classList.toggle("on", b.dataset.st === st));
  };
  setSeg();

  p.querySelector(".wp-close").onclick = closeWord;
  p.querySelector('[data-act="say"]').onclick = () => speak(lemmas.length ? lemmas[0] : word);
  p.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => {
    const st = b.dataset.st;
    if (st === "known") { S.known[key] = 1; if (S.cards[key]) removeCard(key); }
    if (st === "new") { delete S.known[key]; if (S.cards[key]) removeCard(key); }
    if (st === "learning") {
      addCard(key, { ex: sentence, exEn: ctx.translation || "", en: p.dataset.aiMeaning || undefined });
      toast(`„${headword(key)}“ added to flashcards`);
    }
    changed();
    setSeg();
    onUpdate?.();
  }));

  const ex = p.querySelector('[data-act="explain"]');
  if (ex) ex.onclick = async () => {
    busy(ex, true, "Thinking…");
    try {
      const r = await ai.explainWord(word, sentence || word);
      // a word the offline dictionary doesn't know: keep the AI's answer for next time
      const saved = !lemmas.length && r.pos !== "name" ? saveUserWord(word, r, key) : null;
      const box = `<div class="ai-box">
        <div class="lbl">${icon("sparkle")} ${esc(ai.aiName())}</div>
        <div><b class="serif" style="font-size:17px">${esc(r.lemma)}</b> — ${esc(r.meaning)}</div>
        <div>${esc(r.explanation)}</div>
        <div class="ex">${esc(r.example_de)}<div class="subtle">${esc(r.example_en)}</div></div>
        ${saved ? `<div class="subtle">${icon("check")} Saved „${esc(headword(saved))}“ to your dictionary. It now works offline everywhere.</div>` : ""}
      </div>`;
      if (saved) {
        openWord(word, ctx, update); // re-render with the new dictionary entry and status key
        update?.();
        panel().querySelector(".ai-area").innerHTML = box;
        return;
      }
      p.dataset.aiMeaning = r.meaning;
      if (S.cards[key] && !S.cards[key].en) { S.cards[key].en = r.meaning; changed(); }
      ex.parentElement.innerHTML = box;
    } catch (err) {
      busy(ex, false);
      toast(err.message, "err");
    }
  };

  p.classList.add("open");
  p.setAttribute("aria-hidden", "false");
}
