import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import pg from "pg";

const app = Fastify({ logger: false });
const { Pool } = pg;

// ----- Config -----
const API_KEY = process.env.API_KEY || "";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);

// ----- Metrics (in-memory, reset on restart) -----
type C = Record<string, number>;
const metrics = {
  startedAt: new Date().toISOString(),
  requests_total: {} as C,          // by route
  errors_total: {} as C,            // by route (status >= 400)
  latency_ms_sum: {} as C,          // by route
  latency_ms_count: {} as C,        // by route
};
const inc = (m: C, k: string, n = 1) => (m[k] = (m[k] || 0) + n);

// ----- DB -----
const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: +(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "caas",
});

// ----- Plugins -----
await app.register(cors, {
  origin: (origin, cb) => {
    if (CORS_ORIGIN === "*") return cb(null, true);
    const allowed = CORS_ORIGIN.split(",").map((s) => s.trim());
    cb(null, !origin || allowed.includes(origin));
  },
  credentials: false,
});

// Rate limit (skip /health and /metrics)
await app.register(rateLimit, {
  global: true,
  max: RATE_LIMIT_MAX,
  timeWindow: RATE_LIMIT_WINDOW_MS,
  keyGenerator: (req) => (req.headers["x-forwarded-for"] as string) || req.ip,
  allowList: (req) => req.url === "/health" || req.url === "/metrics",
});

// ----- Public routes -----
app.get("/health", async () => ({ status: "ok" }));

// Metrics (no auth) — JSON summary
app.get("/metrics", async () => {
  const avg = (route: string) =>
    (metrics.latency_ms_count[route] || 0) === 0
      ? 0
      : (metrics.latency_ms_sum[route] || 0) / metrics.latency_ms_count[route];
  const routes = Array.from(
    new Set([
      ...Object.keys(metrics.requests_total),
      ...Object.keys(metrics.errors_total),
      ...Object.keys(metrics.latency_ms_count),
    ]),
  );
  const perRoute = routes.map((r) => ({
    route: r,
    requests: metrics.requests_total[r] || 0,
    errors: metrics.errors_total[r] || 0,
    avg_latency_ms: Math.round(avg(r)),
  }));
  return {
    service: "api-gateway",
    startedAt: metrics.startedAt,
    routes: perRoute,
  };
});

// ----- Auth guard (everything except /health, /metrics) -----
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health" || req.url === "/metrics") return;
  if (!API_KEY) return reply.code(500).send({ error: "server_misconfig" });
  const header = (req.headers["x-api-key"] || "") as string;
  if (!header) return reply.code(401).send({ error: "unauthorized" });
  if (header !== API_KEY) return reply.code(403).send({ error: "forbidden" });
});

// ----- Metrics hooks (count + latency) -----
app.addHook("onRequest", async (req) => {
  (req as any)._t0 = Date.now();
});
app.addHook("onResponse", async (req, reply) => {
  const route = (req.routerPath || req.url || "unknown").toString();
  inc(metrics.requests_total, route, 1);
  const ms = Date.now() - ((req as any)._t0 || Date.now());
  inc(metrics.latency_ms_sum, route, ms);
  inc(metrics.latency_ms_count, route, 1);
  if (reply.statusCode >= 400) inc(metrics.errors_total, route, 1);
});

// ----- Routes -----
app.get("/tx/:hash", async (req, reply) => {
  const { hash } = req.params as { hash: string };
  const { rows } = await pool.query(
    `
    SELECT
      t.chain_id,
      t.tx_hash,
      t.block_number,
      t.observed_at,
      e.kg_co2e,
      e.calc_version,
      o.target_kg_co2e,
      o.purchased_kg_co2e,
      o.status AS order_status
    FROM tx_events t
    LEFT JOIN emissions e      ON e.tx_event_id = t.id
    LEFT JOIN offset_orders o  ON o.tx_event_id = t.id
    WHERE t.tx_hash = $1
    ORDER BY t.observed_at DESC
    LIMIT 1
    `,
    [hash]
  );
  if (!rows.length) return reply.code(404).send({ error: "not_found" });
  return rows[0];
});

app.get("/protocols/:slug/summary", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const { rows } = await pool.query(
    `
    SELECT
      p.slug,
      COUNT(DISTINCT t.id)                  AS tx_count,
      COALESCE(SUM(e.kg_co2e), 0)           AS total_emissions_kg,
      COALESCE(SUM(o.purchased_kg_co2e), 0) AS total_offset_kg
    FROM protocols p
    LEFT JOIN tx_events t  ON t.protocol_id = p.id
    LEFT JOIN emissions e  ON e.tx_event_id = t.id
    LEFT JOIN offset_orders o ON o.tx_event_id = t.id
    WHERE p.slug = $1
    GROUP BY p.slug
    `,
    [slug]
  );
  if (!rows.length) return reply.code(404).send({ error: "not_found" });
  return rows[0];
});

// ----- Start -----
app.listen({ port: 8080, host: "0.0.0.0" })
  .then(() => console.log("✅ API Gateway running on http://localhost:8080"));
