// playwright-core is imported lazily inside launchBrowser so that a broken or
// missing Playwright install can only fail this source — a top-level import
// here would crash every route that transitively imports the scan module.
import type { Browser, Page } from "playwright-core";
import type { SourceResult } from "./sources";

// SeatGeek event page scraper (no API key needed). Tagged 'seatgeek-scrape' to
// stay distinguishable from API-sourced rows. SeatGeek runs bot protection
// (DataDome), so any failure here is reported as ok:false and never thrown —
// the rest of the scan proceeds on the other sources.

const DEFAULT_EVENT_URL =
  "https://seatgeek.com/world-cup-quarterfinals-argentina-vs-switzerland-tickets";
const SEARCH_URL = "https://seatgeek.com/search?search=world%20cup%20quarterfinals";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function scrapeSeatGeek(desiredQuantity = 1): Promise<SourceResult> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    // Images/media/fonts aren't needed to read prices; skip them for speed.
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      return route.continue();
    });
    const page = await context.newPage();

    // SeatGeek's quantity param filters listings to N seats together.
    const withQty = (url: string) =>
      desiredQuantity > 1 ? `${url}${url.includes("?") ? "&" : "?"}quantity=${desiredQuantity}` : url;

    const eventUrl = withQty(process.env.SEATGEEK_EVENT_URL || DEFAULT_EVENT_URL);
    let price = await extractFromUrl(page, eventUrl);
    let finalUrl = eventUrl;

    if (price === null) {
      // Direct URL failed (slug changed?) — try finding the event via search.
      const found = await findEventViaSearch(page);
      if (found) {
        finalUrl = withQty(found);
        price = await extractFromUrl(page, finalUrl);
      }
    }

    if (price === null) {
      return fail("Could not extract a price (page blocked or structure changed)");
    }

    return {
      source: "seatgeek-scrape",
      ok: true,
      eventsMatched: 1,
      listings: [
        {
          source: "seatgeek-scrape",
          listing:
            desiredQuantity > 1
              ? `Argentina vs Switzerland (SeatGeek page) — lowest for ${desiredQuantity} together`
              : "Argentina vs Switzerland (SeatGeek page) — lowest listing",
          price,
          quantity_available: desiredQuantity > 1 ? desiredQuantity : null,
          url: finalUrl,
        },
      ],
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function launchBrowser(): Promise<Browser> {
  const { chromium: playwright } = await import("playwright-core");
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  // Locally, use the installed Google Chrome.
  return playwright.launch({ channel: "chrome", headless: true });
}

async function extractFromUrl(page: Page, url: string): Promise<number | null> {
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => null);
  if (!res || res.status() >= 400) return null;
  await page.waitForTimeout(2500); // let client-side price data hydrate

  // 1. JSON-LD offers (most stable across redesigns)
  const jsonLd = await page
    .$$eval('script[type="application/ld+json"]', (nodes) => nodes.map((n) => n.textContent ?? ""))
    .catch(() => [] as string[]);
  for (const raw of jsonLd) {
    try {
      const doc = JSON.parse(raw);
      for (const item of Array.isArray(doc) ? doc : [doc]) {
        const low = item?.offers?.lowPrice ?? item?.offers?.[0]?.lowPrice;
        const price = normalizePrice(low);
        if (price !== null) return price;
      }
    } catch {
      // ignore malformed blocks
    }
  }

  const html = await page.content().catch(() => "");

  // 2. Embedded state JSON ("lowest_price": 123 or "lowestPrice": 123)
  const stateMatch = html.match(/"lowest_?[pP]rice"\s*:\s*(\d+(?:\.\d+)?)/);
  if (stateMatch) {
    const price = normalizePrice(stateMatch[1]);
    if (price !== null) return price;
  }

  // 3. Visible "from $1,234" text
  const fromMatch = html.match(/from\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
  if (fromMatch) {
    const price = normalizePrice(fromMatch[1].replace(/,/g, ""));
    if (price !== null) return price;
  }

  return null;
}

async function findEventViaSearch(page: Page): Promise<string | null> {
  const res = await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => null);
  if (!res || res.status() >= 400) return null;
  await page.waitForTimeout(2000);
  const hrefs = await page
    .$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href))
    .catch(() => [] as string[]);
  return (
    hrefs.find((h) => /argentina/i.test(h) && /switzerland/i.test(h)) ??
    hrefs.find((h) => /quarter-?finals?/i.test(h) && /tickets/i.test(h)) ??
    null
  );
}

function normalizePrice(value: unknown): number | null {
  const n = Number(value);
  // sanity bounds: ignore junk like 0, 1, or absurd parses
  return Number.isFinite(n) && n >= 20 && n < 100000 ? n : null;
}

function fail(error: string): SourceResult {
  return { source: "seatgeek-scrape", ok: false, error, eventsMatched: 0, listings: [] };
}
