import { S, changed, track } from "../store.js";
import { esc, icon, toast } from "../ui.js";
import { speak, stopAll, canRecognize, listen } from "../speech.js";
import { wordsHTML, attachWordClicks, closeWord } from "../wordpanel.js";
import * as ai from "../ai.js";

// The conversation survives navigating away (but not a page reload).
const state = { scenario: "free", history: [], items: [] };

export function render(root) {
  if (!ai.hasKey()) {
    root.innerHTML = `<div class="page narrow"><div class="page-head"><div><div class="eyebrow">Gespräch</div><h1>Conversation practice</h1></div></div>
      <div class="card empty"><div class="big">💬</div><h2>Talk to an AI in German</h2>
      <p class="muted" style="margin:8px auto 18px;max-width:440px">The AI role-plays everyday situations at your level, corrects your mistakes gently, and reads its replies aloud. This feature needs an AI provider and API key.</p>
      <a class="btn primary" href="#/settings">${icon("key")} Add API key</a></div></div>`;
    return;
  }

  root.innerHTML = `<div class="chat">
    <div class="row between" style="margin-bottom:12px">
      <div><div class="eyebrow" style="font-size:12.5px;font-weight:650;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)">Gespräch · ${esc(S.level)}</div><h1 style="font-size:26px">Conversation with ${esc(ai.aiName())}</h1></div>
      <label class="toggle"><input type="checkbox" id="auto" ${S.settings.autoSpeakChat ? "checked" : ""}> Read replies aloud</label>
    </div>
    <div class="scenarios" id="sc">${ai.SCENARIOS.map((s) => `<button data-id="${s.id}" class="${s.id === state.scenario ? "on" : ""}">${esc(s.label)}</button>`).join("")}</div>
    <div class="chat-log" id="log"></div>
    <div class="composer">
      <button class="btn icon ghost" id="mic" title="Speak" ${canRecognize ? "" : "disabled"}>${icon("mic")}</button>
      <textarea id="input" rows="1" placeholder="Schreib auf Deutsch… (Enter to send)"></textarea>
      <button class="btn primary icon" id="send" title="Send">${icon("send")}</button>
    </div>
  </div>`;

  const $ = (q) => root.querySelector(q);
  const log = $("#log");
  let pending = false;

  const draw = () => {
    log.innerHTML = state.items.map((it, i) => it.role === "bot" ? `
      <div class="msg bot" data-i="${i}">
        <div class="bubble">${wordsHTML(it.de)}</div>
        <div class="tools"><button class="btn sm ghost" data-act="say">${icon("volume")}</button><button class="btn sm ghost" data-act="en">${icon("translate")} English</button></div>
        <div class="en hidden">${esc(it.en)}</div>
      </div>` : `
      <div class="msg me" data-i="${i}">
        <div class="bubble">${esc(it.text)}</div>
        ${it.fix ? (it.fix.ok ? `<div class="fix good">${icon("check")} Richtig!</div>` : `<div class="fix bad"><div>Better: <b>${esc(it.fix.corrected)}</b></div><div class="muted" style="margin-top:4px">${esc(it.fix.why)}</div></div>`) : ""}
      </div>`).join("") + (pending ? `<div class="msg bot"><div class="bubble typing"><span></span><span></span><span></span></div></div>` : "");
    log.scrollTop = log.scrollHeight;
  };

  attachWordClicks(log, (el) => { const it = state.items[el.closest(".msg").dataset.i]; return { sentence: it.de, translation: it.en }; });
  log.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const it = state.items[b.closest(".msg").dataset.i];
    if (b.dataset.act === "say") speak(it.de);
    if (b.dataset.act === "en") b.closest(".msg").querySelector(".en").classList.toggle("hidden");
  });

  async function turn(userText) {
    pending = true; draw();
    try {
      const r = await ai.chatTurn(state.history, state.scenario, S.level);
      if (userText) {
        const me = [...state.items].reverse().find((x) => x.role === "me");
        if (me) me.fix = r.has_mistake && r.corrected ? { ok: false, corrected: r.corrected, why: r.explanation_en } : { ok: true };
      }
      state.history.push({ role: "assistant", content: r.reply_de });
      state.items.push({ role: "bot", de: r.reply_de, en: r.reply_en });
      track("chat");
      if (S.settings.autoSpeakChat) speak(r.reply_de);
    } catch (err) {
      toast(err.message, "err");
      // drop the unanswered user message so the conversation stays valid
      if (state.history.at(-1)?.role === "user") state.history.pop();
    }
    pending = false; draw();
  }

  function start() {
    stopAll();
    state.history = [{ role: "user", content: "(Bitte beginne das Gespräch mit einer kurzen Begrüßung und einer Frage.)" }];
    state.items = [];
    turn(null);
  }

  async function send() {
    const text = $("#input").value.trim();
    if (!text || pending) return;
    $("#input").value = "";
    state.history.push({ role: "user", content: text });
    state.items.push({ role: "me", text });
    draw();
    await turn(text);
  }

  $("#send").onclick = send;
  $("#input").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  $("#input").oninput = (e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; };
  $("#auto").onchange = (e) => { S.settings.autoSpeakChat = e.target.checked; changed(); };
  $("#sc").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.scenario = b.dataset.id;
    root.querySelectorAll("#sc button").forEach((x) => x.classList.toggle("on", x === b));
    start();
  };

  let rec = null;
  $("#mic").onclick = async () => {
    if (rec) { rec.stop(); return; }
    stopAll();
    $("#mic").classList.add("primary");
    rec = listen({ onInterim: (t) => ($("#input").value = t) });
    try {
      const said = await rec.promise;
      if (said) { $("#input").value = said; send(); }
    } catch (err) { toast(`Speech recognition: ${err.message}`, "err"); }
    rec = null;
    $("#mic").classList.remove("primary");
  };

  if (!state.items.length) start(); else draw();
  return () => { stopAll(); rec?.stop(); closeWord(); };
}
