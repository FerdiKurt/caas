// services/offset-orchestrator/src/index.ts
import { Kafka } from "kafkajs";
import pg from "pg";
import { startMetricsServer, inc, metrics } from "@caas/shared-metrics/dist/index.js";

import "./vendor.mock.js";

const { Pool } = pg;

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "redpanda:9092").split(",");
const TOPIC_IN = process.env.KAFKA_TOPIC_EMISSIONS || "emissions.computed";

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: +(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "caas",
});

const kafka = new Kafka({ brokers: KAFKA_BROKERS });
const consumer = kafka.consumer({ groupId: "offset-orchestrator" });

async function handleEmission(messageValue: string) {
  const msg = JSON.parse(messageValue) as {
    chainId: number;
    txHash: string;
    kgCO2e: number;
    targetKgCO2e?: number;
    // ...any other fields you may send
  };

  // Simple MVP settlement: purchased = target (or exact kgCO2e if no target)
  const purchased = msg.targetKgCO2e ?? msg.kgCO2e;

  await pool.query(
    `INSERT INTO offset_orders (
       id, chain_id, tx_hash, purchased_kg_co2e, status, vendor
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, 'SETTLED', 'MOCK_VENDOR'
     ) ON CONFLICT (tx_hash) DO NOTHING`,
    [msg.chainId, msg.txHash, purchased]
  );

  inc("messages_consumed_total", 1);
  inc("orders_settled_total", 1);
  metrics.lastMessageAt = new Date().toISOString();
}

async function main() {
  // Metrics
  const port = Number(process.env.METRICS_PORT || 9103);
  await startMetricsServer(port);
  // eslint-disable-next-line no-console
  console.log(`[metrics] ${process.env.SERVICE_NAME || "offset-orchestrator"} listening on 0.0.0.0:${port}`);

  // Kafka
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC_IN, fromBeginning: false });
  // eslint-disable-next-line no-console
  console.log(`offset-orchestrator consuming from ${TOPIC_IN}`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      try {
        await handleEmission(message.value.toString("utf8"));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("orchestrator error", err);
        inc("errors_total", 1);
      }
    },
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
