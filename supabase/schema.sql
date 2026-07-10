-- World Cup Ticket Watch — run this in the Supabase SQL editor.

create table if not exists price_snapshots (
  id bigint generated always as identity primary key,
  source text not null check (source in ('ticketmaster', 'seatgeek')),
  listing text not null,
  price numeric(10, 2) not null,
  quantity_available integer,
  url text,
  fetched_at timestamptz not null default now()
);

create index if not exists price_snapshots_fetched_at_idx
  on price_snapshots (fetched_at desc);
create index if not exists price_snapshots_source_fetched_at_idx
  on price_snapshots (source, fetched_at desc);

create table if not exists alerts_sent (
  id bigint generated always as identity primary key,
  snapshot_id bigint not null references price_snapshots (id) on delete cascade,
  sent_at timestamptz not null default now()
);

create index if not exists alerts_sent_sent_at_idx on alerts_sent (sent_at desc);

-- Single-row-per-key config store; the dashboard edits target_price here.
create table if not exists app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into app_config (key, value)
values ('target_price', '500')
on conflict (key) do nothing;

-- The app uses the service role key only (server-side), so RLS stays enabled
-- with no public policies: the anon key can read/write nothing.
alter table price_snapshots enable row level security;
alter table alerts_sent enable row level security;
alter table app_config enable row level security;
