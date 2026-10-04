import { S, changed, track } from "../store.js";
import { D, words, lemmasFor } from "../data.js";
import { esc, icon, toast, busy, shuffle, aiButton } from "../ui.js";
import { speak, playSentence, stopAll } from "../speech.js";
import { compare, renderDiff, ring } from "../diff.js";
import { wordsHTML, attachWordClicks, closeWord } from "../wordpanel.js";
import { addCard } from "../srs.js";
import { credit } from "./practice-common.js";
import * as ai from "../ai.js";

const TABS = [
  { id: "build", label: "Word order", de: "Satzbau" },
  { id: "translate", label: "Translate", de: "Übersetzen" },
  { id: "free", label: "Free writing", de: "Freies Schreiben" },
];
const ui = { tab: "build", level: null, draft: "", task: null, viewing: null };

export function render(root) {
  ui.level ||= S.level;
  root.innerHTML = `<div class="page narrow">
    <div class="page-head">
      <div><div class="eyebrow">Schreiben</div><h1>Writing</h1>
      <p>Practise German word order, translate sentences, and write short texts that the AI corrects.</p></div>
    </div>
    <div class="toolbar">
      <div class="seg" id="tabs">${TABS.map((t) => `<button data-v="${t.id}" class="${ui.tab === t.id ? "on" : ""}">${t.label}</button>`).join("")}</div>
      <div class="seg" id="lv">${["A1", "A2", "B1"].map((l) => `<button data-v="${l}" class="${ui.level === l ? "on" : ""}">${l}</button>`).join("")}</div>
    </div>
    <div id="pane"></div>
  </div>`;
  root.querySelector("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.tab = b.dataset.v; ui.viewing = null; render(root); };
  root.querySelector("#lv").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.level = b.dataset.v; ui.task = null; render(root); };
  paneCleanup?.();
  paneCleanup = { build: buildPane, translate: translatePane, free: freePane }[ui.tab](root.querySelector("#pane")) || null;
  return () => { paneCleanup?.(); paneCleanup = null; stopAll(); closeWord(); };
}
let paneCleanup = null;

// ------------------------------------------------------------ shared helpers
const MAX_WORDS = { A1: 8, A2: 11, B1: 14 };

function pick(minWords = 4) {
  const max = MAX_WORDS[ui.level];
  const ok = (s) => {
    const n = words(s.de).length;
    return s.lv === ui.level && n >= minWords && n <= max && !S.seenSentences["w" + s.id];
  };
  const pool = D.sentences.filter(ok);
  const from = pool.length ? pool : D.sentences.filter((s) => s.lv === ui.level);
  return from[Math.floor(Math.random() * from.length)];
}

const norm = (str) => words(str).join(" ").toLowerCase();

/** Ask the AI whether an alternative answer is also right; renders into `box`. */
async function aiVerdict(box, { english, reference, attempt }, onCorrect) {
  box.innerHTML = `<div class="verdict pending"><span class="spinner"></span> Checking your sentence…</div>`;
  try {
    const r = await ai.checkSentence({ english, reference, attempt, level: ui.level });
    const label = { correct: "✓ Also correct!", almost: "Almost!", wrong: "Not quite" }[r.verdict];
    box.innerHTML = `<div class="verdict ${r.verdict}">
      <div class="lbl">${icon("sparkle")} ${esc(ai.aiName())} · ${label}</div>
      ${r.verdict !== "correct" ? `<div class="serif" style="font-size:18px;margin:4px 0">${esc(r.corrected)}</div>` : ""}
      <div>${esc(r.explanation)}</div></div>`;
    if (r.verdict === "correct") onCorrect?.();
  } catch (err) {
    box.innerHTML = "";
    toast(err.message, "err");
  }
}

