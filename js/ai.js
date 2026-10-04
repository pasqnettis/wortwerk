// Every AI feature of the app: the prompts and the JSON shapes they return.
// Which provider/model answers is decided in llm/client.js (Settings → AI provider),
// so nothing here is specific to one company's API.
import { S } from "./store.js";
import { complete, searchWeb, isConfigured, aiName, aiLabel, listModels } from "./llm/client.js";
import { wikipediaNews, briefFromItems } from "./news-source.js";

export { isConfigured as hasKey, aiName, aiLabel, listModels };

/**
 * One request. `schema` (JSON Schema) returns parsed JSON in that shape.
 * `effort` (low/medium) only matters for models that support a thinking-effort setting.
 */
const ask = (opts) => complete(opts);

const LEVEL_HINT = {
  A1: "CEFR A1: present tense, very common words, short main clauses (max ~10 words), occasional Perfekt with haben/sein, modal verbs ok.",
  A2: "CEFR A2: Perfekt for the past, weil/dass/wenn clauses, separable verbs, everyday vocabulary, sentences up to ~14 words.",
  B1: "CEFR B1: Präteritum and Perfekt, relative clauses, some passive, broader vocabulary, sentences up to ~20 words.",
};

const obj = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const str = { type: "string" };

// ------------------------------------------------------------ 1. explain a word in context
export function explainWord(word, sentence) {
  return ask({
    system: `You are a patient German tutor for an English-speaking learner at level ${S.level}. Explain briefly and concretely, in English. German examples must be simple and correct.`,
    messages: [{
      role: "user",
      content: `Word: "${word}"\nSentence: "${sentence}"\n\nExplain this word as it is used in this sentence. If it is part of a separable verb, a fixed expression, or an inflected form, say so and give the dictionary form.`,
    }],
    schema: obj({
      lemma: { ...str, description: "Dictionary form; nouns with article (e.g. 'der Hund', 'aufstehen')" },
      headword: { ...str, description: "Dictionary form WITHOUT article, as in a dictionary (e.g. 'Hund', 'aufstehen', 'schnell')" },
      pos: { type: "string", enum: ["noun", "verb", "adj", "adv", "pron", "prep", "conj", "num", "intj", "phrase", "name", "other"] },
      gender: { type: "string", enum: ["m", "f", "n", ""], description: "Grammatical gender for nouns, else empty" },
      plural: { ...str, description: "Plural form for nouns without article (e.g. 'Hunde'), else empty" },
      meaning: { ...str, description: "English meaning in this sentence, a few words" },
      explanation: { ...str, description: "1-3 short sentences on grammar/usage in this sentence" },
      example_de: { ...str, description: "A new simple German example sentence" },
      example_en: str,
    }),
  });
}

// ------------------------------------------------------------ 2. translate a sentence
export async function translate(sentence, context = "") {
  const r = await ask({
    system: "Translate German to natural English. Keep the meaning exact. Output only the translation.",
    messages: [{ role: "user", content: (context ? `Context: ${context}\n\n` : "") + `Translate: ${sentence}` }],
    schema: obj({ translation: str }),
  });
  return r.translation;
}

// ------------------------------------------------------------ 3. comprehension questions for any text
export async function makeQuestions(text, level) {
  const r = await ask({
    system: `You write reading-comprehension questions for German learners (${level}). Questions and options are in simple German.`,
    messages: [{ role: "user", content: `Write 4 multiple-choice questions (3 options each, exactly one correct) about this text. Vary the position of the correct answer.\n\n${text}` }],
    schema: obj({
      questions: {
        type: "array",
        items: obj({ q: str, options: { type: "array", items: str }, answer: { type: "integer", description: "0-based index of the correct option" } }),
      },
    }),
  });
  return r.questions;
}

