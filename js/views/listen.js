import { S, changed, track } from "../store.js";
import { esc, icon } from "../ui.js";
import { playSentence, stopAll } from "../speech.js";
import { compare, renderDiff, ring } from "../diff.js";
import { wordsHTML, attachWordClicks, closeWord } from "../wordpanel.js";
import { pickSentence, credit } from "./practice-common.js";

const ui = { level: null, native: true, rate: 1, session: { n: 0, sum: 0 } };

export function render(root) {
  ui.level ||= S.level;
  let s = null, checked = false;

  root.innerHTML = `<div class="practice">
    <div class="page-head">
      <div><div class="eyebrow">Hören</div><h1>Dictation</h1><p>Listen, then type exactly what you hear. It trains your ear and your spelling at the same time.</p></div>
    </div>
    <div class="toolbar">
      <div class="seg" id="lv">${["A1", "A2", "B1"].map((l) => `<button data-v="${l}" class="${ui.level === l ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="seg" id="rate"><button data-v="0.75" class="${ui.rate === 0.75 ? "on" : ""}">0.75×</button><button data-v="1" class="${ui.rate === 1 ? "on" : ""}">1×</button></div>
      <label class="toggle"><input type="checkbox" id="native" ${ui.native ? "checked" : ""}> Native speakers only</label>
      <span style="margin-left:auto" class="subtle" id="sess"></span>
    </div>
    <div class="card practice-card" id="card">
      <button class="play-big" id="play" title="Play (Ctrl+Space)">${icon("play")}</button>
      <div class="row" style="justify-content:center">
        <button class="btn sm ghost" id="replay">${icon("replay")} Repeat</button>
        <button class="btn sm ghost" id="hint">${icon("translate")} English hint</button>
      </div>
      <div class="translation hidden" id="hint-text"></div>
      <input class="input dict-input" id="answer" placeholder="Type what you hear…" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div id="result" class="stack" style="align-items:center;width:100%"></div>
      <div class="row" style="justify-content:center">
        <button class="btn primary lg" id="check">Check <kbd>Enter</kbd></button>
        <button class="btn lg" id="skip">Skip</button>
      </div>
      <div class="credit" id="credit"></div>
    </div>
    <p class="subtle" style="margin-top:14px;text-align:center">Tip: umlauts can be typed as ae/oe/ue. Small slips count as "almost".</p>
  </div>`;

  const $ = (q) => root.querySelector(q);
  const sess = () => ($("#sess").textContent = ui.session.n ? `This session: ${ui.session.n} sentences · avg ${Math.round(ui.session.sum / ui.session.n)}%` : "");
  sess();

  const play = async () => {
    const btn = $("#play");
    btn.classList.add("playing");
    btn.innerHTML = icon("volume");
    await playSentence(s, ui.rate);
    if (!root.contains(btn)) return; // the learner left this screen while audio played
    btn.classList.remove("playing");
    btn.innerHTML = icon("play");
    $("#answer").focus();
  };

  const next = () => {
    stopAll();
    s = pickSentence(ui.level, ui.native);
    checked = false;
    $("#answer").value = ""; $("#answer").disabled = false;
    $("#result").innerHTML = "";
    $("#hint-text").classList.add("hidden");
    $("#hint-text").textContent = s.en;
    $("#credit").innerHTML = credit(s);
    $("#check").innerHTML = `Check <kbd>Enter</kbd>`;
    $("#skip").classList.remove("hidden");
    $("#answer").focus();
    play();
  };

  const check = () => {
    if (checked) return next();
    const { parts, score } = compare(s.de, $("#answer").value);
    checked = true;
    S.seenSentences[s.id] = 1;
    ui.session.n++; ui.session.sum += score;
    track("dictation");
    changed();
    sess();
    $("#answer").disabled = true;
    $("#result").innerHTML = `
      ${ring(score)}
      <div class="diff">${renderDiff(parts)}</div>
      <div class="target serif" style="font-size:19px" id="full">${wordsHTML(s.de)}</div>
      <div class="translation">${esc(s.en)}</div>
      <div class="subtle">Click any word above to look it up or add it to your flashcards.</div>`;
    attachWordClicks($("#full"), () => ({ sentence: s.de, translation: s.en }));
    $("#check").innerHTML = `Next ${icon("arrowRight")} <kbd>Enter</kbd>`;
    $("#skip").classList.add("hidden");
  };

  $("#play").onclick = play;
  $("#replay").onclick = play;
  $("#hint").onclick = () => $("#hint-text").classList.toggle("hidden");
  $("#check").onclick = check;
  $("#skip").onclick = next;
  $("#answer").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } };
  const onKey = (e) => {
    if (e.key === "Enter" && checked && document.activeElement !== $("#answer")) { e.preventDefault(); next(); }
    if (e.key === " " && e.ctrlKey) { e.preventDefault(); play(); }
  };
  document.addEventListener("keydown", onKey);
  $("#lv").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.level = b.dataset.v; render(root); };
  $("#rate").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.rate = +b.dataset.v; root.querySelectorAll("#rate button").forEach((x) => x.classList.toggle("on", x === b)); };
  $("#native").onchange = (e) => { ui.native = e.target.checked; next(); };

  next();
  return () => { stopAll(); document.removeEventListener("keydown", onKey); closeWord(); };
}
