import { S, changed, track, onChange } from "../store.js";
import { textById, coverage, newWordsIn, plainText, keyFor, lemmasFor, words } from "../data.js";
import { esc, icon, levelChip, aiButton, busy, toast } from "../ui.js";
import { wordsHTML, attachWordClicks, refreshWords, closeWord } from "../wordpanel.js";
import { speak, stopAll } from "../speech.js";
import { addCard } from "../srs.js";
import * as ai from "../ai.js";

const prefs = { showEn: false, hideText: false };

export function render(root, id) {
  const t = textById(id);
  if (!t) { root.innerHTML = `<div class="page empty"><div class="big">🤷</div>Text not found. <a href="#/library">Back to the library</a></div>`; return; }
  let playing = false;

  const sentHTML = (s, pi, si) => {
    const tr = s.en ? `<span class="tr ${prefs.showEn ? "" : "hidden"}">${esc(s.en)}</span>` : `<span class="tr hidden"></span>`;
    return `<span class="sent" data-p="${pi}" data-s="${si}">${wordsHTML(s.de)}<span class="sent-actions"><button data-act="say" title="Listen">${icon("volume")}</button><button data-act="tr" title="Translation">${icon("translate")}</button></span>${tr}</span>`;
  };
  const body = t.paragraphs.map((p, pi) => t.kind === "dialogue"
    ? `<div class="para dialogue">${p.map((s, si) => `<div class="turn ${esc(s.speaker || "")}"><div class="who">${esc(t.speakers?.[s.speaker] || s.speaker || "")}</div><div>${sentHTML(s, pi, si)}</div></div>`).join("")}</div>`
    : `<p class="para">${p.map((s, si) => sentHTML(s, pi, si)).join(" ")}</p>`).join("");

  const srcLine = t.source === "news"
    ? `News of ${esc(new Date(t.date).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }))}, rewritten in simple German by AI. Check the originals for details${t.sources?.length ? ": " + t.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(" · ") : "."}`
    : t.source === "miniklexikon"
    ? `Text: <a href="${esc(t.url)}" target="_blank" rel="noopener">„${esc(t.title)}“, MiniKlexikon</a>, CC BY-SA 4.0. Lightly reformatted for the reader.`
    : t.source === "ai" ? "Written for you by AI." : "Course text written by Claude (Anthropic) for this app and checked with LanguageTool.";

  root.innerHTML = `<div class="reader">
    <div class="reader-head">
      <a class="back" href="${t.source === "news" ? "#/library/news" : "#/library"}">${icon("arrowLeft")} ${t.source === "news" ? "Nachrichten" : "Library"}</a>
      <h1>${esc(t.title)}</h1>
      ${t.title_en ? `<div class="muted">${esc(t.title_en)}</div>` : ""}
      <div class="row" style="margin-top:12px">${levelChip(t.level)}<span class="chip">${esc(t.topic || "")}</span><span class="chip">${t.words || ""} words</span><span class="chip" id="cov"></span></div>
    </div>
    <div class="reader-bar">
      <button class="btn sm primary" id="play">${icon("play")} Read aloud</button>
      <button class="btn sm ${prefs.showEn ? "on" : ""}" id="en">${icon("translate")} ${prefs.showEn ? "Hide" : "Show"} translation</button>
      <button class="btn sm" id="hide" title="Listening practice: blur the text">${icon(prefs.hideText ? "eye" : "eyeOff")} ${prefs.hideText ? "Show text" : "Hide text"}</button>
      <span class="spacer"></span>
      <div class="legend"><span><i style="background:var(--blue-soft)"></i>new</span><span><i style="background:var(--gold-soft);box-shadow:inset 0 -2px var(--gold)"></i>learning</span></div>
    </div>
    <div class="text-body ${prefs.hideText ? "hide-text" : ""} ${S.settings.highlight ? "" : "no-hl"}" id="body">${body}</div>

    ${t.vocab?.length ? `<div class="reader-section card">
      <div class="row between"><h2>Key words</h2><button class="btn sm" id="add-vocab">${icon("plus")} Add all to flashcards</button></div>
      <div class="vocab-list">${t.vocab.map((v) => `<div class="vocab-item"><b>${esc(v.de)}</b><span class="muted">${esc(v.en)}</span></div>`).join("")}</div>
    </div>` : ""}

    <div class="reader-section card" id="quiz"></div>

    <div class="reader-section card finish">
      <div><h3>Finished reading?</h3><p class="muted" id="fin-text"></p></div>
      <div class="row"><button class="btn" id="fin-only">Mark as read</button><button class="btn primary" id="fin">${icon("check")} Mark blue words as known</button></div>
    </div>
    <div class="license">${srcLine}</div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const bodyEl = $("#body");
  const sentOf = (el) => { const s = el.closest(".sent"); return t.paragraphs[s.dataset.p][s.dataset.s]; };

  const updateMeta = () => {
    $("#cov").textContent = `${Math.round(coverage(t) * 100)}% known`;
    const n = newWordsIn(t).length;
    $("#fin-text").textContent = n ? `${n} word${n === 1 ? "" : "s"} still blue. If you understood them, mark them as known.` : "No new words left in this text. 🎉";
  };
  updateMeta();

  attachWordClicks(bodyEl, (el) => { const s = sentOf(el); return { sentence: s.de, translation: s.en }; });
  const unsub = onChange(updateMeta);

  // sentence buttons
  bodyEl.addEventListener("click", async (e) => {
    const b = e.target.closest(".sent-actions button");
    if (!b) return;
    e.stopPropagation();
    const sEl = b.closest(".sent");
    const s = sentOf(b);
    if (b.dataset.act === "say") { stopAll(); speak(s.de); return; }
    const tr = sEl.querySelector(".tr");
    if (tr.textContent) { tr.classList.toggle("hidden"); return; }
    if (!ai.hasKey()) { toast("No built-in translation. Set up an AI provider in Settings to translate."); return; }
    b.disabled = true; b.innerHTML = `<span class="spinner" style="width:12px;height:12px;border-width:2px"></span>`;
    try {
      s.en = await ai.translate(s.de, t.title);
      tr.textContent = s.en; tr.classList.remove("hidden");
      if (t.source === "ai" || t.source === "news") changed();
    } catch (err) { toast(err.message, "err"); }
    b.disabled = false; b.innerHTML = icon("translate");
  });

  // read aloud with sentence highlighting
  $("#play").onclick = async () => {
    if (playing) { playing = false; stopAll(); return; }
    playing = true;
    $("#play").innerHTML = `${icon("stop")} Stop`;
    const sents = [...bodyEl.querySelectorAll(".sent")];
    for (const el of sents) {
      if (!playing) break;
      sents.forEach((x) => x.classList.remove("playing"));
      el.classList.add("playing");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      await speak(sentOf(el).de);
    }
    sents.forEach((x) => x.classList.remove("playing"));
    playing = false;
    $("#play").innerHTML = `${icon("play")} Read aloud`;
  };

  $("#en").onclick = () => {
    prefs.showEn = !prefs.showEn;
    bodyEl.querySelectorAll(".tr").forEach((x) => x.classList.toggle("hidden", !prefs.showEn || !x.textContent));
    $("#en").innerHTML = `${icon("translate")} ${prefs.showEn ? "Hide" : "Show"} translation`;
    if (prefs.showEn && !t.paragraphs[0][0].en) toast("This text has no built-in translation. Use the translate button on a sentence (uses the AI).");
  };
  $("#hide").onclick = () => {
    prefs.hideText = !prefs.hideText;
    bodyEl.classList.toggle("hide-text", prefs.hideText);
    $("#hide").innerHTML = `${icon(prefs.hideText ? "eye" : "eyeOff")} ${prefs.hideText ? "Show text" : "Hide text"}`;
  };

  $("#add-vocab")?.addEventListener("click", () => {
    let n = 0;
    for (const v of t.vocab) {
      const w = words(v.de).filter((x) => !["der", "die", "das"].includes(x.toLowerCase()));
      const word = w.join(" ");
      const key = w.length === 1 ? keyFor(w[0], false) : word;
      const ex = t.paragraphs.flat().find((s) => w[0] && s.de.includes(w[0].slice(0, Math.max(3, w[0].length - 2))));
      if (addCard(key, { en: v.en, ex: ex?.de, exEn: ex?.en })) { n++; if (S.cards[key] && w.length === 1 && !lemmasFor(w[0], false).length) S.cards[key].word = v.de; }
    }
    changed(); refreshWords(bodyEl); updateMeta();
    toast(n ? `${n} new flashcard${n === 1 ? "" : "s"} added` : "All of these are already in your flashcards");
  });

  $("#fin").onclick = () => {
    const ws = newWordsIn(t);
    ws.forEach((k) => (S.known[k] = 1));
    finish(`${ws.length} words marked as known`);
  };
  $("#fin-only").onclick = () => finish("Marked as read");
  function finish(msg) {
    if (!S.read[t.id]) track("read");
    S.read[t.id] = new Date().toISOString();
    changed(); refreshWords(bodyEl); updateMeta();
    toast(msg);
  }

  renderQuiz($("#quiz"), t);

  return () => { playing = false; stopAll(); unsub(); closeWord(); };
}

function renderQuiz(box, t) {
  if (!t.questions?.length) {
    box.innerHTML = `<div class="row between"><div><h2>Comprehension questions</h2><p class="muted" style="margin-top:4px">This text has no questions yet.</p></div>
      ${ai.hasKey() ? aiButton("Create questions", 'id="mkq"') : `<a class="btn sm" href="#/settings">${icon("key")} Add API key for questions</a>`}</div>`;
    const b = box.querySelector("#mkq");
    if (b) b.onclick = async () => {
      busy(b, true, " Writing questions…");
      try {
        t.questions = await ai.makeQuestions(plainText(t), t.level);
        if (t.source === "ai" || t.source === "news") changed();
        renderQuiz(box, t);
      } catch (err) { busy(b, false); toast(err.message, "err"); }
    };
    return;
  }
  let right = 0, answered = 0;
  box.innerHTML = `<div class="row between"><h2>Comprehension questions</h2><span class="chip" id="qs">0 / ${t.questions.length}</span></div>` +
    t.questions.map((q, qi) => `<div class="quiz-q" data-q="${qi}"><div class="q">${qi + 1}. ${esc(q.q)}</div>
      <div class="quiz-opts">${q.options.map((o, oi) => `<button data-o="${oi}">${esc(o)}</button>`).join("")}</div></div>`).join("");
  box.querySelectorAll(".quiz-q").forEach((qEl) => {
    const q = t.questions[qEl.dataset.q];
    qEl.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      const ok = +b.dataset.o === q.answer;
      qEl.querySelectorAll("button").forEach((x) => { x.disabled = true; if (+x.dataset.o === q.answer) x.classList.add("right"); });
      if (!ok) b.classList.add("wrong");
      answered++; if (ok) right++;
      box.querySelector("#qs").textContent = `${right} / ${t.questions.length} correct`;
    }));
  });
}
