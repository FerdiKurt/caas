import { Kafka } from "kafkajs";
import pg from "pg";
const { Pool } = pg;

// Topics (fallbacks if not set)
const TOPIC_EMISSIONS = process.env.KAFKA_TOPIC_EMISSIONS || "emissions.computed";
const TOPIC_OFFSETS = process.env.KAFKA_TOPIC_OFFSETS || "offset.orders";

// Kafka
const kafka = new Kafka({
  brokers: (process.env.KAFKA_BROKERS || "redpanda:9092").split(","),
});
const consumer = kafka.consumer({ groupId: "offset-orchestrator" });
const producer = kafka.producer();

// DB
const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: +(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "caas",
});

// MVP tier logic
function tierMultiplier(tier: string) {
  if (tier === "PREMIUM150") return 1.5;
  if (tier === "ENTERPRISE200") return 2.0;
  return 1.1; // BASIC110 default
}

async function main() {
  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: TOPIC_EMISSIONS, fromBeginning: false });
  console.log("offset-orchestrator running");

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const em = JSON.parse(message.value.toString()) as {
        txHash: string;
        chainId: number;
        kg_co2e: number;
      };

      try {
        // Find protocol & tx_event id
        const { rows } = await pool.query(
          `SELECT p.id AS protocol_id, p.tier, t.id AS tx_event_id
           FROM tx_events t
           JOIN protocols p ON p.id = t.protocol_id
           WHERE t.chain_id = $1 AND t.tx_hash = $2
           LIMIT 1`,
          [em.chainId, em.txHash]
        );
        if (!rows.length) {
          console.warn("no tx/protocol for", em.txHash);
          return;
        }
        const r = rows[0] as { protocol_id: string; tier: string; tx_event_id: string };

        const target = em.kg_co2e * tierMultiplier(r.tier);
        const costUsd = Math.max(0.02, target * 0.001); // MVP mock cost

        // Insert a settled mock order (requires pgcrypto extension for gen_random_uuid)
        await pool.query(
          `INSERT INTO offset_orders
            (id, protocol_id, tx_event_id, target_kg_co2e, purchased_kg_co2e, vendor, product_type, status, cost_usd)
           VALUES
            (gen_random_uuid(), $1, $2, $3, $4, 'mock', 'generic', 'SETTLED', $5)`,
          [r.protocol_id, r.tx_event_id, target, target, costUsd]
        );

        await producer.send({
          topic: TOPIC_OFFSETS,
          messages: [{ key: em.txHash, value: JSON.stringify({ txHash: em.txHash, target }) }],
        });

        console.log("order settled (mock)", em.txHash, target.toFixed(6));
      } catch (err) {
        console.error("offset error", err);
      }
    },
  });
}

// graceful shutdown
async function shutdown() {
  await consumer.disconnect().catch(() => {});
  await producer.disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