// ------------------------------------------------------------ 1. word order (offline)
function buildPane(pane) {
  let s, tiles, placed, done;
  const tileText = (w, i) => {
    // Don't give away the first word by its capital letter (unless it's a noun or name).
    if (i > 0) return w;
    const best = lemmasFor(w, true)[0];
    return best && best[0] === best[0].toLowerCase() ? w.charAt(0).toLowerCase() + w.slice(1) : w;
  };
  const next = () => {
    stopAll();
    s = pick(4);
    const ws = words(s.de);
    tiles = ws.map((w, i) => ({ id: i, text: tileText(w, i) }));
    let order = shuffle(tiles);
    for (let k = 0; k < 5 && order.every((t, i) => t.id === i); k++) order = shuffle(tiles);
    tiles = order;
    placed = [];
    done = false;
    draw();
  };
  const end = () => (s.de.match(/[.!?]+\s*$/) || ["."])[0].trim();

  const draw = (state = "") => {
    const bank = done ? [] : tiles.filter((t) => !placed.includes(t));
    pane.innerHTML = `<div class="card practice-card">
      <div class="subtle">Put the words in the right order</div>
      <div class="prompt-en">${esc(s.en)}</div>
      <div class="answer-zone ${state}" id="zone">${placed.map((t) => `<button class="tile ${t.bad ? "bad" : ""}" data-id="${t.id}">${esc(t.text)}</button>`).join("") || `<span class="subtle">Click the words below…</span>`}<span class="tile-end">${esc(end())}</span></div>
      <div class="tiles" id="bank">${bank.map((t) => `<button class="tile" data-id="${t.id}">${esc(t.text)}</button>`).join("")}</div>
      <div id="feedback" class="stack" style="align-items:center;width:100%"></div>
      <div class="row" style="justify-content:center">
        ${done ? `<button class="btn" id="say">${icon("volume")} Listen</button><button class="btn primary lg" id="next">Next ${icon("arrowRight")} <kbd>Enter</kbd></button>`
          : `<button class="btn" id="reset">${icon("replay")} Reset</button><button class="btn primary lg" id="check" ${bank.length ? "disabled" : ""}>Check <kbd>Enter</kbd></button><button class="btn ghost" id="skip">Skip</button>`}
      </div>
      <div class="credit">${credit(s)}</div>
    </div>
    <p class="subtle" style="text-align:center;margin-top:12px">Remember: in a main clause the conjugated verb comes <b>second</b>. After <i>weil, dass, wenn</i> it goes to the <b>end</b>.</p>`;
    const $ = (q) => pane.querySelector(q);
    if (!done) {
      $("#bank").onclick = (e) => { const b = e.target.closest(".tile"); if (!b) return; placed.push(tiles.find((t) => t.id === +b.dataset.id)); clearBad(); draw(); };
      $("#zone").onclick = (e) => { const b = e.target.closest(".tile"); if (!b) return; placed = placed.filter((t) => t.id !== +b.dataset.id); clearBad(); draw(); };
      $("#reset").onclick = () => { placed = []; clearBad(); draw(); };
      $("#check").onclick = check;
      $("#skip").onclick = next;
    } else {
      $("#next").onclick = next;
      $("#say").onclick = () => playSentence(s);
    }
  };
  const clearBad = () => tiles.forEach((t) => delete t.bad);

  const check = () => {
    if (placed.length !== tiles.length) return;
    const attempt = placed.map((t) => t.text).join(" ");
    const target = words(s.de);
    if (norm(attempt) === norm(s.de)) return success();
    // mark tiles in the wrong position
    placed.forEach((t, i) => { t.bad = t.text.toLowerCase() !== target[i].toLowerCase(); });
    draw("wrong");
    const fb = pane.querySelector("#feedback");
    fb.innerHTML = `<div class="translation">Not this time. Red tiles are in the wrong place.</div>
      <div class="row" style="justify-content:center">
        <button class="btn sm" id="show">${icon("eye")} Show answer</button>
        ${ai.hasKey() ? aiButton("Is my order also correct?", 'id="ask"', "sm") : ""}
      </div><div id="cv" style="width:100%"></div>`;
    fb.querySelector("#show").onclick = () => {
      S.seenSentences["w" + s.id] = 1; track("write"); changed();
      done = true;
      placed = target.map((w, i) => ({ id: -1 - i, text: tileText(w, i) }));
      draw("right");
      pane.querySelector("#feedback").innerHTML = `<div class="target serif" style="font-size:20px">${wordsHTML(s.de)}</div>`;
      attachWordClicks(pane.querySelector("#feedback"), () => ({ sentence: s.de, translation: s.en }));
    };
    const ask = fb.querySelector("#ask");
    if (ask) ask.onclick = () => aiVerdict(fb.querySelector("#cv"), { english: s.en, reference: s.de, attempt: attempt + end() }, success);
  };

  const success = () => {
    S.seenSentences["w" + s.id] = 1; track("write"); changed();
    done = true;
    draw("right");
    const fb = pane.querySelector("#feedback");
    fb.innerHTML = `<div class="verdict correct">✓ Richtig!</div><div class="target serif" style="font-size:20px">${wordsHTML(s.de)}</div>`;
    attachWordClicks(fb, () => ({ sentence: s.de, translation: s.en }));
    playSentence(s);
  };

  const onKey = (e) => {
    if (e.key !== "Enter" || e.target.matches("textarea, input")) return;
    e.preventDefault();
    if (done) next(); else check();
  };
  document.addEventListener("keydown", onKey);
  next();
  return () => document.removeEventListener("keydown", onKey);
}

