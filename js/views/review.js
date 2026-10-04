import { S, changed } from "../store.js";
import { esc, icon, relTime, toast } from "../ui.js";
import { dueCards, preview, grade, GRADES, nextDue, removeCard, addCard } from "../srs.js";
import { speak, stopAll } from "../speech.js";
import { D, headword, shortGloss, status, removeUserWord } from "../data.js";

const ui = { tab: "review", q: "" };

export function render(root) {
  const due = dueCards().length;
  root.innerHTML = `<div class="page narrow">
    <div class="page-head">
      <div><div class="eyebrow">Wortschatz</div><h1>Flashcards</h1><p>Spaced repetition (FSRS): each word comes back just before you'd forget it.</p></div>
      <div class="seg" id="tabs"><button data-v="review" class="${ui.tab === "review" ? "on" : ""}">Review${due ? ` (${due})` : ""}</button><button data-v="list" class="${ui.tab === "list" ? "on" : ""}">My words (${Object.keys(S.cards).length})</button></div>
    </div>
    <div id="pane"></div>
  </div>`;
  root.querySelector("#tabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.tab = b.dataset.v; render(root); };
  const pane = root.querySelector("#pane");
  return ui.tab === "review" ? reviewPane(pane, root) : listPane(pane);
}

function reviewPane(pane, root) {
  const queue = dueCards().map(([k]) => k);
  const total = queue.length;
  let shown = false;

  const empty = () => {
    const nd = nextDue();
    const suggestions = D.dict.order.filter((w) => status(w) === "new" && shortGloss(w)).slice(0, 10);
    pane.innerHTML = `<div class="card empty">
      <div class="big">✅</div><h2>Nothing due right now</h2>
      <p class="muted" style="margin-top:6px">${nd ? `Next card due in ${relTime(nd)}.` : "Add words while reading: click a word, then choose “Learning”."}</p>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="row between"><div><h2>Common words you haven't marked yet</h2><p class="subtle">From the frequency list. Add the ones you don't know.</p></div><button class="btn sm" id="addall">${icon("plus")} Add all 10</button></div>
      <table class="word-table" style="margin-top:10px"><tbody>${suggestions.map((w) => `<tr><td class="w-de">${esc(headword(w))}</td><td class="muted">${esc(shortGloss(w))}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-k="${esc(w)}" data-a="known">Know it</button> <button class="btn sm primary" data-k="${esc(w)}" data-a="learn">Learn</button></td></tr>`).join("")}</tbody></table>
    </div>`;
    pane.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
      if (b.dataset.a === "known") { S.known[b.dataset.k] = 1; changed(); } else addCard(b.dataset.k);
      b.closest("tr").remove();
    }));
    pane.querySelector("#addall").onclick = () => { suggestions.forEach((w) => addCard(w)); toast("10 cards added"); render(root); };
  };

  const show = () => {
    if (!queue.length) return empty();
    const key = queue[0];
    const c = S.cards[key];
    const pv = preview(c);
    const exHTML = c.ex ? esc(c.ex).replace(new RegExp(esc(key.split(" ").pop()).slice(0, Math.max(3, key.length - 2)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\S*", "i"), (m) => `<mark>${m}</mark>`) : "";
    pane.innerHTML = `
      <div class="row between" style="margin-bottom:10px"><span class="subtle">${total - queue.length + 1} / ${total}</span><div class="progress" style="width:200px"><span style="width:${((total - queue.length) / total) * 100}%"></span></div></div>
      <div class="card flash">
        <div class="front">${esc(c.word)}</div>
        <button class="btn sm ghost" id="say">${icon("volume")} Listen</button>
        <div class="back ${shown ? "" : "hidden"}">
          <div class="meaning">${esc(c.en || "—")}</div>
          ${exHTML ? `<div class="example">${exHTML}${c.exEn ? `<div class="subtle" style="margin-top:4px">${esc(c.exEn)}</div>` : ""}</div>` : ""}
        </div>
        ${shown ? "" : `<button class="btn primary lg" id="reveal">Show answer <kbd>Space</kbd></button>`}
      </div>
      ${shown ? `<div class="grades">
        ${GRADES.map((g, i) => `<button class="g${i + 1}" data-g="${g}">${["Again", "Hard", "Good", "Easy"][i]}<small>${relTime(pv[g])} · <kbd>${i + 1}</kbd></small></button>`).join("")}
      </div>` : ""}`;
    pane.querySelector("#say").onclick = () => speak(c.word);
    pane.querySelector("#reveal")?.addEventListener("click", reveal);
    pane.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => rate(+b.dataset.g)));
  };
  const reveal = () => { shown = true; show(); speak(S.cards[queue[0]].word); };
  const rate = (g) => {
    const key = queue.shift();
    grade(key, g);
    if (g === GRADES[0]) queue.push(key); // "Again": see it once more this session
    shown = false;
    show();
  };
  const onKey = (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key === " " && !shown && queue.length) { e.preventDefault(); reveal(); }
    if (shown && ["1", "2", "3", "4"].includes(e.key)) rate(GRADES[+e.key - 1]);
  };
  document.addEventListener("keydown", onKey);
  show();
  return () => { document.removeEventListener("keydown", onKey); stopAll(); };
}

