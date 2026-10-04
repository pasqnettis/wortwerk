// Loads the corpus (built by pipeline/build.py) and provides dictionary lookup.
import { S, changed } from "./store.js";

export const D = { texts: [], sentences: [], speakers: [], dict: null, grammar: [] };

export async function loadAll() {
  const get = (f) => fetch(`data/${f}`).then((r) => {
    if (!r.ok) throw new Error(`Could not load data/${f}`);
    return r.json();
  });
  const [texts, sents, dict] = await Promise.all([get("texts.json"), get("sentences.json"), get("dict.json")]);
  D.texts = texts;
  D.sentences = sents.sentences;
  D.speakers = sents.speakers;
  D.dict = dict;
  D.grammar = await fetch("data/grammar.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
}

export function newsTexts() {
  return Object.keys(S.news).sort().reverse().flatMap((d) => S.news[d].texts);
}

export function allTexts() {
  return [...newsTexts(), ...S.myTexts, ...D.texts];
}

export function textById(id) {
  return allTexts().find((t) => t.id === id);
}

// ------------------------------------------------------------ tokenizing
const WORD = /([A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*)/;

/** Split a sentence into word / non-word pieces, preserving everything. */
export function tokenize(str) {
  return String(str).split(WORD).filter((p) => p !== "").map((p) => ({ word: WORD.test(p) && /^[A-Za-zÄÖÜäöüß]/.test(p), s: p }));
}

export function words(str) {
  return tokenize(str).filter((t) => t.word).map((t) => t.s);
}

// ------------------------------------------------------------ dictionary
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const cache = new Map();
let rank = null;

/**
 * Candidate lemmas (dictionary headwords) for a surface word, best first.
 * `initial`: the word starts a sentence, so its capital letter tells us nothing.
 * Elsewhere a capitalised German word is a noun: "Stunden" -> Stunde, not the verb "stunden".
 */
export function lemmasFor(word, initial = true) {
  const ck = word + (initial ? "|i" : "");
  if (cache.has(ck)) return cache.get(ck);
  const { lemmas, forms } = D.dict;
  const user = S.userDict;
  const has = (l) => lemmas[l] || user.lemmas[l];
  rank ||= new Map(D.dict.order.map((w, i) => [w, i]));
  const byRank = (a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9);
  const collect = (variants) => {
    const out = [];
    for (const v of variants) {
      if (has(v) && !out.includes(v)) out.push(v);
      for (const f of [...(forms[v] || []), ...(user.forms[v] || [])]) if (has(f) && !out.includes(f)) out.push(f);
    }
    return out.sort(byRank);
  };
  const variants = [word, word.toLowerCase(), cap(word.toLowerCase())];
  if (word.includes("-")) {
    // MiniKlexikon writes compounds as "Säuge-Tiere" -> "Säugetiere"
    const [first, ...rest] = word.split("-");
    const joined = first + rest.map((r) => r.toLowerCase()).join("");
    variants.push(joined, cap(joined));
  }
  let out = collect(variants); // most frequent reading first ("Aber" at the start = the conjunction)
  if (!initial && /^[A-ZÄÖÜ]/.test(word)) {
    const exact = collect([word]);
    out = [...exact, ...out.filter((x) => !exact.includes(x))];
  }
  cache.set(ck, out);
  return out;
}

/** Stable key used for known-word tracking: the best lemma, or the lowercased word. */
export function keyFor(word, initial = true) {
  const l = lemmasFor(word, initial);
  return l.length ? l[0] : word.toLowerCase();
}

/** Words of a sentence with a flag for "starts a sentence". */
export function wordTokens(sentence) {
  const out = [];
  let initial = true;
  for (const t of tokenize(sentence)) {
    if (t.word) { out.push({ w: t.s, initial }); initial = false; }
    else if (/[.!?:;„“"–]/.test(t.s)) initial = true;
  }
  return out;
}

export function entry(lemma) {
  return D.dict.lemmas[lemma] || S.userDict.lemmas[lemma] || [];
}

// ------------------------------------------------------------ personal dictionary (words saved from AI)
const GENDERS = { m: "m", f: "f", n: "n", der: "m", die: "f", das: "n" };

/**
 * Save a word the offline dictionary doesn't know, from an AI explanation.
 * `surface` is the word as it appeared in the text; `oldKey` its previous status key,
 * so "known"/flashcard status moves over to the new dictionary form.
 */
export function saveUserWord(surface, { headword, pos, gender, plural, meaning }, oldKey) {
  const lemma = String(headword || "").replace(/^(der|die|das)\s+/i, "").trim();
  if (!lemma || !meaning) return null;
  const e = { p: pos || "other", gl: [meaning], ai: true, added: new Date().toISOString() };
  if (GENDERS[gender]) e.g = GENDERS[gender];
  if (plural && plural !== "-") e.pl = plural.replace(/^die\s+/i, "");
  S.userDict.lemmas[lemma] = [e];
  if (surface !== lemma) S.userDict.forms[surface] = [lemma];
  if (oldKey && oldKey !== lemma) {
    if (S.known[oldKey]) { S.known[lemma] = 1; delete S.known[oldKey]; }
    if (S.cards[oldKey] && !S.cards[lemma]) { S.cards[lemma] = S.cards[oldKey]; delete S.cards[oldKey]; }
  }
  cache.clear();
  changed();
  return lemma;
}

export function removeUserWord(lemma) {
  delete S.userDict.lemmas[lemma];
  for (const [form, targets] of Object.entries(S.userDict.forms)) if (targets.includes(lemma)) delete S.userDict.forms[form];
  cache.clear();
  changed();
}

export const ARTICLE = { m: "der", f: "die", n: "das" };
export const POS_DE = {
  noun: "Nomen", verb: "Verb", adj: "Adjektiv", adv: "Adverb", name: "Name", pron: "Pronomen",
  prep: "Präposition", conj: "Konjunktion", num: "Zahl", intj: "Interjektion", det: "Artikel",
  article: "Artikel", particle: "Partikel", phrase: "Ausdruck", prep_phrase: "Ausdruck", contraction: "Kurzform",
};

/** "der Hund", "gehen", ... — headword with article for nouns. */
export function headword(lemma) {
  const e = entry(lemma).find((x) => x.p === "noun" && x.g);
  return e ? `${ARTICLE[e.g]} ${lemma}` : lemma;
}

/** Short English gloss suitable for a flashcard. */
export function shortGloss(lemma) {
  const e = entry(lemma)[0];
  if (!e) return "";
  const clean = (g) => g.replace(/\s*\(.*?\)\s*/g, " ").split(/;/)[0].trim();
  const out = [];
  for (const g of e.gl.map(clean)) {
    if (g && !out.includes(g) && (out.join("; ") + g).length < 48) out.push(g);
  }
  return out.join("; ") || clean(e.gl[0]);
}

// ------------------------------------------------------------ learner state
export function status(key) {
  if (S.known[key]) return "known";
  if (S.cards[key]) return "learning";
  return "new";
}

/** Share of a text's dictionary words the learner already knows (0..1). */
export function coverage(text) {
  let total = 0, known = 0;
  for (const p of text.paragraphs) for (const s of p) for (const { w, initial } of wordTokens(s.de)) {
    if (!lemmasFor(w, initial).length) continue; // names / unknown words don't count
    total++;
    if (S.known[keyFor(w, initial)]) known++;
  }
  return total ? known / total : 0;
}

export function newWordsIn(text) {
  const set = new Set();
  for (const p of text.paragraphs) for (const s of p) for (const { w, initial } of wordTokens(s.de)) {
    const k = keyFor(w, initial);
    if (status(k) === "new") set.add(k);
  }
  return [...set];
}

export function plainText(text) {
  return text.paragraphs.map((p) => p.map((s) => (s.speaker ? `${text.speakers?.[s.speaker] || s.speaker}: ` : "") + s.de).join(" ")).join("\n\n");
}

export function speakerCredit(sentence) {
  const sp = D.speakers[sentence.sp];
  return sp ? sp : null;
}