// ------------------------------------------------------------ 2. translate EN -> DE
function translatePane(pane) {
  let s, checked;
  const next = () => {
    stopAll();
    s = pick(3);
    checked = false;
    pane.innerHTML = `<div class="card practice-card">
      <div class="subtle">Translate into German</div>
      <div class="prompt-en">${esc(s.en)}</div>
      <input class="input dict-input" id="answer" placeholder="Auf Deutsch…" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="row" style="justify-content:center"><button class="btn sm ghost" id="hint">${icon("eye")} Hint: show the words</button></div>
      <div class="translation hidden" id="hint-text">${shuffle(words(s.de)).map((w) => `<span class="chip" style="font-size:14px;margin:2px">${esc(w)}</span>`).join(" ")}</div>
      <div id="result" class="stack" style="align-items:center;width:100%"></div>
      <div class="row" style="justify-content:center"><button class="btn primary lg" id="check">Check <kbd>Enter</kbd></button><button class="btn lg" id="skip">Skip</button></div>
      <div class="credit">${credit(s)}</div>
    </div>
    <p class="subtle" style="text-align:center;margin-top:12px">${ai.hasKey()
      ? "If your wording differs from the reference, the AI checks whether it's also correct."
      : "Many sentences can be translated in more than one way. Set up an AI provider in Settings to have alternative answers checked."}</p>`;
    const $ = (q) => pane.querySelector(q);
    $("#answer").focus();
    $("#hint").onclick = () => $("#hint-text").classList.toggle("hidden");
    $("#skip").onclick = next;
    $("#check").onclick = check;
    $("#answer").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); checked ? next() : check(); } };
  };

  const check = () => {
    const $ = (q) => pane.querySelector(q);
    const attempt = $("#answer").value.trim();
    if (!attempt) return;
    checked = true;
    S.seenSentences["w" + s.id] = 1; track("write"); changed();
    const { parts, score } = compare(s.de, attempt);
    const exact = norm(attempt) === norm(s.de);
    $("#result").innerHTML = `
      ${exact ? `<div class="verdict correct">✓ Perfekt!</div>` : `${ring(score)}<div class="subtle">Compared with the reference:</div><div class="diff">${renderDiff(parts)}</div>`}
      <div class="target serif" style="font-size:20px" id="ref">${wordsHTML(s.de)}</div>
      <div id="cv" style="width:100%"></div>`;
    attachWordClicks($("#ref"), () => ({ sentence: s.de, translation: s.en }));
    $("#check").outerHTML = `<button class="btn primary lg" id="next">Next ${icon("arrowRight")} <kbd>Enter</kbd></button>`;
    $("#next").onclick = next;
    $("#skip").classList.add("hidden");
    $("#answer").readOnly = true;
    $("#answer").focus();
    playSentence(s);
    if (!exact && ai.hasKey()) aiVerdict($("#cv"), { english: s.en, reference: s.de, attempt });
  };

  next();
}

