import { supabaseAdmin } from "@/lib/supabase";
import { getTargetPrice, getDesiredQuantity } from "@/lib/scan";
import { EVENT } from "@/lib/event";
import { updateSettingsAction } from "./actions";
import ScanNowButton from "@/components/ScanNowButton";

export const dynamic = "force-dynamic";

type Snapshot = {
  id: number;
  source: string;
  listing: string;
  price: number;
  quantity_available: number | null;
  url: string | null;
  fetched_at: string;
};

const SOURCES = ["ticketmaster", "seatgeek", "seatgeek-scrape"] as const;
const SOURCE_LABEL: Record<string, string> = {
  ticketmaster: "Ticketmaster",
  seatgeek: "SeatGeek (API)",
  "seatgeek-scrape": "SeatGeek (page)",
};

export default async function Dashboard() {
  let snapshots: Snapshot[] = [];
  let targetPrice: number | null = null;
  let desiredQuantity = 1;
  let loadError: string | null = null;

  try {
    const db = supabaseAdmin();
    const [{ data, error }, target, qty] = await Promise.all([
      db
        .from("price_snapshots")
        .select("id, source, listing, price, quantity_available, url, fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(500),
      getTargetPrice(),
      getDesiredQuantity(),
    ]);
    if (error) throw new Error(error.message);
    snapshots = (data ?? []) as Snapshot[];
    targetPrice = target;
    desiredQuantity = qty;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const lowestBySource = SOURCES.map((source) => {
    const rows = snapshots.filter((s) => s.source === source);
    if (rows.length === 0) return { source, current: null as Snapshot | null };
    // rows are newest-first; the latest scan batch shares a fetched_at
    const latestAt = rows[0].fetched_at;
    const latestBatch = rows.filter((s) => s.fetched_at === latestAt);
    const current = latestBatch.reduce((a, b) => (a.price <= b.price ? a : b));
    return { source, current };
  });

  // Price history: lowest price per source per scan batch, oldest first.
  const history = SOURCES.map((source) => {
    const byBatch = new Map<string, number>();
    for (const s of snapshots.filter((r) => r.source === source)) {
      const prev = byBatch.get(s.fetched_at);
      if (prev === undefined || s.price < prev) byBatch.set(s.fetched_at, s.price);
    }
    const points = [...byBatch.entries()]
      .map(([at, price]) => ({ at, price }))
      .sort((a, b) => a.at.localeCompare(b.at));
    return { source, points };
  });

  return (
    <main className="wrap">
      <h1>World Cup Ticket Watch</h1>
      <p className="subtitle">
        {EVENT.name} · Sat Jul 11, 2026 · 9:00 PM ET · Arrowhead Stadium, Kansas City
      </p>

      {loadError && (
        <div className="card error">
          Could not load data: {loadError}. Check the Supabase env vars and that
          you have run <code>supabase/schema.sql</code>.
        </div>
      )}

      <section className="grid">
        {lowestBySource.map(({ source, current }) => (
          <div className="card" key={source}>
            <h2>{SOURCE_LABEL[source]}</h2>
            {current ? (
              <>
                <div className={`price ${targetPrice !== null && current.price <= targetPrice ? "hit" : ""}`}>
                  ${current.price.toFixed(2)}
                </div>
                <div className="meta">
                  {current.listing}
                  {current.quantity_available != null && ` · ${current.quantity_available} listings`}
                </div>
                <div className="meta">as of {new Date(current.fetched_at).toLocaleString()}</div>
                {current.url && (
                  <a href={current.url} target="_blank" rel="noreferrer">
                    Buy on {SOURCE_LABEL[source]} →
                  </a>
                )}
              </>
            ) : (
              <div className="meta">No data yet — run a scan.</div>
            )}
          </div>
        ))}

        <div className="card">
          <h2>Target price &amp; seats</h2>
          <form action={updateSettingsAction} className="target-form">
            <span className="dollar">$</span>
            <input
              name="target_price"
              type="number"
              step="1"
              min="1"
              defaultValue={targetPrice ?? ""}
              required
            />
            <label className="qty-label">
              seats together
              <input
                name="desired_quantity"
                type="number"
                step="1"
                min="1"
                max="10"
                defaultValue={desiredQuantity}
                required
              />
            </label>
            <button className="btn" type="submit">Save</button>
          </form>
          <p className="meta">
            Alerts fire via ntfy when a listing is at or below the target, per ticket.
            Seats-together filtering only applies to the SeatGeek page source — API
            sources price single tickets.
          </p>
          <ScanNowButton />
        </div>
      </section>

      <section className="card">
        <h2>Price history (lowest per scan)</h2>
        <PriceChart history={history} targetPrice={targetPrice} />
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Listing</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.slice(0, 40).map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.fetched_at).toLocaleString()}</td>
                <td>{SOURCE_LABEL[s.source] ?? s.source}</td>
                <td>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.listing}</a> : s.listing}</td>
                <td className={targetPrice !== null && s.price <= targetPrice ? "hit" : ""}>
                  ${s.price.toFixed(2)}
                </td>
              </tr>
            ))}
            {snapshots.length === 0 && !loadError && (
              <tr>
                <td colSpan={4} className="meta">No snapshots yet. Hit Scan Now or wait for the schedule.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function PriceChart({
  history,
  targetPrice,
}: {
  history: { source: string; points: { at: string; price: number }[] }[];
  targetPrice: number | null;
}) {
  const all = history.flatMap((h) => h.points);
  if (all.length < 2) return null;

  const W = 720;
  const H = 200;
  const PAD = 36;
  const times = all.map((p) => new Date(p.at).getTime());
  const prices = all.map((p) => p.price).concat(targetPrice !== null ? [targetPrice] : []);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const x = (t: number) => (tMax === tMin ? W / 2 : PAD + ((t - tMin) / (tMax - tMin)) * (W - 2 * PAD));
  const y = (p: number) => (pMax === pMin ? H / 2 : H - PAD - ((p - pMin) / (pMax - pMin)) * (H - 2 * PAD));

  const colors: Record<string, string> = {
    ticketmaster: "#1a7f4b",
    seatgeek: "#2563eb",
    "seatgeek-scrape": "#7c3aed",
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Price history chart">
      {targetPrice !== null && (
        <>
          <line x1={PAD} x2={W - PAD} y1={y(targetPrice)} y2={y(targetPrice)} stroke="#d97706" strokeDasharray="5 4" />
          <text x={W - PAD} y={y(targetPrice) - 5} textAnchor="end" fontSize="11" fill="#d97706">
            target ${targetPrice}
          </text>
        </>
      )}
      {history.map(({ source, points }) =>
        points.length > 0 ? (
          <g key={source}>
            <polyline
              fill="none"
              stroke={colors[source] ?? "#333"}
              strokeWidth="2"
              points={points.map((p) => `${x(new Date(p.at).getTime())},${y(p.price)}`).join(" ")}
            />
            {points.map((p) => (
              <circle key={p.at} cx={x(new Date(p.at).getTime())} cy={y(p.price)} r="2.5" fill={colors[source] ?? "#333"} />
            ))}
          </g>
        ) : null
      )}
      <text x={PAD} y={14} fontSize="11" fill="#1a7f4b">— Ticketmaster</text>
      <text x={PAD + 110} y={14} fontSize="11" fill="#2563eb">— SeatGeek (API)</text>
      <text x={PAD + 230} y={14} fontSize="11" fill="#7c3aed">— SeatGeek (page)</text>
    </svg>
  );
}
