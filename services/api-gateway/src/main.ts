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

// Use default hook (onRequest). Skip /health via allowList.
await app.register(rateLimit, {
  global: true,
  max: RATE_LIMIT_MAX,
  // both number (ms) and string are accepted; number keeps it simple
  timeWindow: RATE_LIMIT_WINDOW_MS,
  keyGenerator: (req) =>
    (req.headers["x-forwarded-for"] as string) || req.ip,
  allowList: (req) => req.url === "/health",
});

// ----- Public route -----
app.get("/health", async () => ({ status: "ok" }));

// ----- Auth guard (everything except /health) -----
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return; // public

  if (!API_KEY) {
    reply.code(500).send({ error: "server_misconfig", message: "API_KEY not set" });
    return;
  }
  const header = (req.headers["x-api-key"] || "") as string;
  if (!header) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  if (header !== API_KEY) {
    reply.code(403).send({ error: "forbidden" });
    return;
  }
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
app
  .listen({ port: 8080, host: "0.0.0.0" })
  .then(() => console.log("✅ API Gateway running on http://localhost:8080"));