// ------------------------------------------------------------ 3. free writing (AI)
const TASKS = {
  A1: [
    ["Stell dich vor: Name, Alter, Herkunft, Wohnort, Beruf, Hobbys.", "Introduce yourself: name, age, origin, home, job, hobbies."],
    ["Beschreib deinen Tag. Wann stehst du auf? Was machst du?", "Describe your day. When do you get up? What do you do?"],
    ["Was isst und trinkst du gern? Was magst du nicht?", "What do you like to eat and drink? What don't you like?"],
    ["Beschreib deine Wohnung oder dein Zimmer.", "Describe your flat or your room."],
    ["Schreib eine Nachricht an eine Freundin: Du kommst heute später. Warum?", "Text a friend: you're coming later today. Why?"],
    ["Was machst du gern am Wochenende?", "What do you like doing at the weekend?"],
    ["Beschreib deine Familie.", "Describe your family."],
  ],
  A2: [
    ["Was hast du letztes Wochenende gemacht?", "What did you do last weekend? (Perfekt)"],
    ["Schreib eine E-Mail an deinen Vermieter: Die Heizung ist kaputt.", "Email your landlord: the heating is broken."],
    ["Erzähl von deinem letzten Urlaub.", "Tell about your last holiday."],
    ["Lade Freunde zu deiner Geburtstagsparty ein: wann, wo, was sollen sie mitbringen?", "Invite friends to your birthday party: when, where, what to bring?"],
    ["Warum lernst du Deutsch? Was ist leicht, was ist schwer?", "Why are you learning German? What's easy, what's hard?"],
    ["Beschreib deine Stadt: Was gefällt dir, was nicht?", "Describe your town: what do you like, what not?"],
  ],
  B1: [
    ["Homeoffice: Was sind die Vor- und Nachteile? Was denkst du?", "Working from home: pros and cons, and your opinion."],
    ["Schreib eine Beschwerde an ein Hotel. Dein Zimmer war nicht in Ordnung.", "Write a complaint to a hotel about your room."],
    ["Erzähl von einem Erlebnis, das dich verändert hat.", "Tell about an experience that changed you."],
    ["Soziale Medien: eher gut oder eher schlecht? Begründe deine Meinung.", "Social media: good or bad? Give reasons."],
  ],
};
const LENGTH = { A1: [40, 80], A2: [60, 120], B1: [100, 180] };

