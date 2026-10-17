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

  const sentHTML = (s, pi, si) => {
    const tr = s.en ? `<span class="tr ${prefs.showEn ? "" : "hidden"}">${esc(s.en)}</span>` : `<span class="tr hidden"></span>`;
    return `<span class="sent" data-p="${pi}" data-s="${si}">${wordsHTML(s.de)}<span class="sent-actions"><button data-act="from" title="Read aloud from this sentence">${icon("play")}</button><button data-act="say" title="Listen to this sentence">${icon("volume")}</button><button data-act="tr" title="Translation">${icon("translate")}</button></span>${tr}</span>`;
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
      <span class="player" id="player"></span>
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
    if (b.dataset.act === "from") { playFrom(sents().indexOf(sEl)); return; }
    if (b.dataset.act === "say") { if (player.state === "playing") pause(); stopAll(); speak(s.de); return; }
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

  // ---- read aloud, sentence by sentence. Pause keeps the position (also saved per text,
  // so it survives leaving the page); Resume restarts the paused sentence and goes on.
  // (speechSynthesis.pause() is unreliable in Chrome, especially on Android, so pausing
  // cancels the current utterance and resuming speaks that sentence again.)
  S.readPos ||= {};
  const sents = () => [...bodyEl.querySelectorAll(".sent")];
  const player = { state: S.readPos[t.id] ? "paused" : "idle", index: S.readPos[t.id] || 0, run: 0 };
  const mark = (i, cls) => sents().forEach((x, k) => { x.classList.toggle("playing", cls === "playing" && k === i); x.classList.toggle("paused", cls === "paused" && k === i); });
  const savePos = () => { if (player.index > 0) S.readPos[t.id] = player.index; else delete S.readPos[t.id]; changed(); };

  function drawPlayer() {
    const n = sents().length, pos = `${Math.min(player.index + 1, n)} / ${n}`;
    $("#player").innerHTML = player.state === "playing"
      ? `<button class="btn sm primary" id="pp" title="Pause (Space)">${icon("pause")} Pause</button>
         <button class="btn sm icon" id="restart" title="Stop and go back to the start">${icon("stop")}</button>
         <span class="subtle player-pos">Satz ${pos}</span>`
      : player.state === "paused"
        ? `<button class="btn sm primary" id="pp" title="Resume (Space)">${icon("play")} Resume</button>
           <button class="btn sm icon" id="restart" title="Start again from the beginning">${icon("replay")}</button>
           <span class="subtle player-pos">Paused at sentence ${pos}</span>`
        : `<button class="btn sm primary" id="pp" title="Read aloud (Space)">${icon("play")} Read aloud</button>`;
    $("#pp").onclick = () => (player.state === "playing" ? pause() : playFrom(player.index));
    $("#restart")?.addEventListener("click", restart);
  }

  async function playFrom(i) {
    const run = ++player.run;
    stopAll();
    player.state = "playing";
    player.index = Math.max(0, i);
    drawPlayer();
    const list = sents();
    while (player.index < list.length) {
      mark(player.index, "playing");
      list[player.index].scrollIntoView({ block: "center", behavior: "smooth" });
      await speak(sentOf(list[player.index]).de);
      if (run !== player.run) return; // paused, restarted or left the page meanwhile
      player.index++;
      savePos();
      if (player.index < list.length) drawPlayer();
    }
    // reached the end
    player.state = "idle";
    player.index = 0;
    savePos();
    mark(-1);
    drawPlayer();
  }

  function pause() {
    player.run++;
    stopAll();
    player.state = "paused";
    savePos();
    mark(player.index, "paused");
    drawPlayer();
  }

  function restart() {
    player.run++;
    stopAll();
    player.state = "idle";
    player.index = 0;
    savePos();
    mark(-1);
    drawPlayer();
  }

  drawPlayer();
  if (player.state === "paused") mark(player.index, "paused");

  const onKey = (e) => {
    if (e.key !== " " || e.target.closest("input, textarea, button, select, [contenteditable]")) return;
    e.preventDefault();
    player.state === "playing" ? pause() : playFrom(player.index);
  };
  document.addEventListener("keydown", onKey);

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

  return () => { player.run++; stopAll(); document.removeEventListener("keydown", onKey); unsub(); closeWord(); };
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
