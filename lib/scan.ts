import { supabaseAdmin } from "./supabase";
import { fetchTicketmaster, fetchSeatGeek, type Listing, type SourceResult } from "./sources";
import { ALERT_DEDUPE_HOURS, DEFAULT_TARGET_PRICE, EVENT } from "./event";

export type ScanSummary = {
  event: string;
  scannedAt: string;
  targetPrice: number;
  sources: { source: string; ok: boolean; error?: string; eventsMatched: number; listingsFound: number }[];
  snapshotsStored: number;
  belowTarget: { source: string; listing: string; price: number; url: string | null }[];
  alertsSent: number;
  alertsSkippedAsDuplicates: number;
};

async function getConfigNumber(key: string): Promise<number | null> {
  const db = supabaseAdmin();
  const { data } = await db.from("app_config").select("value").eq("key", key).maybeSingle();
  const n = Number(data?.value);
  return data?.value != null && Number.isFinite(n) ? n : null;
}

async function setConfigValue(key: string, value: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("app_config")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to save ${key}: ${error.message}`);
}

export async function getTargetPrice(): Promise<number> {
  const fromDb = await getConfigNumber("target_price");
  if (fromDb !== null) return fromDb;
  const envTarget = Number(process.env.MY_TARGET_PRICE);
  return Number.isFinite(envTarget) && envTarget > 0 ? envTarget : DEFAULT_TARGET_PRICE;
}

export async function setTargetPrice(price: number): Promise<void> {
  await setConfigValue("target_price", String(price));
}

export async function runScan(): Promise<ScanSummary> {
  const db = supabaseAdmin();
  const scannedAt = new Date().toISOString();

  // Each source is independently caught: one failing API must not take down the other.
  const results: SourceResult[] = await Promise.all([
    safeSource("ticketmaster", fetchTicketmaster),
    safeSource("seatgeek", fetchSeatGeek),
  ]);
  const listings: Listing[] = results.flatMap((r) => r.listings);

  // Store one snapshot row per listing found.
  let stored: { id: number; source: string; listing: string; price: number; url: string | null }[] = [];
  if (listings.length > 0) {
    const { data, error } = await db
      .from("price_snapshots")
      .insert(
        listings.map((l) => ({
          source: l.source,
          listing: l.listing,
          price: l.price,
          quantity_available: l.quantity_available,
          url: l.url,
          fetched_at: scannedAt,
        }))
      )
      .select("id, source, listing, price, url");
    if (error) throw new Error(`Failed to store snapshots: ${error.message}`);
    stored = data ?? [];
  }

  const targetPrice = await getTargetPrice();
  const belowTarget = stored.filter((s) => s.price <= targetPrice);

  // Dedupe: skip alerts already sent for the same source+listing+price recently.
  const cutoff = new Date(Date.now() - ALERT_DEDUPE_HOURS * 3600 * 1000).toISOString();
  const { data: recentAlerts } = await db
    .from("alerts_sent")
    .select("sent_at, price_snapshots!inner(source, listing, price)")
    .gte("sent_at", cutoff);

  const alreadyAlerted = new Set(
    (recentAlerts ?? []).map((a: any) => {
      const s = a.price_snapshots;
      return `${s.source}|${s.listing}|${s.price}`;
    })
  );

  let alertsSent = 0;
  let alertsSkipped = 0;
  for (const hit of belowTarget) {
    const key = `${hit.source}|${hit.listing}|${hit.price}`;
    if (alreadyAlerted.has(key)) {
      alertsSkipped++;
      continue;
    }
    await sendNtfyAlert(hit, targetPrice);
    const { error } = await db.from("alerts_sent").insert({ snapshot_id: hit.id, sent_at: new Date().toISOString() });
    if (error) throw new Error(`Failed to record alert: ${error.message}`);
    alreadyAlerted.add(key);
    alertsSent++;
  }

  return {
    event: EVENT.name,
    scannedAt,
    targetPrice,
    sources: results.map((r) => ({
      source: r.source,
      ok: r.ok,
      error: r.error,
      eventsMatched: r.eventsMatched,
      listingsFound: r.listings.length,
    })),
    snapshotsStored: stored.length,
    belowTarget: belowTarget.map(({ source, listing, price, url }) => ({ source, listing, price, url })),
    alertsSent,
    alertsSkippedAsDuplicates: alertsSkipped,
  };
}

async function safeSource(
  source: SourceResult["source"],
  fn: () => Promise<SourceResult>
): Promise<SourceResult> {
  try {
    return await fn();
  } catch (err) {
    return {
      source,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      eventsMatched: 0,
      listings: [],
    };
  }
}

async function sendNtfyAlert(
  hit: { source: string; listing: string; price: number; url: string | null },
  targetPrice: number
): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) throw new Error("NTFY_TOPIC is not set");

  const headers: Record<string, string> = {
    Title: `Tickets at $${hit.price} (target $${targetPrice})`,
    Priority: "high",
    Tags: "soccer,tada",
  };
  if (hit.url) headers.Click = hit.url;

  const body = `${hit.listing}\nSource: ${hit.source}\nPrice: $${hit.price}${hit.url ? `\nBuy: ${hit.url}` : ""}`;
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    throw new Error(`ntfy.sh returned HTTP ${res.status}`);
  }
}