// ------------------------------------------------------------ 4. generate a new graded text
const SENT = obj({ de: str, en: str });
export async function generateText({ level, topic, targetWords = [], length = "medium", kind = "text" }) {
  const words = targetWords.length ? `\nNaturally include as many of these words the learner is studying as fit: ${targetWords.join(", ")}.` : "";
  const len = { short: "80-120", medium: "140-200", long: "220-300" }[length];
  const t = await ask({
    effort: "medium",
    maxTokens: 16000,
    system: "You write graded reading material for German learners. Your German is flawless standard Hochdeutsch: check every article, case ending, adjective ending, verb position and spelling (ß, umlauts). The English translations are natural and faithful.",
    messages: [{
      role: "user",
      content: `Write a ${kind === "dialogue" ? "realistic dialogue between two people" : "short story or text"} about: ${topic}.
Level: ${LEVEL_HINT[level]}
Length: ${len} words, in 2-4 paragraphs${kind === "dialogue" ? " (put the whole dialogue in one paragraph, one turn per sentence object, speaker 'A' or 'B')" : ""}.${words}
Then add 4 multiple-choice comprehension questions in simple German (3 options, vary the correct position) and 6-10 key vocabulary items (nouns with article).`,
    }],
    schema: obj({
      title: str,
      title_en: str,
      topic: { ...str, description: "1-2 word German topic label" },
      speakers: obj({ A: str, B: str }),
      paragraphs: { type: "array", items: { type: "array", items: kind === "dialogue" ? obj({ speaker: { type: "string", enum: ["A", "B"] }, de: str, en: str }) : SENT } },
      questions: { type: "array", items: obj({ q: str, options: { type: "array", items: str }, answer: { type: "integer" } }) },
      vocab: { type: "array", items: obj({ de: str, en: str }) },
    }),
  });
  return {
    ...t,
    id: "my-" + Date.now().toString(36),
    level, kind, source: "ai",
    speakers: kind === "dialogue" ? t.speakers : undefined,
    created: new Date().toISOString(),
  };
}

// ------------------------------------------------------------ 5. conversation partner
export const SCENARIOS = [
  { id: "free", label: "Freies Gespräch", prompt: "a friendly casual chat; ask the learner about their day, hobbies, work and plans" },
  { id: "intro", label: "Sich vorstellen", prompt: "meeting the learner for the first time at a language café; ask name, origin, job, hobbies" },
  { id: "cafe", label: "Im Café", prompt: "you are a waiter/waitress in a Berlin café; the learner is the customer ordering and paying" },
  { id: "weg", label: "Nach dem Weg fragen", prompt: "you are a local in Munich; the learner asks for directions to sights, the station, a pharmacy" },
  { id: "arzt", label: "Beim Arzt", prompt: "you are a doctor's receptionist then the doctor; the learner describes symptoms" },
  { id: "wochenende", label: "Wochenende planen", prompt: "you are a friend planning the weekend together with the learner" },
  { id: "wohnung", label: "Wohnungssuche", prompt: "you are a landlord showing a flat; the learner asks questions about rent, rooms, move-in date" },
];

const CHAT_SCHEMA = obj({
  reply_de: { ...str, description: "Your reply in German, in role. 1-3 short sentences, ending with a question that keeps the conversation going." },
  reply_en: { ...str, description: "English translation of reply_de" },
  has_mistake: { type: "boolean", description: "true if the learner's last message had a grammar, spelling or word-choice mistake" },
  corrected: { ...str, description: "Learner's last message rewritten in correct, natural German (empty string if none or no mistakes)" },
  explanation_en: { ...str, description: "If has_mistake: one or two short English sentences explaining the main mistake(s). Otherwise empty string." },
});

/** history: [{ role: "user"|"assistant", content: string }] (assistant content = reply_de only). */
export function chatTurn(history, scenarioId, level) {
  const sc = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
  return ask({
    system: `You are a warm, encouraging German conversation partner for a learner at ${level}. Role-play: ${sc.prompt}.
Speak only German in reply_de, strictly at the learner's level: ${LEVEL_HINT[level]}
Keep replies short (1-3 sentences) and always end by asking something, so the learner has to answer.
The learner may type or speak (speech-to-text): ignore missing punctuation/capitalisation caused by dictation, but do correct real grammar, word order, gender/case and vocabulary mistakes.
If the learner writes in English or asks for help, help briefly and continue in German.`,
    messages: history,
    schema: CHAT_SCHEMA,
  });
}

// ------------------------------------------------------------ 6. check one written sentence
/** Is the learner's German sentence a correct way to say `english`? `reference` is one known-good answer. */
export function checkSentence({ english, reference, attempt, level }) {
  return ask({
    system: `You are a precise but encouraging German teacher for a learner at ${level}. Judge German sentences written by the learner. Accept every grammatical, natural rendering of the meaning, not just the reference. Explanations in short, plain English.`,
    messages: [{
      role: "user",
      content: `English: ${english}\nReference German: ${reference}\nLearner wrote: ${attempt}\n\nIs the learner's sentence correct German with the same meaning?`,
    }],
    schema: obj({
      verdict: { type: "string", enum: ["correct", "almost", "wrong"], description: "correct = fully right (any valid wording); almost = small slip (one ending, spelling, umlaut); wrong = grammar or meaning problem" },
      corrected: { ...str, description: "The learner's sentence minimally corrected (same as theirs if correct)" },
      explanation: { ...str, description: "1-2 sentences: what was wrong and the rule, or why the alternative is also fine" },
    }),
  });
}

