import { S, changed, exportData, importData, resetAll } from "../store.js";
import { esc, icon, toast, busy } from "../ui.js";
import { germanVoices, speak } from "../speech.js";
import * as ai from "../ai.js";
import { PROVIDERS } from "../llm/providers.js";
import { current } from "../llm/client.js";
import { install, isInstalled, siteVersion } from "../pwa.js";

export function render(root) {
  const voices = germanVoices();
  const c = current();
  const p = c.provider;
  const host = p.api === "anthropic" ? "api.anthropic.com" : (() => { try { return new URL(c.baseUrl).host; } catch { return "its server"; } })();
  root.innerHTML = `<div class="page narrow">
    <div class="page-head"><div><div class="eyebrow">Einstellungen</div><h1>Settings</h1></div></div>
    <div class="settings-grid">

      <div class="card stack">
        <div class="row between"><h2>${icon("sparkle")} AI provider</h2><span class="chip ${ai.hasKey() ? "A1" : ""}">${ai.hasKey() ? "set up" : "not set up"}</span></div>
        <p class="muted">Used for conversation practice, explaining words in context, translations, comprehension questions, writing corrections, extra grammar exercises, daily news and new texts. Any provider below works. Everything else in the app works offline without a key.</p>
        <label class="field">Provider
          <select class="input select" id="prov">${PROVIDERS.map((x) => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
        ${p.note ? `<div class="notice">${esc(p.note)}</div>` : ""}
        <label class="field">API key <span class="hint">${p.keyUrl ? `Get one at <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">${esc(new URL(p.keyUrl).host)}</a>. ` : ""}Each provider's key is stored only in this browser and sent only to that provider (${esc(host)}).</span>
          <div class="row" style="flex-wrap:nowrap"><input class="input" type="password" id="key" value="${esc(c.key)}" placeholder="${esc(p.keyHint || "API key")}" autocomplete="off">
          <button class="btn" id="show" title="Show/hide">${icon("eye")}</button></div></label>
        <label class="field">Model <span class="hint">Type a model id, or load the list of models your key can use.</span>
          <div class="row" style="flex-wrap:nowrap"><input class="input" id="model" list="model-list" value="${esc(c.model)}" placeholder="${esc(p.defaultModel || "model id")}" autocomplete="off" spellcheck="false">
          <button class="btn" id="load">Load models</button></div>
          <datalist id="model-list">${p.models.map((m) => `<option value="${esc(m)}">`).join("")}</datalist></label>
        ${p.api === "openai" ? `<label class="field">Base URL <span class="hint">${p.editableUrl ? "Your server's OpenAI-compatible endpoint, e.g. http://localhost:1234/v1" : "Only change this if you use a proxy or a different server."}</span>
          <input class="input" id="url" value="${esc(c.baseUrl)}" placeholder="https://…/v1" spellcheck="false"></label>` : ""}
        <div class="row"><button class="btn primary" id="save-key">Save</button><button class="btn" id="test">Test connection</button></div>
        <div class="notice">Daily news: ${p.webSearch ? "this provider can search the web itself." : "this provider has no built-in web search, so the daily news is based on Wikipedia's “Current events” page (short factual summaries with links to the original reports)."}${p.id === "anthropic" ? " Opus and Sonnet requests use the API's server-side fallback, so a request the model declines is retried automatically on another model." : ""}</div>
      </div>

      <div class="card stack">
        <h2>📱 App on your phone</h2>
        ${isInstalled()
          ? `<div class="notice">${icon("check")} Wortwerk is running as an installed app. It works offline, except for AI features and native-speaker audio.</div>`
          : install.prompt
            ? `<p class="muted">Install Wortwerk like an app: its own icon, full screen, and it works offline.</p>
               <div class="row"><button class="btn primary" id="install">Install Wortwerk</button></div>`
            : `<p class="muted">Wortwerk can be installed on Android (and iPhone) like an app, with its own icon, full screen and offline use.</p>
               <ul class="muted" style="margin:0;padding-left:18px;display:grid;gap:4px">
                 <li><b>Android (Chrome):</b> open the Wortwerk website → menu ⋮ → <b>Install app</b> (or “Add to Home screen”).</li>
                 <li><b>iPhone (Safari):</b> Share button → <b>Add to Home Screen</b>.</li>
               </ul>
               ${/localhost$|127\.0\.0\.1/.test(location.hostname) ? `<div class="notice">You're using the local copy on this computer. Phones need the hosted (HTTPS) version: see “Put Wortwerk on your phone” in TODO.md / AGENTS.md.</div>` : ""}`}
        <p class="subtle">Your progress is stored separately on each device. Use Export / Import backup below to move it between computer and phone.</p>
        <p class="subtle" id="app-version"></p>
      </div>

      <div class="card stack">
        <h2>${icon("volume")} Voice & reading</h2>
        <label class="field">German voice for read-aloud <span class="hint">On Chrome, “Google Deutsch” usually sounds best. Dictation and shadowing use real native recordings where available.</span>
          <select class="input select" id="voice"><option value="">Automatic</option>${voices.map((v) => `<option ${S.settings.voice === v.name ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
        <label class="field">Speaking rate: <span id="rate-v">${S.settings.rate.toFixed(2)}×</span>
          <input type="range" id="rate" min="0.6" max="1.2" step="0.05" value="${S.settings.rate}"></label>
        <div class="row"><button class="btn" id="try">${icon("play")} Try: „Guten Tag, wie geht es Ihnen?“</button></div>
        <label class="toggle"><input type="checkbox" id="hl" ${S.settings.highlight ? "checked" : ""}> Highlight new and learning words while reading</label>
        <label class="field">My level <span class="hint">Sets the default level for exercises and the AI's language.</span>
          <div class="seg" id="lv">${["A1", "A2", "B1"].map((l) => `<button data-v="${l}" class="${S.level === l ? "on" : ""}">${l}</button>`).join("")}</div></label>
      </div>

      <div class="card stack">
        <h2>Progress data</h2>
        <p class="muted">Your progress is saved in this browser. Export a backup now and then (API keys are not included).</p>
        <div class="row"><button class="btn" id="export">Export backup</button><label class="btn">Import backup<input type="file" id="import" accept=".json" hidden></label><button class="btn" id="reset" style="color:var(--red)">${icon("trash")} Reset everything</button></div>
      </div>

      <div class="card stack">
        <h2>Sources & licences</h2>
        <ul class="muted" style="margin:0;padding-left:18px;display:grid;gap:6px">
          <li><b>Course texts and grammar chapters</b>: written by Claude (Anthropic) for this app and checked with LanguageTool.</li>
          <li><b>Sentences</b>: <a href="https://tatoeba.org" target="_blank" rel="noopener">Tatoeba</a>, CC BY 2.0 FR. <b>Audio</b>: Tatoeba contributors, CC BY 4.0 / CC BY-NC 4.0, streamed from tatoeba.org (each exercise names the speaker).</li>
          <li><b>Encyclopedia texts</b>: <a href="https://miniklexikon.zum.de" target="_blank" rel="noopener">MiniKlexikon</a>, CC BY-SA 4.0.</li>
          <li><b>Dictionary</b>: English Wiktionary, CC BY-SA 4.0, via <a href="https://kaikki.org" target="_blank" rel="noopener">kaikki.org</a>.</li>
          <li><b>Word frequencies</b>: FrequencyWords (OpenSubtitles 2018) by Hermit Dave, CC BY-SA 4.0.</li>
          <li><b>Spaced repetition</b>: ts-fsrs (MIT).</li>
        </ul>
      </div>
    </div>
  </div>`;

  const $ = (q) => root.querySelector(q);
  $("#show").onclick = () => ($("#key").type = $("#key").type === "password" ? "text" : "password");
  const saveKey = () => {
    const st = S.settings;
    st.keys = { ...st.keys, [p.id]: $("#key").value.trim() };
    st.models = { ...st.models, [p.id]: $("#model").value.trim() || p.defaultModel };
    const url = $("#url")?.value.trim();
    st.baseUrls = { ...st.baseUrls };
    if (url && url !== p.baseUrl) st.baseUrls[p.id] = url; else delete st.baseUrls[p.id];
    changed();
  };
  $("#prov").onchange = (e) => { saveKey(); S.settings.provider = e.target.value; changed(); render(root); };
  $("#save-key").onclick = () => { saveKey(); toast("Saved"); render(root); };
  $("#model").onchange = saveKey;
  $("#load").onclick = async (e) => {
    saveKey();
    const b = e.currentTarget;
    busy(b, true, " Loading…");
    try {
      const ids = await ai.listModels();
      $("#model-list").innerHTML = ids.map((m) => `<option value="${esc(m)}">`).join("");
      toast(`${ids.length} models available. Click the model field to choose.`);
    } catch (err) { toast(err.message, "err"); }
    busy(b, false);
  };
  $("#test").onclick = async (e) => {
    saveKey();
    const b = e.currentTarget;
    busy(b, true, " Testing…");
    try { const answer = await ai.testKey(); toast(`✓ ${ai.aiLabel()} answered: ${answer.slice(0, 40)}`); render(root); }
    catch (err) { toast(err.message, "err"); busy(b, false); }
  };
  siteVersion().then((v) => {
    const el = $("#app-version");
    if (el) el.textContent = v ? `App version: ${v.replace(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d).*/, "$3.$2.$1 $4:$5")}` : "App version: local development copy";
  });
  $("#install")?.addEventListener("click", async () => {
    install.prompt.prompt();
    await install.prompt.userChoice;
    install.prompt = null;
    render(root);
  });
  $("#voice").onchange = (e) => { S.settings.voice = e.target.value; changed(); };
  $("#rate").oninput = (e) => { S.settings.rate = +e.target.value; $("#rate-v").textContent = `${S.settings.rate.toFixed(2)}×`; changed(); };
  $("#try").onclick = () => speak("Guten Tag, wie geht es Ihnen?");
  $("#hl").onchange = (e) => { S.settings.highlight = e.target.checked; changed(); };
  $("#lv").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; S.level = b.dataset.v; changed(); render(root); };
  $("#export").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportData()], { type: "application/json" }));
    a.download = `wortwerk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $("#import").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { importData(await f.text()); toast("Backup restored"); render(root); } catch { toast("That file isn't a valid backup", "err"); }
  };
  $("#reset").onclick = () => { if (confirm("Delete all progress, flashcards and settings in this browser?")) resetAll(); };

  // voices load asynchronously in Chrome
  if (!voices.length) setTimeout(() => germanVoices().length && location.hash === "#/settings" && render(root), 600);
}