function freePane(pane) {
  if (!ai.hasKey()) {
    pane.innerHTML = `<div class="card empty"><div class="big">✍️</div><h2>Write, and get every mistake explained</h2>
      <p class="muted" style="margin:8px auto 18px;max-width:460px">Free writing is corrected by the AI: each mistake is marked in your text with the rule behind it, plus a corrected and an improved version. This needs an AI provider and API key. Word order and Translate work without it.</p>
      <a class="btn primary" href="#/settings">${icon("key")} Add API key</a></div>`;
    return;
  }
  if (ui.viewing) return showFeedback(pane, ui.viewing);

  const tasks = TASKS[ui.level];
  ui.task ||= tasks[Math.floor(Math.random() * tasks.length)];
  const [lo, hi] = LENGTH[ui.level];
  const history = S.writings.slice(0, 8);

  pane.innerHTML = `<div class="card stack">
      <div class="row between"><span class="chip ${ui.level}">${ui.level} · ${lo}–${hi} words</span><button class="btn sm ghost" id="other">${icon("replay")} Other topic</button></div>
      <div><div class="prompt-en" style="font-size:22px">${esc(ui.task[0])}</div><div class="subtle" style="margin-top:4px">${esc(ui.task[1])}</div></div>
      <textarea class="input write-area" id="text" placeholder="Schreib hier…" spellcheck="false">${esc(ui.draft)}</textarea>
      <div class="row between"><span class="subtle" id="count"></span>${aiButton("Correct my text", 'id="send"', "primary")}</div>
    </div>
    <details class="card" style="margin-top:14px"><summary style="cursor:pointer;font-weight:600">Or choose a topic (${tasks.length})</summary>
      <div class="stack" style="margin-top:12px;gap:8px">${tasks.map((t, i) => `<button class="btn" style="justify-content:flex-start;text-align:left;white-space:normal" data-t="${i}"><span><b class="serif">${esc(t[0])}</b><br><span class="subtle">${esc(t[1])}</span></span></button>`).join("")}
      <div class="row" style="flex-wrap:nowrap"><input class="input" id="custom" placeholder="…or type your own topic"><button class="btn" id="use">Use</button></div></div>
    </details>
    ${history.length ? `<div class="section-title"><h2>Your texts</h2></div>
      <div class="stack" style="gap:8px">${history.map((w, i) => `<button class="card row between" style="padding:14px 18px;cursor:pointer;text-align:left" data-h="${i}">
        <span style="min-width:0;flex:1"><b class="serif">${esc(w.task)}</b><br><span class="subtle">${new Date(w.at).toLocaleDateString("de-DE")} · ${w.feedback.errors.length} mistakes</span></span>
        <span class="chip ${w.feedback.score >= 80 ? "A1" : w.feedback.score >= 60 ? "B1" : ""}">${w.feedback.score}/100</span></button>`).join("")}</div>` : ""}`;

  const $ = (q) => pane.querySelector(q);
  const count = () => {
    const n = words($("#text").value).length;
    $("#count").textContent = `${n} word${n === 1 ? "" : "s"}`;
    $("#count").style.color = n >= lo && n <= hi ? "var(--green)" : "";
  };
  count();
  $("#text").oninput = () => { ui.draft = $("#text").value; count(); };
  $("#other").onclick = () => { ui.task = shuffle(tasks.filter((t) => t !== ui.task))[0]; freePane(pane); };
  pane.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { ui.task = tasks[+b.dataset.t]; freePane(pane); }));
  $("#use").onclick = () => { const v = $("#custom").value.trim(); if (v) { ui.task = [v, ""]; freePane(pane); } };
  pane.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => { ui.viewing = S.writings[+b.dataset.h]; freePane(pane); }));

  $("#send").onclick = async (e) => {
    const text = $("#text").value.trim();
    if (words(text).length < 5) return toast("Write at least a few sentences first.");
    const btn = e.currentTarget;
    busy(btn, true, " Correcting… (15–40 s)");
    try {
      const feedback = await ai.reviewWriting({ task: ui.task[0], text, level: ui.level });
      const entry = { task: ui.task[0], text, level: ui.level, feedback, at: new Date().toISOString() };
      S.writings.unshift(entry);
      S.writings = S.writings.slice(0, 50);
      track("write");
      changed();
      ui.draft = "";
      ui.task = null;
      ui.viewing = entry;
      showFeedback(pane, entry);
    } catch (err) {
      busy(btn, false);
      toast(err.message, "err");
    }
  };
}