// ------------------------------------------------------------ 7. review free writing
const ERROR_TYPES = ["Grammatik", "Wortstellung", "Rechtschreibung", "Wortwahl", "Artikel/Kasus", "Verbform", "Zeichensetzung"];

export function reviewWriting({ task, text, level }) {
  return ask({
    effort: "medium",
    maxTokens: 16000,
    system: `You are an experienced, encouraging German teacher correcting a short text by a learner at ${level}. Be precise: find every real mistake (grammar, case, gender, word order, verb forms, spelling, word choice), but don't flag stylistic choices that are correct. Explanations are in short, plain English and name the rule. The improved version stays close to the learner's ideas and is only slightly above their level.`,
    messages: [{ role: "user", content: `Task: ${task}\n\nLearner's text:\n${text}` }],
    schema: obj({
      summary: { ...str, description: "2-3 encouraging sentences in English: what went well, the main thing to work on" },
      score: { type: "integer", description: "0-100: accuracy and task completion for this level" },
      errors: {
        type: "array",
        description: "Every mistake, in order of appearance",
        items: obj({
          original: { ...str, description: "The exact erroneous fragment copied verbatim from the learner's text (a few words)" },
          correction: { ...str, description: "The corrected fragment" },
          type: { type: "string", enum: ERROR_TYPES },
          explanation: { ...str, description: "One short sentence naming the rule" },
        }),
      },
      corrected_text: { ...str, description: "The learner's whole text with only the mistakes fixed" },
      improved_text: { ...str, description: "A more natural version, slightly above the learner's level, keeping their content" },
      useful_phrases: {
        type: "array",
        description: "3-5 useful words or phrases for this task the learner could use next time",
        items: obj({ de: str, en: str }),
      },
    }),
  });
}

// ------------------------------------------------------------ 8. grammar: extra exercises + questions
const chapterBrief = (ch) => `Chapter ${ch.num} (${ch.level}): ${ch.title} (${ch.title_en}). Key points: ${ch.key_points.join(" | ")}`;

export async function grammarExercises(ch, n = 8) {
  const r = await ask({
    effort: "medium",
    maxTokens: 16000,
    system: `You write grammar exercises for a German course at level ${ch.level}. Every German sentence is flawless standard German using vocabulary up to ${ch.level}. Exactly one answer is correct for choice items; gap items list every acceptable fill-in. Explanations are short, plain English.`,
    messages: [{
      role: "user",
      content: `${chapterBrief(ch)}

Write ${n} NEW exercises on this chapter's topic (different from typical textbook examples), mixed types:
- "choice": q has exactly one gap "___", 3 options, answer = 0-based index (vary it).
- "gap": q has one gap "___" and ends with a hint in brackets, e.g. "(fahren)"; answers = all acceptable fill-ins.
- "order": sentence = the full correct sentence with punctuation; words = its words without punctuation, scrambled; accept = other correct orders (may be empty).
Unused fields: empty string / empty array / 0.`,
    }],
    schema: obj({
      exercises: {
        type: "array",
        items: obj({
          type: { type: "string", enum: ["choice", "gap", "order"] },
          q: str, en: { ...str, description: "English translation of the full sentence" },
          options: { type: "array", items: str }, answer: { type: "integer" },
          answers: { type: "array", items: str },
          words: { type: "array", items: str }, sentence: str, accept: { type: "array", items: str },
          explain: str,
        }),
      },
    }),
  });
  return r.exercises.map((e) => (e.type === "order" ? { ...e, answer: e.sentence } : e));
}

export function askGrammar(ch, question) {
  return ask({
    system: `You are a patient German teacher. The learner is studying a ${ch.level} grammar chapter and asks a question. Answer in short, plain English (max ~150 words), with simple correct German examples. Use **bold** for key forms. If the question goes beyond ${ch.level}, answer briefly and say it's a later topic.`,
    messages: [{ role: "user", content: `${chapterBrief(ch)}\n\nMy question: ${question}` }],
    schema: obj({
      answer: { ...str, description: "The explanation; paragraphs separated by blank lines, bullet lines start with '- '" },
      examples: { type: "array", items: obj({ de: str, en: str }) },
    }),
  });
}

// ------------------------------------------------------------ 9. daily news
export const NEWS_REGIONS = ["Italien", "Deutschland", "Europa", "KI"];

const NEWS_PRIORITIES = `Priorities: news from Italy and Germany first, then Europe/the EU, or important news in artificial intelligence. Include at least one story from Italy or Germany, and one AI story if there is significant AI news; make the three stories about different topics. Prefer stories that are important and understandable (politics, economy, science, technology, society, culture, sport). Avoid graphic violence or gruesome crime details.`;

