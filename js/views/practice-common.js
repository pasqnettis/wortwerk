import { S } from "../store.js";
import { D, speakerCredit } from "../data.js";
import { esc } from "../ui.js";

/** Pick a Tatoeba sentence the learner hasn't practised yet. */
export function pickSentence(level, nativeOnly) {
  const pool = D.sentences.filter((s) => s.lv === level && (!nativeOnly || s.a) && !S.seenSentences[s.id]);
  const from = pool.length ? pool : D.sentences.filter((s) => s.lv === level && (!nativeOnly || s.a));
  return from[Math.floor(Math.random() * from.length)];
}

export function credit(s) {
  const sp = s.a ? speakerCredit(s) : null;
  const src = `<a href="https://tatoeba.org/en/sentences/show/${s.id}" target="_blank" rel="noopener">Tatoeba #${s.id}</a> (CC BY 2.0 FR)`;
  return sp
    ? `Sentence: ${src} · Audio: ${esc(sp.name)}, ${esc(sp.license)}`
    : `Sentence: ${src} · Audio: your browser's synthetic voice`;
}