/** Mark each error's `original` fragment inside the learner's text. */
function markErrors(text, errors) {
  const ranges = [];
  let from = 0;
  errors.forEach((er, i) => {
    if (!er.original) return;
    let at = text.indexOf(er.original, from);
    if (at < 0) at = text.indexOf(er.original);
    if (at < 0 || ranges.some((r) => at < r.end && at + er.original.length > r.start)) return;
    ranges.push({ start: at, end: at + er.original.length, i });
    from = at + er.original.length;
  });
  ranges.sort((a, b) => a.start - b.start);
  let out = "", pos = 0;
  for (const r of ranges) {
    out += esc(text.slice(pos, r.start));
    out += `<mark class="err-mark" title="${esc(errors[r.i].correction)}">${esc(text.slice(r.start, r.end))}<sup>${r.i + 1}</sup></mark>`;
    pos = r.end;
  }
  return (out + esc(text.slice(pos))).replace(/\n/g, "<br>");
}

function showFeedback(pane, w) {
  const f = w.feedback;
  pane.innerHTML = `
    <button class="back" id="back" style="border:0;background:none;cursor:pointer;margin-bottom:14px">${icon("arrowLeft")} Write another text</button>
    <div class="card stack">
      <div class="row" style="gap:18px;flex-wrap:nowrap;align-items:flex-start">${ring(f.score)}<div><div class="subtle">${esc(w.task)}</div><p style="margin-top:6px">${esc(f.summary)}</p></div></div>
    </div>
    <div class="card stack" style="margin-top:14px">
      <h2>Your text</h2>
      <div class="write-view">${markErrors(w.text, f.errors)}</div>
      ${f.errors.length ? `<div class="err-list">${f.errors.map((e, i) => `<div class="err-item"><span class="n">${i + 1}</span><div>
        <div><s>${esc(e.original)}</s> → <b>${esc(e.correction)}</b> <span class="chip" style="margin-left:4px">${esc(e.type)}</span></div>
        <div class="muted" style="margin-top:4px;font-size:14px">${esc(e.explanation)}</div></div></div>`).join("")}</div>`
        : `<div class="verdict correct">No mistakes found. Ausgezeichnet!</div>`}
    </div>
    <div class="card stack" style="margin-top:14px">
      <div class="row between"><h2>Corrected</h2><button class="btn sm ghost" data-say="corrected_text">${icon("volume")} Listen</button></div>
      <div class="write-view" id="corr">${wordsHTML(f.corrected_text).replace(/\n/g, "<br>")}</div>
    </div>
    <div class="card stack" style="margin-top:14px">
      <div class="row between"><h2>More natural version</h2><button class="btn sm ghost" data-say="improved_text">${icon("volume")} Listen</button></div>
      <p class="subtle">How a native speaker might say the same thing. Click any word to look it up.</p>
      <div class="write-view" id="impr">${wordsHTML(f.improved_text).replace(/\n/g, "<br>")}</div>
    </div>
    ${f.useful_phrases?.length ? `<div class="card stack" style="margin-top:14px">
      <h2>Useful for next time</h2>
      <div class="vocab-list">${f.useful_phrases.map((p, i) => `<div class="vocab-item"><span><b>${esc(p.de)}</b><br><span class="muted">${esc(p.en)}</span></span><button class="btn sm ghost icon" data-add="${i}" title="Add to flashcards">${icon("plus")}</button></div>`).join("")}</div>
    </div>` : ""}`;
  pane.querySelector("#back").onclick = () => { ui.viewing = null; freePane(pane); };
  pane.querySelectorAll("[data-say]").forEach((b) => (b.onclick = () => speak(f[b.dataset.say])));
  for (const id of ["corr", "impr"]) {
    const el = pane.querySelector("#" + id);
    attachWordClicks(el, (wEl) => {
      const txt = id === "corr" ? f.corrected_text : f.improved_text;
      const sentence = txt.split(/(?<=[.!?])\s+/).find((x) => x.includes(wEl.dataset.w)) || txt;
      return { sentence };
    });
  }
  pane.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => {
    const p = f.useful_phrases[+b.dataset.add];
    const added = addCard(p.de, { en: p.en });
    if (added) S.cards[p.de].word = p.de;
    changed();
    b.innerHTML = icon("check");
    b.disabled = true;
    toast(added ? `„${p.de}“ added to flashcards` : "Already in your flashcards");
  }));
}