/**
 * Step 1: gather today's news.
 * - Providers with web search (Claude, OpenRouter): the AI searches and writes a brief on 3 stories.
 * - Everyone else, or if the search fails: Wikipedia's "Current events" entries of today and
 *   yesterday; the AI picks the 3 stories itself in step 2.
 * Returns { brief, sources, preselected, via }.
 */
async function gatherNews(dateLabel) {
  try {
    const web = await searchWeb(`Today is ${dateLabel}. Search the web for the most relevant news of the last 24-48 hours and pick exactly 3 stories for a learner of German.

${NEWS_PRIORITIES}

For each story write:
STORY n
Region: one of Italien / Deutschland / Europa / KI
Headline: ...
Summary: 5-8 factual sentences in English (who, what, where, when, key numbers), based only on your search results.
Sources: the URLs you used.`);
    if (web && web.text.trim()) return { brief: web.text, sources: web.sources, preselected: true, via: "web" };
  } catch (e) {
    console.warn("Web search failed, using Wikipedia instead:", e);
  }
  const items = await wikipediaNews();
  return { brief: briefFromItems(items), sources: items.flatMap((i) => i.sources), preselected: false, via: "wikipedia" };
}

/** Step 2: turn the news into 3 graded reading texts (same format as the course texts). */
export async function dailyNews({ dateKey, dateLabel, level, onStep }) {
  onStep?.(1);
  const { brief, sources, preselected, via } = await gatherNews(dateLabel);
  onStep?.(2);
  const lv = level === "A1" ? "A1-A2" : level === "A2" ? "A2" : "A2-B1";
  const r = await ask({
    effort: "medium",
    maxTokens: 24000,
    system: "You turn news into graded reading texts for German learners. Your German is flawless standard Hochdeutsch: check every article, case ending, verb position and spelling. Stay strictly factual: use only facts from the news given to you, keep names, places and numbers correct, and never invent quotes or details. The English translations are natural and faithful.",
    messages: [{
      role: "user",
      content: `${preselected ? `News brief (${dateLabel}):` : `Today's news items from Wikipedia's "Current events" (${dateLabel}). Pick exactly 3 stories.\n${NEWS_PRIORITIES}\nIf there is no Italian, German or AI story, pick the most relevant European or world news.`}

${brief}

Write one German reading text for each of the 3 stories at level ${lv}:
- Mostly present tense; Perfekt for past events. Short sentences (max ~12 words). Everyday words; explain difficult terms in simple words (e.g. "die Inflation – die Preise steigen").
- 110-170 words in 3 short paragraphs. A simple, clear German title.
- Each sentence with an English translation.
- 4 multiple-choice comprehension questions in simple German (3 options, vary the correct position).
- 6-10 key words (nouns with article) with English meaning.
- region: Italien, Deutschland, Europa or KI (KI = artificial intelligence).
- level: "A1" if the text really is A1, otherwise "A2".
- source_urls: the URLs given above that this story is based on.`,
    }],
    schema: obj({
      texts: {
        type: "array",
        items: obj({
          region: { type: "string", enum: NEWS_REGIONS },
          level: { type: "string", enum: ["A1", "A2"] },
          title: str,
          title_en: str,
          paragraphs: { type: "array", items: { type: "array", items: obj({ de: str, en: str }) } },
          questions: { type: "array", items: obj({ q: str, options: { type: "array", items: str }, answer: { type: "integer" } }) },
          vocab: { type: "array", items: obj({ de: str, en: str }) },
          source_urls: { type: "array", items: str },
        }),
      },
    }),
  });
  const known = new Map(sources.map((s) => [s.url, s.title]));
  const texts = r.texts.filter((t) => t.title && t.paragraphs.flat().length).slice(0, 3);
  if (!texts.length) throw new Error("The AI didn't write any texts. Try again, or pick a stronger model in Settings.");
  return texts.map((t, i) => ({
    id: `news-${dateKey}-${i + 1}`,
    title: t.title, title_en: t.title_en, level: t.level, topic: t.region, kind: "text", source: "news",
    date: dateKey, via, paragraphs: t.paragraphs, questions: t.questions, vocab: t.vocab,
    // only link pages that really came from the search / Wikipedia, never invented URLs
    sources: [...new Set(t.source_urls)].filter((u) => known.has(u)).map((u) => ({ url: u, title: known.get(u) })),
    words: t.paragraphs.flat().reduce((n, s) => n + s.de.split(/\s+/).length, 0),
  }));
}

// ------------------------------------------------------------ connection check
export async function testKey() {
  const answer = await ask({ messages: [{ role: "user", content: "Reply with just the word OK." }], maxTokens: 2000 });
  return String(answer).trim();
}
