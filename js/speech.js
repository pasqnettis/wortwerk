// Text-to-speech (browser voices), native audio playback, and speech recognition.
import { S } from "./store.js";

// ------------------------------------------------------------ TTS
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("de"));
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

export function germanVoices() {
  if (!voices.length) loadVoices();
  return voices;
}

function pickVoice() {
  const vs = germanVoices();
  return vs.find((v) => v.name === S.settings.voice)
    || vs.find((v) => /google/i.test(v.name) && v.lang === "de-DE")
    || vs.find((v) => /(anna|petra|helena|katja|markus|yannick)/i.test(v.name))
    || vs.find((v) => v.lang === "de-DE")
    || vs[0];
}

/** Speak German text. Resolves when finished (or cancelled). */
export function speak(text, { rate } = {}) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = rate ?? S.settings.rate;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopAll() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (current) { current.pause(); current = null; }
}

// ------------------------------------------------------------ native audio (Tatoeba)
let current = null;
export const audioUrl = (aid) => `https://tatoeba.org/en/audio/download/${aid}`;

/** Play a Tatoeba recording; falls back to TTS if it fails. */
export function playSentence(sentence, rate = 1) {
  stopAll();
  if (!sentence.a) return speak(sentence.de, { rate: S.settings.rate * rate });
  return new Promise((resolve) => {
    const a = new Audio(audioUrl(sentence.a));
    a.playbackRate = rate;
    a.preservesPitch = true;
    current = a;
    a.onended = () => resolve();
    a.onerror = () => { speak(sentence.de, { rate: S.settings.rate * rate }).then(resolve); };
    a.play().catch(() => speak(sentence.de, { rate: S.settings.rate * rate }).then(resolve));
  });
}

// ------------------------------------------------------------ speech recognition (Chrome)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canRecognize = !!SR;

/**
 * Listen for one German utterance. Returns { promise, stop }.
 * onInterim receives partial transcripts while speaking.
 */
export function listen({ onInterim } = {}) {
  const rec = new SR();
  rec.lang = "de-DE";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  const promise = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      onInterim?.((finalText + " " + interim).trim());
    };
    rec.onerror = (e) => (e.error === "no-speech" || e.error === "aborted" ? resolve(finalText.trim()) : reject(new Error(e.error)));
    rec.onend = () => resolve(finalText.trim());
  });
  rec.start();
  return { promise, stop: () => rec.stop() };
}

// ------------------------------------------------------------ recording own voice
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })));
      };
      rec.stop();
    }),
  };
}
