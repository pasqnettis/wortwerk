import { S, changed, track } from "../store.js";
import { D, words, lemmasFor } from "../data.js";
import { esc, icon, toast, busy, shuffle, aiButton } from "../ui.js";
import { speak, stopAll } from "../speech.js";
import { wordsHTML, attachWordClicks, closeWord } from "../wordpanel.js";
import * as ai from "../ai.js";

const PASS = 0.75; // share of correct answers needed to complete a chapter

const progress = (id) => S.grammar[id] || {};
const isDone = (id) => { const p = progress(id); return p.total && p.best / p.total >= PASS; };

export function nextChapter() {
  return D.grammar.find((c) => !isDone(c.id)) || null;
}

export function render(root, id) {
  if (!D.grammar.length) {
    root.innerHTML = `<div class="page empty"><div class="big">📚</div>The grammar chapters haven't been built yet (data/grammar.json is missing).</div>`;
    return;
  }
  return id ? chapterView(root, id) : listView(root);
}

// ------------------------------------------------------------ inline markup
/** **bold**, *italic*, `German form` -> HTML (input is escaped first). */
export function md(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/`(.+?)`/g, '<code class="de">$1</code>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<i>$2</i>");
}

function mdBlock(text) {
  return text.split(/\n\s*\n/).map((para) => {
    const lines = para.split("\n");
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${md(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p>${md(para).replace(/\n/g, "<br>")}</p>`;
  }).join("");
}

// ------------------------------------------------------------ chapter list
const LEVEL_INFO = {
  A1: "Grundlagen: the basics",
  A2: "Aufbau: everyday fluency",
  B1: "Mittelstufe: independent use",
};
const listUi = { level: null };

function listView(root) {
  const levels = [...new Set(D.grammar.map((c) => c.level))];
  const next = nextChapter();
  listUi.level ||= levels.includes(next?.level) ? next.level : levels[0];
  const chapters = D.grammar.filter((c) => c.level === listUi.level);
  const done = chapters.filter((c) => isDone(c.id)).length;
  const nextHere = chapters.find((c) => !isDone(c.id));
  root.innerHTML = `<div class="page narrow">
    <div class="page-head">
      <div><div class="eyebrow">Grammatik · ${esc(levels.length > 1 ? `${levels[0]}–${levels.at(-1)}` : levels[0])}</div><h1>Grammar course</h1>
      <p>${D.grammar.length} chapters from the very basics to B1, in a sensible order. Each one has a short explanation, examples to listen to, and exercises. You finish a chapter by getting ${Math.round(PASS * 100)}% of its exercises right.</p></div>
    </div>
    ${levels.length > 1 ? `<div class="seg" id="lv" style="margin-bottom:16px">${levels.map((l) => {
      const all = D.grammar.filter((c) => c.level === l);
      return `<button data-v="${l}" class="${l === listUi.level ? "on" : ""}">${l} <span class="subtle">${all.filter((c) => isDone(c.id)).length}/${all.length}</span></button>`;
    }).join("")}</div>` : ""}
    <div class="card row between" style="margin-bottom:22px">
      <div style="flex:1;min-width:200px"><div class="row between"><b>${esc(listUi.level)} · ${esc(LEVEL_INFO[listUi.level] || "")}</b><span class="subtle">${done} of ${chapters.length} done</span></div>
        <div class="progress green" style="margin-top:8px"><span style="width:${(done / chapters.length) * 100}%"></span></div></div>
      ${nextHere ? `<a class="btn primary" href="#/grammar/${esc(nextHere.id)}">${done ? "Continue" : "Start"}: Kapitel ${nextHere.num} ${icon("arrowRight")}</a>` : `<span class="chip A1">${icon("check")} All ${esc(listUi.level)} chapters done!</span>`}
    </div>
    <div class="g-path">${chapters.map((c) => {
      const p = progress(c.id);
      const state = isDone(c.id) ? "done" : p.read || p.total ? "started" : nextHere?.id === c.id ? "next" : "";
      return `<a class="g-item ${state}" href="#/grammar/${esc(c.id)}">
        <span class="g-num">${isDone(c.id) ? icon("check") : c.num}</span>
        <span class="g-text"><b class="serif">${esc(c.title)}</b><span class="subtle">${esc(c.title_en)}</span><span class="g-sum">${esc(c.summary)}</span></span>
        ${p.total ? `<span class="chip ${isDone(c.id) ? "A1" : ""}">${p.best}/${p.total}</span>` : ""}
      </a>`;
    }).join("")}</div>
  </div>`;
  root.querySelector("#lv")?.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    listUi.level = b.dataset.v;
    listView(root);
  });
}

// ------------------------------------------------------------ chapter
function blockHTML(b) {
  switch (b.type) {
    case "p": return `<p>${md(b.text)}</p>`;
    case "tip": return `<div class="g-tip">${icon("sparkle")}<div>${md(b.text)}</div></div>`;
    case "mistake": return `<div class="g-mistake">
      <div><span class="g-x">✗</span> <s>${esc(b.wrong)}</s></div>
      <div><span class="g-ok">✓</span> <b class="serif">${esc(b.right)}</b></div>
      <div class="muted">${md(b.why)}</div></div>`;
    case "table": return `<div class="g-table-wrap"><table class="g-table">
      ${b.caption ? `<caption>${md(b.caption)}</caption>` : ""}
      <thead><tr>${b.head.map((h) => `<th>${md(h)}</th>`).join("")}</tr></thead>
      <tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i === 0 ? "rowh" : "serif"}">${md(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "examples": return `<div class="g-examples">${b.items.map((x) => `<div class="g-ex">
      <button class="btn ghost icon sm" data-say="${esc(x.de)}" title="Listen">${icon("volume")}</button>
      <div><div class="g-de" data-sent="${esc(x.de)}">${wordsHTML(x.de)}</div><div class="subtle">${esc(x.en)}${x.note ? ` · <i>${md(x.note)}</i>` : ""}</div></div></div>`).join("")}</div>`;
    default: return "";
  }
}

function chapterView(root, id) {
  const idx = D.grammar.findIndex((c) => c.id === id);
  const ch = D.grammar[idx];
  if (!ch) { root.innerHTML = `<div class="page empty">Chapter not found. <a href="#/grammar">Back</a></div>`; return; }
  const prev = D.grammar[idx - 1], next = D.grammar[idx + 1];
  const p = (S.grammar[ch.id] ||= {});
  if (!p.read) { p.read = new Date().toISOString(); changed(); }

  root.innerHTML = `<div class="reader g-chapter">
    <div class="reader-head">
      <a class="back" href="#/grammar">${icon("arrowLeft")} All chapters</a>
      <div class="eyebrow" style="margin-top:14px;font-size:12.5px;font-weight:650;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)">Kapitel ${ch.num} · ${esc(ch.level)}</div>
      <h1>${esc(ch.title)}</h1>
      <div class="muted">${esc(ch.title_en)}</div>
    </div>
    <div class="card g-key"><h3>Auf einen Blick · At a glance</h3><ul>${ch.key_points.map((k) => `<li>${md(k)}</li>`).join("")}</ul></div>
    ${ch.sections.map((s) => `<section class="g-section"><h2>${md(s.heading)}</h2>${s.blocks.map(blockHTML).join("")}</section>`).join("")}

    <section class="g-section" id="ex-section">
      <div class="row between"><h2>Übungen · Exercises</h2>${p.total ? `<span class="chip ${isDone(ch.id) ? "A1" : ""}">Best: ${p.best}/${p.total}</span>` : ""}</div>
      <div id="ex"></div>
    </section>

    <section class="g-section">
      <h2>${icon("sparkle")} More with AI</h2>
      ${ai.hasKey() ? `
        <div class="row">${aiButton("8 new exercises", 'id="more"')}</div>
        <div class="card stack" style="margin-top:14px">
          <label class="field">Ask a question about this topic
            <textarea class="input" id="q" rows="2" placeholder="e.g. Why is it „Ich bin Lehrer“ without „ein“?"></textarea></label>
          <div class="row">${aiButton("Ask", 'id="ask"', "sm")}</div>
          <div id="answer"></div>
        </div>`
        : `<a class="notice" href="#/settings" style="display:block;text-decoration:none">${icon("key")} Set up an AI provider in Settings to get unlimited extra exercises and ask questions about this chapter.</a>`}
    </section>

    <div class="row between g-nav">
      ${prev ? `<a class="btn" href="#/grammar/${esc(prev.id)}">${icon("arrowLeft")} ${prev.num}. ${esc(prev.title)}</a>` : "<span></span>"}
      ${next ? `<a class="btn" href="#/grammar/${esc(next.id)}">${next.num}. ${esc(next.title)} ${icon("arrowRight")}</a>` : ""}
    </div>
  </div>`;

  const $ = (q) => root.querySelector(q);
  root.querySelectorAll("[data-say]").forEach((b) => (b.onclick = () => speak(b.dataset.say)));
  root.querySelectorAll(".g-de").forEach((el) => attachWordClicks(el, () => ({ sentence: el.dataset.sent })));

  const runOfficial = () => runExercises($("#ex"), ch.exercises, (right, total) => {
    const prog = S.grammar[ch.id];
    const wasDone = isDone(ch.id);
    if (!prog.total || right / total > (prog.best || 0) / prog.total) { prog.best = right; prog.total = total; }
    prog.at = new Date().toISOString();
    changed();
    if (!wasDone && isDone(ch.id)) toast(`Kapitel ${ch.num} completed! 🎉`);
  }, next, runOfficial);
  runOfficial();

  const more = $("#more");
  if (more) more.onclick = async () => {
    busy(more, true, " Writing exercises…");
    try {
      const exs = await ai.grammarExercises(ch);
      busy(more, false);
      $("#ex-section").scrollIntoView({ behavior: "smooth" });
      runExercises($("#ex"), exs, () => {}, next, runOfficial, true);
    } catch (err) { busy(more, false); toast(err.message, "err"); }
  };
  const ask = $("#ask");
  if (ask) ask.onclick = async () => {
    const q = $("#q").value.trim();
    if (!q) return;
    busy(ask, true, " Thinking…");
    try {
      const r = await ai.askGrammar(ch, q);
      $("#answer").innerHTML = `<div class="ai-box"><div class="lbl">${icon("sparkle")} ${esc(ai.aiName())}</div>${mdBlock(r.answer)}
        ${r.examples.map((x) => `<div class="ex">${esc(x.de)}<div class="subtle">${esc(x.en)}</div></div>`).join("")}</div>`;
    } catch (err) { toast(err.message, "err"); }
    busy(ask, false);
  };

  // Enter = check / next (a focused button already reacts to Enter by itself)
  const onKey = (e) => {
    if (e.key !== "Enter" || e.target.closest("button, textarea") || e.target.id === "gi") return;
    const btn = root.querySelector("#ex #nx") || root.querySelector("#ex #oc:not([disabled])");
    if (btn) { e.preventDefault(); btn.click(); }
  };
  document.addEventListener("keydown", onKey);

  return () => { stopAll(); closeWord(); document.removeEventListener("keydown", onKey); };
}

// ------------------------------------------------------------ exercise runner
const clean = (s) => s.trim().replace(/\s+/g, " ").replace(/[.!?,;:]+$/, "");
const normWords = (s) => words(s).join(" ").toLowerCase();

function tileText(w, i) {
  if (i > 0 || w === "Sie") return w;
  const best = lemmasFor(w, true)[0];
  return best && best[0] === best[0].toLowerCase() ? w.charAt(0).toLowerCase() + w.slice(1) : w;
}

/** Fill the gap of a q with the correct answer to get the full sentence. */
function fullSentence(ex) {
  if (ex.type === "order") return ex.answer;
  const fill = ex.type === "choice" ? ex.options[ex.answer] : ex.answers[0];
  return ex.q.replace(/\s*\([^)]*\)\s*$/, "").replace("___", fill);
}

function runExercises(box, list, onFinish, nextCh, restartOfficial, isExtra = false) {
  const items = list.filter((e) => e && (e.type === "order" ? e.words?.length && e.answer : e.q?.includes("___")));
  let i = 0, right = 0;
  const wrongOnes = [];

  const show = () => {
    if (i >= items.length) return finish();
    const ex = items[i];
    const head = `<div class="row between"><span class="subtle">${isExtra ? `${icon("sparkle")} AI exercise · ` : ""}${i + 1} / ${items.length}</span>
      <div class="progress" style="width:160px"><span style="width:${(i / items.length) * 100}%"></span></div></div>`;
    let body = "";
    if (ex.type === "choice") {
      body = `<div class="g-q">${md(ex.q).replace("___", '<span class="g-gap">&nbsp;?&nbsp;</span>')}</div>
        <div class="quiz-opts">${ex.options.map((o, k) => `<button data-o="${k}">${esc(o)}</button>`).join("")}</div>`;
    } else if (ex.type === "gap") {
      const [before, after] = esc(ex.q).split("___");
      body = `<div class="g-q">${before}<input class="g-input" id="gi" autocomplete="off" autocapitalize="off" spellcheck="false">${after ?? ""}</div>
        <div class="row"><button class="btn primary" id="gc">Check <kbd>Enter</kbd></button></div>`;
    } else {
      body = `<div class="g-q" style="font-size:16px;color:var(--ink-2)">Put the words in order${ex.en ? `: <i>${esc(ex.en)}</i>` : ""}</div>
        <div class="answer-zone" id="zone"><span class="subtle">Click the words below…</span></div><div class="tiles" id="bank"></div>
        <div class="row"><button class="btn" id="reset">${icon("replay")} Reset</button><button class="btn primary" id="oc" disabled>Check <kbd>Enter</kbd></button></div>`;
    }
    box.innerHTML = `<div class="card g-exercise">${head}${body}<div id="fb"></div></div>`;
    const $ = (q) => box.querySelector(q);

    const feedback = (ok, extra = "") => {
      if (ok) right++; else wrongOnes.push(ex);
      const sentence = fullSentence(ex);
      $("#fb").innerHTML = `<div class="verdict ${ok ? "correct" : "wrong"}" style="margin-top:14px">
          <div class="lbl">${ok ? "✓ Richtig!" : "✗ Not quite"}</div>
          <div class="serif" style="font-size:18px;margin:2px 0">${esc(sentence)} <button class="btn ghost icon sm" id="say">${icon("volume")}</button></div>
          ${ex.en && ex.type !== "order" ? `<div class="subtle">${esc(ex.en)}</div>` : ""}
          ${extra}<div style="margin-top:6px;color:var(--ink)">${md(ex.explain || "")}</div>
        </div>
        <div class="row" style="margin-top:12px"><button class="btn primary" id="nx">${i + 1 < items.length ? "Next" : "Finish"} ${icon("arrowRight")} <kbd>Enter</kbd></button></div>`;
      $("#say").onclick = () => speak(sentence);
      $("#nx").onclick = () => { i++; show(); };
      $("#nx").focus();
    };

    if (ex.type === "choice") {
      box.querySelectorAll("[data-o]").forEach((b) => (b.onclick = () => {
        const ok = +b.dataset.o === ex.answer;
        box.querySelectorAll("[data-o]").forEach((x) => { x.disabled = true; if (+x.dataset.o === ex.answer) x.classList.add("right"); });
        if (!ok) b.classList.add("wrong");
        box.querySelector(".g-gap").textContent = ex.options[ex.answer];
        feedback(ok);
      }));
    } else if (ex.type === "gap") {
      const inp = $("#gi");
      inp.style.width = `${Math.max(5, ...ex.answers.map((a) => a.length)) + 2}ch`;
      inp.focus();
      const check = () => {
        const v = clean(inp.value);
        if (!v) return;
        const exact = ex.answers.some((a) => clean(a) === v);
        const caseOnly = !exact && ex.answers.some((a) => clean(a).toLowerCase() === v.toLowerCase());
        inp.disabled = true;
        inp.classList.add(exact || caseOnly ? "ok" : "bad");
        $("#gc").remove();
        feedback(exact || caseOnly, caseOnly ? `<div>Careful with capital letters: <b class="serif">${esc(ex.answers[0])}</b></div>`
          : exact ? "" : `<div>Answer: <b class="serif">${esc(ex.answers.join(" / "))}</b></div>`);
      };
      $("#gc").onclick = check;
      inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); check(); } };
    } else {
      // lowercase the sentence's first word so its capital letter doesn't give it away
      const first = words(ex.answer)[0];
      let firstSeen = false;
      const tiles = ex.words.map((w, k) => {
        const isFirst = !firstSeen && w === first;
        if (isFirst) firstSeen = true;
        return { k, text: isFirst ? tileText(w, 0) : w };
      });
      let order = shuffle(tiles);
      let placed = [];
      const drawTiles = () => {
        $("#zone").innerHTML = placed.map((t) => `<button class="tile" data-k="${t.k}">${esc(t.text)}</button>`).join("") || `<span class="subtle">Click the words below…</span>`;
        $("#bank").innerHTML = order.filter((t) => !placed.includes(t)).map((t) => `<button class="tile" data-k="${t.k}">${esc(t.text)}</button>`).join("");
        $("#oc").disabled = placed.length !== tiles.length;
      };
      drawTiles();
      $("#bank").onclick = (e) => { const b = e.target.closest(".tile"); if (!b) return; placed.push(tiles[+b.dataset.k]); drawTiles(); };
      $("#zone").onclick = (e) => { const b = e.target.closest(".tile"); if (!b || $("#oc") === null) return; placed = placed.filter((t) => t.k !== +b.dataset.k); drawTiles(); };
      $("#reset").onclick = () => { placed = []; drawTiles(); };
      $("#oc").onclick = () => {
        const attempt = normWords(placed.map((t) => t.text).join(" "));
        const ok = [ex.answer, ...(ex.accept || [])].some((a) => normWords(a) === attempt);
        $("#zone").classList.add(ok ? "right" : "wrong");
        $("#oc").remove(); $("#reset").remove();
        feedback(ok);
      };
    }
  };

  const finish = () => {
    track("grammar");
    onFinish(right, items.length);
    const pct = right / items.length;
    box.innerHTML = `<div class="card g-exercise" style="text-align:center;align-items:center">
      <div class="big" style="font-size:44px">${pct >= PASS ? "🎉" : "💪"}</div>
      <h2>${right} / ${items.length} correct</h2>
      <p class="muted" style="margin:6px 0 16px">${pct >= PASS ? (isExtra ? "Great practice!" : "Chapter completed. Gut gemacht!") : `You need ${Math.ceil(PASS * items.length)} to complete the chapter. Re-read the explanation above and try again.`}</p>
      <div class="row" style="justify-content:center">
        ${wrongOnes.length ? `<button class="btn" id="redo">${icon("replay")} Practise my ${wrongOnes.length} mistake${wrongOnes.length === 1 ? "" : "s"}</button>` : ""}
        <button class="btn" id="again">${icon("replay")} ${isExtra ? "Back to chapter exercises" : "Start again"}</button>
        ${nextCh && pct >= PASS ? `<a class="btn primary" href="#/grammar/${esc(nextCh.id)}">Next chapter ${icon("arrowRight")}</a>` : ""}
      </div></div>`;
    const redo = box.querySelector("#redo");
    if (redo) redo.onclick = () => runExercises(box, wrongOnes, () => {}, nextCh, restartOfficial, true);
    box.querySelector("#again").onclick = () => restartOfficial();
  };

  show();
}
