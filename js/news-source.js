// News without a web-search-capable AI: Wikipedia's "Portal:Current events" daily pages.
// Each entry is a short factual summary with links to the original reports (Reuters, BBC, …).
// The MediaWiki API allows browser requests with origin=*.

const API = "https://en.wikipedia.org/w/api.php";

function pageTitle(date) {
  const month = date.toLocaleDateString("en-US", { month: "long" });
  return `Portal:Current events/${date.getFullYear()} ${month} ${date.getDate()}`;
}

async function fetchDay(date) {
  const url = `${API}?action=parse&page=${encodeURIComponent(pageTitle(date))}&prop=text&format=json&formatversion=2&origin=*`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  if (!data.parse?.text) return []; // page not created yet (early morning)
  return parse(data.parse.text, pageTitle(date));
}

/** Turn the portal HTML into [{ category, context, text, sources: [{url, title}] }]. */
function parse(html, page) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const content = doc.querySelector(".current-events-content");
  if (!content) return [];
  const items = [];
  let category = "";
  for (const el of content.children) {
    if (el.tagName === "P") { category = el.textContent.trim(); continue; }
    if (el.tagName !== "UL") continue;
    for (const li of el.querySelectorAll("li")) {
      // an event entry is a list item with its own external source links
      const own = li.cloneNode(true);
      own.querySelectorAll("ul").forEach((u) => u.remove());
      const links = [...own.querySelectorAll("a.external")];
      if (!links.length) continue;
      const sources = links.map((a) => ({ url: a.href, title: a.textContent.replace(/[()]/g, "").trim() || "Source" }));
      links.forEach((a) => a.remove());
      const text = own.textContent.replace(/\s+/g, " ").trim();
      if (text.length < 30) continue;
      // topic path, e.g. "Russian invasion of Ukraine › Attacks on Kyiv"
      const context = [];
      for (let p = li.parentElement?.closest("li"); p; p = p.parentElement?.closest("li")) {
        const label = p.querySelector(":scope > a")?.textContent.trim();
        if (label) context.unshift(label);
      }
      sources.push({ url: `https://en.wikipedia.org/wiki/${page.replace(/ /g, "_")}`, title: "Wikipedia: Current events" });
      items.push({ category, context: context.join(" › "), text, sources });
    }
  }
  return items;
}

/** Events of the last three days (today's page is often still short in the morning). */
export async function wikipediaNews(now = new Date()) {
  const days = [0, 1, 2].map((back) => { const d = new Date(now); d.setDate(now.getDate() - back); return d; });
  const items = (await Promise.all(days.map(fetchDay))).flat();
  if (!items.length) throw new Error("Couldn't load the news from Wikipedia. Are you online?");
  return items.slice(0, 80);
}

/** Text brief for the AI, with every source URL so it can cite them. */
export function briefFromItems(items) {
  return items.map((it, i) =>
    `[${i + 1}] ${it.category}${it.context ? ` › ${it.context}` : ""}: ${it.text}\n    Sources: ${it.sources.map((s) => s.url).join(" ")}`).join("\n");
}
