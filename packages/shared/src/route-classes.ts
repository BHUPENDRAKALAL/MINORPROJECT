/**
 * Route weight classes, approved 2026-11-07 (BACKEND-DESIGN.md §9.17).
 * Every API route declares one; the API uses it for rate limits and timing alerts.
 */
export const ROUTE_CLASSES = {
  LIGHT: { label: "Light", targetMs: 300, runsIn: "api" },
  HOT: { label: "Hot", targetMs: 100, runsIn: "api+realtime" },
  BACKGROUND: { label: "Light + background", targetMs: 300, runsIn: "api, then workers" },
  HEAVY: { label: "Heavy", targetMs: 300, runsIn: "workers (returns 202 + jobId)" },
} as const;

export type RouteClass = keyof typeof ROUTE_CLASSES;
