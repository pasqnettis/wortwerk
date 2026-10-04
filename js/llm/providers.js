// The AI providers the app can talk to.
//
// api: "anthropic"  -> Anthropic Messages API through the official SDK (vendor/anthropic-sdk.mjs)
//      "openai"     -> any OpenAI-compatible /chat/completions endpoint, called with fetch()
//
// webSearch: how the daily news step searches the web with this provider.
//      "anthropic"  -> Claude's server-side web_search tool
//      "openrouter" -> OpenRouter's web plugin (plugins: [{ id: "web" }])
//      null         -> no built-in search: the news uses Wikipedia's "Current events" page instead
//
// All of these endpoints answer browser (CORS) requests; checked 2026-10-04.
// Model lists change often, so `models` are only suggestions: Settings has a
// "Load models" button that asks the provider's /models endpoint for the real list.

export const PROVIDERS = [
  {
    id: "anthropic", name: "Anthropic (Claude)", short: "Claude", api: "anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…",
    defaultModel: "claude-opus-5-5",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"],
    webSearch: "anthropic",
  },
  {
    id: "openai", name: "OpenAI (GPT)", short: "GPT", api: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…",
    defaultModel: "gpt-5-mini", models: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
    webSearch: null,
  },
  {
    id: "gemini", name: "Google Gemini", short: "Gemini", api: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza…",
    // "-latest" aliases always point at Google's current model; fixed versions get retired for new users
    defaultModel: "gemini-flash-latest", models: ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest"],
    // tried in order when the chosen model is overloaded (429/503)
    fallbackModels: ["gemini-3.5-flash", "gemini-flash-lite-latest"],
    webSearch: null,
  },
  {
    id: "mistral", name: "Mistral", short: "Mistral", api: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    keyUrl: "https://console.mistral.ai/api-keys", keyHint: "",
    defaultModel: "mistral-large-latest", models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    webSearch: null,
  },
  {
    id: "openrouter", name: "OpenRouter (hundreds of models)", short: "OpenRouter", api: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys", keyHint: "sk-or-…",
    defaultModel: "openai/gpt-5-mini", models: ["openai/gpt-5-mini", "google/gemini-2.5-flash", "anthropic/claude-sonnet-4.5", "mistralai/mistral-large"],
    webSearch: "openrouter",
    headers: { "X-Title": "Wortwerk" },
  },
  {
    id: "groq", name: "Groq", short: "Groq", api: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys", keyHint: "gsk_…",
    defaultModel: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile"],
    webSearch: null,
  },
  {
    id: "deepseek", name: "DeepSeek", short: "DeepSeek", api: "openai",
    baseUrl: "https://api.deepseek.com",
    keyUrl: "https://platform.deepseek.com/api_keys", keyHint: "sk-…",
    defaultModel: "deepseek-chat", models: ["deepseek-chat"],
    webSearch: null,
  },
  {
    id: "xai", name: "xAI (Grok)", short: "Grok", api: "openai",
    baseUrl: "https://api.x.ai/v1",
    keyUrl: "https://console.x.ai", keyHint: "xai-…",
    defaultModel: "grok-4", models: ["grok-4"],
    webSearch: null,
  },
  {
    id: "ollama", name: "Ollama (local, free)", short: "Ollama", api: "openai",
    baseUrl: "http://localhost:11434/v1", noKey: true,
    keyUrl: "https://ollama.com", keyHint: "(no key needed)",
    defaultModel: "llama3.1", models: ["llama3.1", "qwen2.5", "mistral"],
    webSearch: null,
    note: "Runs models on your own computer. Install Ollama and pull a model first (e.g. `ollama pull llama3.1`).",
  },
  {
    id: "custom", name: "Other (OpenAI-compatible)", short: "AI", api: "openai",
    baseUrl: "", noKey: true, editableUrl: true,
    keyUrl: "", keyHint: "(if the server needs one)",
    defaultModel: "", models: [],
    webSearch: null,
    note: "Any server that speaks the OpenAI /chat/completions format (LM Studio, vLLM, Together, Fireworks, Azure-compatible proxies…). Enter its base URL, ending before /chat/completions.",
  },
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];

/**
 * Model ids that can't write text/JSON (image, speech, embedding, video… models).
 * Providers list them alongside chat models; picking one breaks every AI feature.
 */
export const NON_TEXT_MODEL = /(image|imagen|banana|tts|speech|audio|transcribe|whisper|embed|veo|video|dall-e|moderation|realtime|live|aqa|robotics|computer-use)/i;
