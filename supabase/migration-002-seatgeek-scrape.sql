-- Migration 002: allow the 'seatgeek-scrape' source and update default target.
-- Run this in the Supabase SQL editor (schema.sql was already applied).

alter table price_snapshots drop constraint price_snapshots_source_check;
alter table price_snapshots add constraint price_snapshots_source_check
  check (source in ('ticketmaster', 'seatgeek', 'seatgeek-scrape'));