function listPane(pane) {
  const draw = () => {
    const q = ui.q.toLowerCase();
    const rows = Object.entries(S.cards)
      .filter(([k, c]) => !q || (k + c.word + c.en).toLowerCase().includes(q))
      .sort((a, b) => new Date(b[1].added) - new Date(a[1].added));
    pane.querySelector("#rows").innerHTML = rows.map(([k, c]) => `<tr>
      <td class="w-de">${esc(c.word)}</td><td class="muted">${esc(c.en)}</td>
      <td class="subtle" style="white-space:nowrap">${new Date(c.fsrs.due) <= new Date() ? "due" : "in " + relTime(c.fsrs.due)}</td>
      <td style="text-align:right"><button class="btn sm ghost icon" data-del="${esc(k)}" title="Remove">${icon("trash")}</button></td></tr>`).join("")
      || `<tr><td colspan="4" class="empty">No flashcards yet. Click words while reading and mark them “Learning”.</td></tr>`;
    pane.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { removeCard(b.dataset.del); draw(); }));
    drawDict();
  };
  // words saved from AI explanations (not in the offline dictionary)
  const drawDict = () => {
    const q = ui.q.toLowerCase();
    const words = Object.entries(S.userDict.lemmas)
      .filter(([w, es]) => !q || (w + es[0].gl.join(" ")).toLowerCase().includes(q))
      .sort((a, b) => new Date(b[1][0].added) - new Date(a[1][0].added));
    pane.querySelector("#dict").innerHTML = `
      <div class="row between"><h2>${icon("sparkle")} My dictionary</h2><span class="subtle">${Object.keys(S.userDict.lemmas).length} words</span></div>
      <p class="subtle" style="margin:4px 0 10px">Words that weren't in the offline dictionary, saved when the AI explained them. They work offline in every text.</p>
      <table class="word-table"><tbody>${words.map(([w, es]) => `<tr>
        <td class="w-de">${esc(headword(w))}${es[0].pl ? `<div class="subtle">die ${esc(es[0].pl)}</div>` : ""}</td><td class="muted">${esc(es[0].gl[0])}</td>
        <td class="subtle">${esc(new Date(es[0].added).toLocaleDateString("de-DE"))}</td>
        <td style="text-align:right"><button class="btn sm ghost icon" data-undict="${esc(w)}" title="Remove from my dictionary">${icon("trash")}</button></td></tr>`).join("")
        || `<tr><td colspan="4" class="empty">Nothing yet. When a word has no dictionary entry, click “Explain in this sentence” in the word panel.</td></tr>`}</tbody></table>`;
    pane.querySelectorAll("[data-undict]").forEach((b) => (b.onclick = () => { removeUserWord(b.dataset.undict); drawDict(); }));
  };
  pane.innerHTML = `<div class="card">
    <div class="toolbar"><div class="search"><input class="input" id="q" placeholder="Search your words…" value="${esc(ui.q)}">${icon("search")}</div>
    <span class="subtle">${Object.keys(S.known).length.toLocaleString("de-DE")} words marked known</span></div>
    <table class="word-table"><thead><tr><th>Word</th><th>Meaning</th><th>Next review</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="card" id="dict" style="margin-top:16px"></div>`;
  pane.querySelector("#q").oninput = (e) => { ui.q = e.target.value; draw(); };
  draw();
}
