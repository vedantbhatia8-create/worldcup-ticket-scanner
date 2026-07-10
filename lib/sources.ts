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

  const params = new URLSearchParams({
    apikey: apiKey,
    keyword: "Argentina Switzerland",
    city: EVENT.city,
    startDateTime: EVENT.startDateTimeUtc,
    endDateTime: EVENT.endDateTimeUtc,
    classificationName: "soccer",
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

  const matched = events.filter((event) => isTargetEvent({
    title: event?.name,
    venue: event?._embedded?.venues?.[0]?.name,
    city: event?._embedded?.venues?.[0]?.city?.name,
    localDate: event?.dates?.start?.localDate,
  }));

  const listings: Listing[] = [];
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
    // Event found but no price data yet — record that we saw it, at price 0? No:
    // skip instead; a zero row would pollute min-price stats.
  }

  return { source: "ticketmaster", ok: true, eventsMatched: matched.length, listings };
}

function tmFail(error: string): SourceResult {
  return { source: "ticketmaster", ok: false, error, eventsMatched: 0, listings: [] };
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

  return { source: "seatgeek", ok: true, eventsMatched: matched.length, listings };
}

function sgFail(error: string): SourceResult {
  return { source: "seatgeek", ok: false, error, eventsMatched: 0, listings: [] };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<no body>";
  }
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
