import { S, changed, track } from "../store.js";
import { esc, icon, toast } from "../ui.js";
import { playSentence, stopAll, canRecognize, listen, startRecording } from "../speech.js";
import { compare, renderDiff, ring } from "../diff.js";
import { wordsHTML, attachWordClicks, closeWord } from "../wordpanel.js";
import { pickSentence, credit } from "./practice-common.js";

const ui = { level: null, mode: "read" };

export function render(root) {
  ui.level ||= S.level;
  let s = null, recording = null, rec = null, myAudio = null;

  root.innerHTML = `<div class="practice">
    <div class="page-head">
      <div><div class="eyebrow">Sprechen</div><h1>Shadowing</h1><p>Listen to a native speaker, then say the sentence yourself. Chrome's speech recognition checks which words came through clearly.</p></div>
    </div>
    ${canRecognize ? "" : `<div class="notice warn" style="margin-bottom:16px">Speech recognition isn't available in this browser. Please open the app in Google Chrome.</div>`}
    <div class="toolbar">
      <div class="seg" id="lv">${["A1", "A2", "B1"].map((l) => `<button data-v="${l}" class="${ui.level === l ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="seg" id="mode"><button data-v="read" class="${ui.mode === "read" ? "on" : ""}">Read & repeat</button><button data-v="listen" class="${ui.mode === "listen" ? "on" : ""}">Listen & repeat (text hidden)</button></div>
    </div>
    <div class="card practice-card">
      <div class="target ${ui.mode === "listen" ? "blurred" : ""}" id="target" title="${ui.mode === "listen" ? "Click to reveal" : ""}"></div>
      <div class="translation" id="en"></div>
      <div class="row" style="justify-content:center;gap:28px">
        <div class="stack" style="align-items:center;gap:6px"><button class="play-big" id="play" title="Listen">${icon("volume")}</button><span class="subtle">1. Listen</span></div>
        <div class="stack" style="align-items:center;gap:6px"><button class="play-big mic-big" id="mic" title="Speak" ${canRecognize ? "" : "disabled"}>${icon("mic")}</button><span class="subtle" id="mic-label">2. Speak</span></div>
      </div>
      <div class="interim" id="interim"></div>
      <div id="result" class="stack" style="align-items:center;width:100%"></div>
      <div class="row" style="justify-content:center">
        <button class="btn hidden" id="mine">${icon("play")} Play my recording</button>
        <button class="btn" id="slow">${icon("replay")} Slower</button>
        <button class="btn primary" id="next">Next sentence ${icon("arrowRight")}</button>
      </div>
      <div class="credit" id="credit"></div>
    </div>
  </div>`;

  const $ = (q) => root.querySelector(q);

  const next = () => {
    stopAll();
    s = pickSentence(ui.level, true);
    $("#target").innerHTML = wordsHTML(s.de);
    $("#en").textContent = s.en;
    $("#result").innerHTML = "";
    $("#interim").textContent = "";
    $("#mine").classList.add("hidden");
    $("#credit").innerHTML = credit(s);
    if (ui.mode === "listen") $("#target").classList.add("blurred");
  };
  attachWordClicks($("#target"), () => ({ sentence: s.de, translation: s.en }));
  $("#target").addEventListener("click", () => $("#target").classList.remove("blurred"), true);

  $("#play").onclick = () => playSentence(s, 1);
  $("#slow").onclick = () => playSentence(s, 0.75);

  $("#mic").onclick = async () => {
    if (rec) { rec.stop(); return; }
    stopAll();
    try {
      recording = await startRecording().catch(() => null);
      rec = listen({ onInterim: (t) => ($("#interim").textContent = t) });
      $("#mic").classList.add("rec");
      $("#mic").innerHTML = icon("stop");
      $("#mic-label").textContent = "Listening… click to stop";
      const said = await rec.promise;
      finish(said);
    } catch (err) {
      toast(err.message === "not-allowed" ? "Microphone permission was denied." : `Speech recognition error: ${err.message}`, "err");
      reset();
    }
  };

  async function finish(said) {
    reset();
    if (recording) {
      myAudio = await recording.stop();
      recording = null;
      $("#mine").classList.remove("hidden");
    }
    if (!said) { $("#interim").textContent = "I didn't catch anything. Try again a bit louder?"; return; }
    $("#target").classList.remove("blurred");
    const { parts, score } = compare(s.de, said);
    S.seenSentences[s.id] = 1;
    track("speak");
    changed();
    $("#interim").textContent = `“${said}”`;
    $("#result").innerHTML = `${ring(score)}<div class="diff">${renderDiff(parts.filter((p) => p.type !== "extra"))}</div>
      <div class="subtle">${score >= 85 ? "Sehr gut! 🎉" : score >= 60 ? "Gut! Listen again to the red words and try once more." : "Listen once more, then repeat slowly and clearly."}</div>`;
  }

  function reset() {
    rec = null;
    $("#mic").classList.remove("rec");
    $("#mic").innerHTML = icon("mic");
    $("#mic-label").textContent = "2. Speak";
  }

  $("#mine").onclick = () => myAudio && new Audio(myAudio).play();
  $("#next").onclick = next;
  $("#lv").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.level = b.dataset.v; render(root); };
  $("#mode").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.mode = b.dataset.v; render(root); };

  next();
  return () => { stopAll(); rec?.stop(); recording?.stop(); closeWord(); };
}
