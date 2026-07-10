import { EVENT } from "./event";

export type SourceName = "ticketmaster" | "seatgeek";

export type Listing = {
  source: SourceName;
  listing: string;
  price: number;
  quantity_available: number | null;
  url: string | null;
};

export type SourceResult = {
  source: SourceName;
  ok: boolean;
  error?: string;
  candidatesFound: number;
  note?: string;
  eventsMatched: number;
  listings: Listing[];
};

// --- Ticketmaster Discovery API ---------------------------------------------
// Discovery exposes price *ranges* per event (not per-seat listings), so each
// price range becomes one row, using the range minimum as the price.
export async function fetchTicketmaster(): Promise<SourceResult> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    return tmFail("TICKETMASTER_API_KEY is not set");
  }

  const eventsById = new Map<string, any>();
  const searches = [
    "Argentina Switzerland",
    "FIFA World Cup",
    "World Cup Quarterfinal",
    "World Cup Quarter Final",
    "Kansas City World Cup",
  ];

  for (const keyword of searches) {
    const params = new URLSearchParams({
      apikey: apiKey,
      keyword,
      city: EVENT.city,
      startDateTime: EVENT.startDateTimeUtc,
      endDateTime: EVENT.endDateTimeUtc,
      sort: "date,asc",
      size: "50",
    });

    const res = await fetch(
      `https://app.ticketmaster.com/discovery/v2/events.json?${params}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return tmFail(`Ticketmaster HTTP ${res.status}: ${await safeText(res)}`);
    }

    const data = await res.json();
    const events: any[] = data?._embedded?.events ?? [];
    for (const event of events) {
      eventsById.set(String(event?.id ?? event?.url ?? event?.name), event);
    }
  }

  const events = [...eventsById.values()];

  const matched = events.filter((event) => isTargetEvent({
    title: event?.name,
    venue: event?._embedded?.venues?.[0]?.name,
    city: event?._embedded?.venues?.[0]?.city?.name,
    localDate: event?.dates?.start?.localDate,
  }));

  const listings: Listing[] = [];
  let webFallbackTried = false;
  let webFallbackError: string | undefined;
  for (const ev of matched) {
    const ranges: any[] = ev?.priceRanges ?? [];
    for (const pr of ranges) {
      if (typeof pr?.min !== "number") continue;
      listings.push({
        source: "ticketmaster",
        listing: `${ev.name} — ${pr.type ?? "standard"} (range min)`,
        price: pr.min,
        quantity_available: null,
        url: ev.url ?? null,
      });
    }

    if (ranges.length === 0 && ev?.url) {
      webFallbackTried = true;
      const fallback = await fetchTicketmasterWebPrice(ev.url, ev.name);
      if (fallback.listing) {
        listings.push(fallback.listing);
      } else if (fallback.error) {
        webFallbackError = fallback.error;
      }
    }
  }

  const matchedWithoutPrices = matched.length - listings.length;
  return {
    source: "ticketmaster",
    ok: true,
    candidatesFound: events.length,
    eventsMatched: matched.length,
    note:
      matched.length === 0
        ? "Ticketmaster API returned events, but none matched the target date/venue."
        : listings.length === 0
          ? webFallbackTried
            ? `Target event matched, but Discovery had no priceRanges and web fallback found no price${webFallbackError ? ` (${webFallbackError})` : ""}.`
            : "Target event matched, but Ticketmaster Discovery did not expose priceRanges yet."
          : matchedWithoutPrices > 0
            ? `${matchedWithoutPrices} matched event(s) had no Discovery priceRanges; web fallback was ${webFallbackTried ? "tried" : "not needed"}.`
            : undefined,
    listings,
  };
}

function tmFail(error: string): SourceResult {
  return { source: "ticketmaster", ok: false, error, candidatesFound: 0, eventsMatched: 0, listings: [] };
}

// --- SeatGeek API ------------------------------------------------------------
// SeatGeek's public API exposes per-event stats (lowest/average/highest price
// and listing count), so the lowest listed price becomes one row per event.
export async function fetchSeatGeek(): Promise<SourceResult> {
  const clientId = process.env.SEATGEEK_CLIENT_ID;
  if (!clientId) {
    return sgFail("SEATGEEK_CLIENT_ID is not set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    q: "Argentina Switzerland World Cup",
    "venue.city": EVENT.city,
    "datetime_local.gte": EVENT.localDate,
    "datetime_local.lte": "2026-07-12",
    per_page: "50",
  });

  const res = await fetch(`https://api.seatgeek.com/2/events?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return sgFail(`SeatGeek HTTP ${res.status}: ${await safeText(res)}`);
  }

  const data = await res.json();
  const events: any[] = data?.events ?? [];

  const matched = events.filter((event) => isTargetEvent({
    title: event?.title,
    venue: event?.venue?.name,
    city: event?.venue?.city,
    localDate: String(event?.datetime_local ?? "").slice(0, 10),
  }));

  const listings: Listing[] = [];
  for (const ev of matched) {
    const lowest = ev?.stats?.lowest_price;
    if (typeof lowest !== "number" || lowest <= 0) continue;
    listings.push({
      source: "seatgeek",
      listing: `${ev.title} — lowest listing`,
      price: lowest,
      quantity_available: ev?.stats?.listing_count ?? null,
      url: ev.url ?? null,
    });
  }

  return {
    source: "seatgeek",
    ok: true,
    candidatesFound: events.length,
    eventsMatched: matched.length,
    note:
      matched.length === 0
        ? "SeatGeek API returned events, but none matched the target date/venue."
        : listings.length === 0
          ? "Target event matched, but SeatGeek did not expose a lowest_price yet."
          : undefined,
    listings,
  };
}

