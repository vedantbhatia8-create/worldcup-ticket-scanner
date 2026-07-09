// The one event this app watches.
export const EVENT = {
  name: "FIFA World Cup 2026 Quarterfinal — Argentina vs Switzerland",
  localDate: "2026-07-11",
  city: "Kansas City",
  venueKeyword: "Arrowhead",
  // 9:00 PM ET on 2026-07-11 == 2026-07-12T01:00:00Z
  startDateTimeUtc: "2026-07-11T00:00:00Z",
  endDateTimeUtc: "2026-07-12T23:59:59Z",
} as const;

export const DEFAULT_TARGET_PRICE = 500; // USD placeholder — edit on the dashboard
export const ALERT_DEDUPE_HOURS = 6;
