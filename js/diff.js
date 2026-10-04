// Word-level comparison of a target sentence with what the learner typed or said.
import { esc } from "./ui.js";

const norm = (w) => w.toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
const split = (s) => s.split(/\s+/).map((raw) => ({ raw, n: norm(raw) })).filter((w) => w.n);

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Umlaut-insensitive "almost right" check (Mädchen ≈ Madchen ≈ Maedchen). */
function close(a, b) {
  const fold = (s) => s.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u").replace(/ß/g, "ss");
  if (fold(a) === fold(b)) return true;
  return Math.max(a.length, b.length) >= 4 && lev(a, b) <= 1;
}

/**
 * Align target and attempt (LCS). Returns { parts, score } where parts is a list of
 * { type: ok|close|miss|extra, text }.
 */
export function compare(target, attempt) {
  const T = split(target), A = split(attempt);
  const n = T.length, m = A.length;
  const L = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = T[i].n === A[j].n ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const parts = [];
  let i = 0, j = 0, pendingT = [], pendingA = [];
  const flush = () => {
    // pair up unmatched words in the same gap: near-misses count as "close"
    while (pendingT.length) {
      const t = pendingT.shift();
      const k = pendingA.findIndex((a) => close(t.n, a.n));
      if (k >= 0) { pendingA.splice(0, k + 1).slice(0, -1).forEach((a) => parts.push({ type: "extra", text: a.raw })); parts.push({ type: "close", text: t.raw }); }
      else parts.push({ type: "miss", text: t.raw });
    }
    pendingA.forEach((a) => parts.push({ type: "extra", text: a.raw }));
    pendingA = [];
  };
  while (i < n && j < m) {
    if (T[i].n === A[j].n) { flush(); parts.push({ type: "ok", text: T[i].raw }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) pendingT.push(T[i++]);
    else pendingA.push(A[j++]);
  }
  while (i < n) pendingT.push(T[i++]);
  while (j < m) pendingA.push(A[j++]);
  flush();
  const ok = parts.filter((p) => p.type === "ok").length + 0.5 * parts.filter((p) => p.type === "close").length;
  const extra = parts.filter((p) => p.type === "extra").length;
  const score = n ? Math.max(0, Math.round((100 * ok) / (n + extra * 0.5))) : 0;
  return { parts, score };
}

export function renderDiff(parts) {
  return parts.map((p) => `<span class="${p.type}">${esc(p.text)}</span>`).join(" ");
}

export function ring(score) {
  const c = score >= 85 ? "var(--green)" : score >= 60 ? "var(--gold)" : "var(--red)";
  return `<div class="score-ring" style="--p:${score};--c:${c}"><b>${score}%</b></div>`;
}
