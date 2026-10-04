// Spaced repetition with FSRS (the algorithm modern Anki uses), via ts-fsrs.
import { fsrs, generatorParameters, createEmptyCard, Rating } from "../vendor/ts-fsrs.mjs";
import { S, changed, track } from "./store.js";
import { headword, shortGloss } from "./data.js";

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, maximum_interval: 365 }));
export const GRADES = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

const revive = (c) => ({ ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined });

export function addCard(lemma, { en, ex, exEn } = {}) {
  if (S.cards[lemma]) return false;
  S.cards[lemma] = {
    word: headword(lemma),
    en: en || shortGloss(lemma) || "",
    ex: ex || "",
    exEn: exEn || "",
    fsrs: createEmptyCard(new Date()),
    added: new Date().toISOString(),
  };
  delete S.known[lemma];
  changed();
  return true;
}

export function removeCard(lemma) {
  delete S.cards[lemma];
  changed();
}

export function dueCards(now = new Date()) {
  return Object.entries(S.cards)
    .filter(([, c]) => new Date(c.fsrs.due) <= now)
    .sort((a, b) => new Date(a[1].fsrs.due) - new Date(b[1].fsrs.due));
}

export function preview(card) {
  const r = scheduler.repeat(revive(card.fsrs), new Date());
  return Object.fromEntries(GRADES.map((g) => [g, r[g].card.due]));
}

export function grade(lemma, rating) {
  const card = S.cards[lemma];
  const r = scheduler.repeat(revive(card.fsrs), new Date());
  card.fsrs = r[rating].card;
  // A word answered "Easy" with a long interval graduates to "known".
  if (rating === Rating.Easy && card.fsrs.scheduled_days >= 60) {
    S.known[lemma] = 1;
  }
  track("reviews");
  changed();
}

export function nextDue() {
  const all = Object.values(S.cards).map((c) => new Date(c.fsrs.due)).sort((a, b) => a - b);
  return all[0] || null;
}
