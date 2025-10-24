import Fastify from "fastify";
import pg from "pg";

const app = Fastify();
const pool = new pg.Pool({
  host: process.env.PGHOST || "postgres",
  port: +(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "caas",
});

// Health
app.get("/health", async () => ({ status: "ok" }));

// 🔎 Join endpoint: tx → emission → offset (latest record for a tx hash)
app.get("/tx/:hash", async (req, reply) => {
  const { hash } = req.params as { hash: string };
  const { rows } = await pool.query(
    `SELECT
       t.chain_id, t.tx_hash, t.block_number, t.observed_at,
       e.kg_co2e, e.calc_version,
       o.target_kg_co2e, o.purchased_kg_co2e, o.status AS order_status
     FROM tx_events t
     LEFT JOIN emissions e ON e.tx_event_id = t.id
     LEFT JOIN offset_orders o ON o.tx_event_id = t.id
     WHERE t.tx_hash = $1
     ORDER BY t.observed_at DESC
     LIMIT 1`,
    [hash]
  );
  if (!rows.length) return reply.code(404).send({ error: "not_found" });
  return rows[0];
});


// (Optional) simple protocol summary for quick checks
app.get("/protocols/:slug/summary", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const { rows } = await pool.query(
    `
    SELECT
      p.slug,
      COUNT(DISTINCT t.id)                         AS tx_count,
      COALESCE(SUM(e.kg_co2e), 0)                  AS total_emissions_kg,
      COALESCE(SUM(o.purchased_kg_co2e), 0)        AS total_offset_kg
    FROM protocols p
    LEFT JOIN tx_events t   ON t.protocol_id = p.id
    LEFT JOIN emissions e   ON e.tx_event_id = t.id
    LEFT JOIN offset_orders o ON o.tx_event_id = t.id
    WHERE p.slug = $1
    GROUP BY p.slug
    `,
    [slug]
  );
  if (!rows.length) return reply.code(404).send({ error: "not_found" });
  return rows[0];
});

app.listen({ port: 8080, host: "0.0.0.0" })
  .then(() => console.log("✅ API Gateway running on http://localhost:8080"));
