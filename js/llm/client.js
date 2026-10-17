// Provider-neutral access to a language model.
//
//   complete({ system, messages, schema, effort, maxTokens })
//       -> parsed JSON object (if `schema` is given) or plain text
//   searchWeb(prompt)  -> { text, sources: [{url, title}] }, or null if the provider has no web search
//   listModels()       -> ["model-id", …] from the provider
//   isConfigured(), current(), aiName(), aiLabel()
//
// `messages` is always [{ role: "user" | "assistant", content: string }].
// `schema` is a JSON Schema in the strict style (every property required,
// additionalProperties: false). Anthropic gets it as structured output; OpenAI-compatible
// providers get response_format json_schema, falling back to json_object and then to
// "schema in the prompt" if the provider/model rejects it. Every result is then
// coerced to the schema (missing fields filled, "2" -> 2, …) so weaker models can't
// break the UI.
import Anthropic from "../../vendor/anthropic-sdk.mjs";
import { S } from "../store.js";
import { providerById, NON_TEXT_MODEL } from "./providers.js";

// ------------------------------------------------------------ settings
export function current() {
  const p = providerById(S.settings.provider);
  return {
    provider: p,
    key: (S.settings.keys || {})[p.id] || "",
    model: (S.settings.models || {})[p.id] || p.defaultModel,
    baseUrl: ((S.settings.baseUrls || {})[p.id] ?? p.baseUrl ?? "").replace(/\/+$/, ""),
  };
}

export function isConfigured() {
  const c = current();
  if (!c.model) return false;
  if (c.provider.api === "openai" && !c.baseUrl) return false;
  return c.provider.noKey || !!c.key;
}

export const aiName = () => current().provider.short;
export const aiLabel = () => { const c = current(); return `${c.provider.short} · ${c.model}`; };

const notConfigured = () => new Error("Set up an AI provider and API key in Settings first.");

// ------------------------------------------------------------ public API
export async function complete({ system, messages, schema, effort = "low", maxTokens = 8000 }) {
  if (!isConfigured()) throw notConfigured();
  const c = current();
  if (NON_TEXT_MODEL.test(c.model)) {
    throw new Error(`"${c.model}" is not a text model (it makes images, audio or embeddings). Choose a text model in Settings, e.g. ${c.provider.defaultModel}.`);
  }
  const raw = c.provider.api === "anthropic"
    ? await anthropicComplete(c, { system, messages, schema, effort, maxTokens })
    : await openaiWithFallback(c, { system, messages, schema });
  return schema ? coerce(schema, parseJSON(raw)) : raw;
}

export async function searchWeb(prompt) {
  if (!isConfigured()) throw notConfigured();
  const c = current();
  if (c.provider.webSearch === "anthropic") return anthropicSearch(c, prompt);
  if (c.provider.webSearch === "openrouter") return openrouterSearch(c, prompt);
  return null;
}

export async function listModels() {
  const c = current();
  if (c.provider.api === "anthropic") {
    if (!c.key) throw notConfigured();
    const ids = [];
    for await (const m of anthropicClient(c).models.list()) ids.push(m.id);
    return ids;
  }
  const data = await openaiFetch(c, "/models");
  return (data?.data || data?.models || [])
    .map((m) => String(m.id || m.name || "").replace(/^models\//, "")) // Gemini lists "models/gemini-…"
    .filter((id) => id && !NON_TEXT_MODEL.test(id)) // hide image/speech/embedding models
    .sort();
}

// ------------------------------------------------------------ Anthropic (official SDK)
// Server-side refusal fallback is available for these models on the Claude API.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
const NO_EFFORT = (model) => /haiku/.test(model);

const anthropicClient = (c) => new Anthropic({ apiKey: c.key, dangerouslyAllowBrowser: true });

async function anthropicSend(c, params) {
  try {
    const client = anthropicClient(c);
    return FALLBACK_MODELS.has(params.model)
      ? await client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }).finalMessage()
      : await client.messages.stream(params).finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Anthropic rejected the API key. Check it in Settings.");
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error("This API key has no access to that model.");
    if (e instanceof Anthropic.NotFoundError) throw new Error(`Model "${params.model}" not found. Pick another one in Settings.`);
    if (e instanceof Anthropic.RateLimitError) throw new Error("Rate limited by the API. Wait a moment and try again.");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Could not reach the Anthropic API. Are you online?");
    if (e instanceof Anthropic.APIError) {
      if (e.status >= 500) throw new Error("The AI service is busy or having trouble right now. Try again in a minute.");
      throw new Error(`API error ${e.status ?? ""}: ${e.error?.error?.message || e.message}`);
    }
    throw e;
  }
}