function sgFail(error: string): SourceResult {
  return { source: "seatgeek", ok: false, error, candidatesFound: 0, eventsMatched: 0, listings: [] };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
}

async function fetchTicketmasterWebPrice(
  url: string,
  eventName: string
): Promise<{ listing?: Listing; error?: string }> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });

    if (!res.ok) {
      return { error: `Ticketmaster web HTTP ${res.status}` };
    }

    const html = await res.text();
    if (/datadome|captcha|blocked|access denied|pardon the interruption/i.test(html)) {
      return { error: "blocked by Ticketmaster bot protection" };
    }

    const price = lowestPlausiblePrice(html);
    if (price === null) return { error: "no parseable price in Ticketmaster page HTML" };

    return {
      listing: {
        source: "ticketmaster",
        listing: `${eventName} — web page lowest parsed price`,
        price,
        quantity_available: null,
        url,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function lowestPlausiblePrice(html: string): number | null {
  const candidates: number[] = [];
  const patterns = [
    /"min(?:imum)?Price"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?/gi,
    /"lowestPrice"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?/gi,
    /"price"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?/gi,
    /\$\s*([1-9]\d{1,4}(?:,\d{3})*(?:\.\d{2})?)/g,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = Number(String(match[1]).replace(/,/g, ""));
      if (Number.isFinite(value) && value >= 20 && value <= 50000) {
        candidates.push(value);
      }
    }
  }

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

function isTargetEvent({
  title,
  venue,
  city,
  localDate,
}: {
  title: unknown;
  venue: unknown;
  city: unknown;
  localDate: unknown;
}): boolean {
  const haystack = `${title ?? ""} ${venue ?? ""} ${city ?? ""}`.toLowerCase();
  const hasTeams = haystack.includes("argentina") && haystack.includes("switzerland");
  const hasWorldCupQuarterfinal =
    haystack.includes("world cup") && /quarter[\s-]?final/.test(haystack);
  return (
    String(localDate) === EVENT.localDate &&
    haystack.includes(EVENT.venueKeyword.toLowerCase()) &&
    (hasTeams || hasWorldCupQuarterfinal)
  );
}
