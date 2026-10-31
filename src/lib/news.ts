import "server-only";
import type { NewsItem } from "./types";

const WINDOW_MS = 24 * 3_600_000;
const MAX_ITEMS = 4;

export function googleNewsUrl(symbol: string): string {
  const q = `${encodeURIComponent(symbol)}+NSE+stock`;
  return `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m?.[1] !== undefined ? decodeEntities(m[1]) : null;
}

/** Minimal, dependency-free RSS 2.0 item parser for Google News feeds. */
export function parseRss(xml: string, now = new Date()): NewsItem[] {
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1] ?? "";
    const rawTitle = tag(block, "title");
    const link = tag(block, "link");
    const pub = tag(block, "pubDate");
    if (!rawTitle || !link || !pub) continue;
    const published = new Date(pub);
    if (Number.isNaN(published.getTime())) continue;
    const age = now.getTime() - published.getTime();
    if (age < -3_600_000 || age > WINDOW_MS) continue;
    const source = tag(block, "source") ?? "";
    // Google News appends " - Source" to every title.
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    items.push({ title, source, link, publishedAt: published.toISOString() });
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_ITEMS);
}

export async function fetchHeadlines(symbol: string, now = new Date()): Promise<NewsItem[]> {
  const res = await fetch(googleNewsUrl(symbol), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PulseAlpha/1.0; +https://github.com/)",
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    },
    signal: AbortSignal.timeout(7000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google News ${res.status} for ${symbol}`);
  return parseRss(await res.text(), now);
}