function anthropicCheck(msg) {
  if (msg.stop_reason === "refusal") throw new Error("The AI declined this request.");
  if (msg.stop_reason === "max_tokens") throw new Error("The answer was cut off. Try again.");
}

const textOf = (content) => content.filter((b) => b.type === "text").map((b) => b.text).join("");

async function anthropicComplete(c, { system, messages, schema, effort, maxTokens }) {
  const params = { model: c.model, max_tokens: maxTokens, messages };
  if (system) params.system = system;
  const output = {};
  if (!NO_EFFORT(c.model)) output.effort = effort;
  if (schema) output.format = { type: "json_schema", schema };
  if (Object.keys(output).length) params.output_config = output;
  const msg = await anthropicSend(c, params);
  anthropicCheck(msg);
  return textOf(msg.content);
}

async function anthropicSearch(c, prompt) {
  const tool = NO_EFFORT(c.model)
    ? { type: "web_search_20250305", name: "web_search", max_uses: 5 }
    : { type: "web_search_20260209", name: "web_search", max_uses: 5 };
  const messages = [{ role: "user", content: prompt }];
  const params = { model: c.model, max_tokens: 16000, tools: [tool], messages };
  if (!NO_EFFORT(c.model)) params.output_config = { effort: "medium" };
  const turns = [];
  let msg;
  for (let i = 0; i < 4; i++) {
    msg = await anthropicSend(c, params);
    turns.push(msg.content);
    if (msg.stop_reason !== "pause_turn") break;
    // a long server-side search pauses; hand the paused turn back and the API resumes it
    messages.push({ role: "assistant", content: msg.content });
  }
  if (msg.stop_reason === "pause_turn") throw new Error("The web search took too long. Try again.");
  anthropicCheck(msg);
  const seen = new Map();
  for (const content of turns) for (const b of content) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) seen.set(r.url, r.title || r.url);
    if (b.type === "text") for (const ct of b.citations || []) if (ct.url) seen.set(ct.url, ct.title || ct.url);
  }
  return { text: turns.map(textOf).join("\n"), sources: [...seen].map(([url, title]) => ({ url, title })) };
}

