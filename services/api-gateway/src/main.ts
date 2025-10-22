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

app.get("/protocols", async () => {
  const { rows } = await pool.query("SELECT id, name, slug, tier, created_at FROM protocols ORDER BY created_at DESC");
  return rows;
});

app.get("/health", async () => ({ status: "ok" }));

app.listen({ port: 8080, host: "0.0.0.0" })
  .then(() => console.log("✅ API Gateway running on http://localhost:8080"));
