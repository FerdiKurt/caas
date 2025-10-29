import { Kafka } from "kafkajs";
import pg from "pg";
import { startMetricsServer, metrics, inc } from "@caas/shared-metrics";

const { Pool } = pg;

// ---- Env ----
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "redpanda:9092").split(",");
const TOPIC_RAW = process.env.KAFKA_TOPIC_TX_RAW || "tx.events.raw";
const TOPIC_EMISSIONS = process.env.KAFKA_TOPIC_EMISSIONS || "emissions.computed";
const GROUP_ID = process.env.KAFKA_GROUP_ID || "carbon-calc";
const CALC_VERSION = process.env.CALC_VERSION || "v0-mvp";

const DB = {
  host: process.env.PGHOST || "postgres",
  port: +(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "caas",
};

// Simple MVP calc: 0.00000001 kg per unit gas (example), plus chain factor (1.0)
function calcKgCO2e(gasUsed: string, chainId: number): number {
  const gas = BigInt(gasUsed);
  const perGas = 1e-8; // tune later
  const base = Number(gas) * perGas;
  const chainFactor = 1.0; // could vary by chainId
  return base * chainFactor;
}

async function main() {
  // Metrics server (e.g., :9102)
  startMetricsServer(Number(process.env.METRICS_PORT || 9102)).catch((e) =>
    console.error("metrics server failed", e)
  );

  const pool = new Pool(DB);
  const kafka = new Kafka({ brokers: KAFKA_BROKERS });

  const consumer = kafka.consumer({ groupId: GROUP_ID });
  const producer = kafka.producer();

  await consumer.connect();
  await producer.connect();

  await consumer.subscribe({ topic: TOPIC_RAW, fromBeginning: false });

  console.log("carbon-calc consuming from", TOPIC_RAW);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        if (!message.value) return;
        const payload = JSON.parse(message.value.toString()) as {
          version: string;
          txHash: string;
          chainId: number;
          gasUsed: string;
          blockNumber: number | null;
          observedAt: string;
          meta?: string;
        };

        inc("messages_consumed_total");

        const kg_co2e = calcKgCO2e(payload.gasUsed, payload.chainId);
        const emitMsg = {
          version: "1",
          txHash: payload.txHash,
          chainId: payload.chainId,
          kg_co2e,
          calc_version: CALC_VERSION,
          observedAt: new Date().toISOString(),
        };

        // Persist emissions row (link to tx_events)
        try {
          await pool.query(
            `
            INSERT INTO emissions (tx_event_id, kg_co2e, calc_version)
            VALUES (
              (SELECT id FROM tx_events WHERE chain_id = $1 AND tx_hash = $2 LIMIT 1),
              $3, $4
            )
            ON CONFLICT (tx_event_id) DO UPDATE
              SET kg_co2e = EXCLUDED.kg_co2e,
                  calc_version = EXCLUDED.calc_version
            `,
            [payload.chainId, payload.txHash, kg_co2e, CALC_VERSION]
          );
        } catch (e) {
          inc("db_errors_total");
          throw e;
        }

        // Publish computed emission
        try {
          await producer.send({
            topic: TOPIC_EMISSIONS,
            messages: [{ key: payload.txHash, value: JSON.stringify(emitMsg) }],
          });
          inc("messages_produced_total");
        } catch (e) {
          inc("kafka_errors_total");
          throw e;
        }

        metrics.lastMessageAt = new Date().toISOString();
        // console.log("carbon-calc → emitted", payload.txHash, "kg", kg_co2e);
      } catch (err) {
        console.error("carbon-calc error", err);
      }
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