// ------------------------------------------------------------ OpenAI-compatible (fetch)
const RETRY = new Set([429, 500, 502, 503, 504, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openaiFetch(c, path, body) {
  const headers = { "Content-Type": "application/json", ...(c.provider.headers || {}) };
  if (c.key) headers.Authorization = `Bearer ${c.key}`;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(c.baseUrl + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error(`Could not reach ${c.provider.name} at ${c.baseUrl}. ${c.provider.id === "ollama" ? "Is Ollama running?" : "Check your internet connection; an ad blocker, VPN or firewall can also block it."}`);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (res.ok) return data;
    if (RETRY.has(res.status) && attempt < 2) { await sleep(1500 * (attempt + 1) ** 2); continue; }
    const detail = data?.error?.message || data?.message || (Array.isArray(data) && data[0]?.error?.message) || text.slice(0, 300);
    const err = new Error(friendly(res.status, c, detail));
    err.status = res.status;
    throw err;
  }
}

function friendly(status, c, detail) {
  const why = detail ? ` (${c.provider.short} says: ${String(detail).slice(0, 220)})` : "";
  // Gemini reports a bad key as 400 "API key not valid" / "Please pass a valid API key"
  if (status === 401 || status === 403 || /api[ _-]?key|auth/i.test(String(detail))) return `${c.provider.name} rejected the API key.${why} Check it in Settings.`;
  if (status === 404) return `${c.provider.name} doesn't offer the model "${c.model}" to this key.${why} Pick another one with "Load models" in Settings.`;
  if (status === 429) return `${c.provider.name}: rate limit or quota reached.${why} Wait a moment, or check your plan/credits.`;
  if (status >= 500) return `${c.provider.name} is overloaded or having trouble right now.${why} Try again in a minute, or pick another model in Settings.`;
  return `${c.provider.name} error ${status}:${why || " unknown error"}`;
}

// Remember which JSON mode works per provider+model, so we don't retry every time.
const jsonMode = new Map();

async function openaiComplete(c, { system, messages, schema }) {
  const memo = `${c.provider.id}|${c.model}`;
  let mode = schema ? jsonMode.get(memo) || "schema" : "none";
  for (;;) {
    let sys = system || "";
    if (schema && mode !== "schema") {
      sys += `\n\nReply with ONLY a JSON object (no markdown, no explanations) that matches this JSON Schema exactly:\n${JSON.stringify(schema)}`;
    }
    const body = {
      model: c.model,
      messages: [...(sys.trim() ? [{ role: "system", content: sys.trim() }] : []), ...messages.map((m) => ({ role: m.role, content: m.content }))],
    };
    if (mode === "schema") body.response_format = { type: "json_schema", json_schema: { name: "response", strict: true, schema } };
    if (mode === "object") body.response_format = { type: "json_object" };
    try {
      const data = await openaiFetch(c, "/chat/completions", body);
      if (schema) jsonMode.set(memo, mode);
      const choice = data?.choices?.[0];
      if (!choice) throw new Error(`${c.provider.name} returned an empty answer.`);
      if (choice.message?.refusal) throw new Error("The AI declined this request.");
      if (choice.finish_reason === "length") throw new Error("The answer was cut off. Try again or pick a model with a bigger output limit.");
      return choice.message?.content ?? "";
    } catch (e) {
      // provider/model doesn't support this response_format: degrade and retry
      if (schema && (e.status === 400 || e.status === 422) && mode !== "prompt" && !/rejected the API key/.test(e.message)) {
        mode = mode === "schema" ? "object" : "prompt";
        continue;
      }
      if (schema && e.status === 400 && !/rejected the API key/.test(e.message)) e.message += " This model may not support the structured answers the app needs; try another model in Settings.";
      throw e;
    }
  }
}

/** If the chosen model is overloaded (429/5xx), try the provider's fallback models once each. */
async function openaiWithFallback(c, req) {
  try {
    return await openaiComplete(c, req);
  } catch (e) {
    const busy = e.status === 429 || e.status >= 500;
    const fallbacks = (c.provider.fallbackModels || []).filter((m) => m !== c.model);
    if (!busy || !fallbacks.length) throw e;
    for (const model of fallbacks) {
      try {
        console.warn(`${c.model} is busy (${e.status}); trying ${model}`);
        return await openaiComplete({ ...c, model }, req);
      } catch (e2) {
        if (!(e2.status === 429 || e2.status >= 500)) throw e2;
      }
    }
    throw e;
  }
}

async function openrouterSearch(c, prompt) {
  const data = await openaiFetch(c, "/chat/completions", {
    model: c.model,
    messages: [{ role: "user", content: prompt }],
    plugins: [{ id: "web", max_results: 8 }],
  });
  const msg = data?.choices?.[0]?.message || {};
  const sources = (msg.annotations || [])
    .filter((a) => a.type === "url_citation" && a.url_citation?.url)
    .map((a) => ({ url: a.url_citation.url, title: a.url_citation.title || a.url_citation.url }));
  return { text: msg.content || "", sources };
}

// ------------------------------------------------------------ JSON helpers
function parseJSON(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch { /* try harder */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ }
  }
  throw new Error("The AI didn't return valid data. Try again, or pick a stronger model in Settings.");
}

/** Make `value` match `schema`: fill missing fields, fix types, snap enums. */
export function coerce(schema, value) {
  if (!schema) return value;
  switch (schema.type) {
    case "object": {
      const o = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      const out = {};
      for (const [k, s] of Object.entries(schema.properties || {})) out[k] = coerce(s, o[k]);
      return out;
    }
    case "array":
      return Array.isArray(value) ? value.map((x) => coerce(schema.items, x)) : [];
    case "integer": {
      const n = parseInt(value, 10);
      return Number.isFinite(n) ? n : 0;
    }
    case "number": {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return value === true || value === "true";
    case "string": {
      let s = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
      if (schema.enum && !schema.enum.includes(s)) s = schema.enum.find((e) => e.toLowerCase() === s.toLowerCase()) || schema.enum[0];
      return s;
    }
    default:
      return value;
  }
}
