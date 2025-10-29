import { WebSocketProvider, Interface, Contract } from "ethers";
import { Kafka } from "kafkajs";
import pg from "pg";
import { startMetricsServer, metrics, inc } from "@caas/shared-metrics";

const { Pool } = pg;

// ---- Env ----
const RPC_WSS = process.env.RPC_ETHEREUM_WSS!;
const RPC_HTTPS = process.env.RPC_ETHEREUM_HTTPS || ""; // optional for receipt fallback (ethers v6 can still query over WSS provider)
const WRAPPER_ADDR = process.env.WRAPPER_ADDRESS_ETH!;
const TOPIC_RAW = process.env.KAFKA_TOPIC_TX_RAW || "tx.events.raw";
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "redpanda:9092").split(",");

const DB = {
  host: process.env.PGHOST || "postgres",
  port: +(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "caas",
};

// ---- ABI ----
const ABISIG = [
  "event TxForOffset(address indexed protocol, bytes32 indexed txHash, uint256 gasUsed, uint256 chainId, bytes meta)",
];

async function main() {
  // Metrics server (e.g., :9101)
  startMetricsServer(Number(process.env.METRICS_PORT || 9101)).catch((e) =>
    console.error("metrics server failed", e)
  );

  // DB
  const pool = new Pool(DB);

  // Kafka
  const kafka = new Kafka({ brokers: KAFKA_BROKERS });
  const producer = kafka.producer();
  await producer.connect();

  // Ethers
  const provider = new WebSocketProvider(RPC_WSS);
  const iface = new Interface(ABISIG);
  const contract = new Contract(WRAPPER_ADDR, ABISIG, provider);

  console.log("event-ingestor connected");

  contract.on(
    "TxForOffset",
    async (protocol: string, txHash: string, gasUsed: bigint, chainId: bigint, meta: string, ev: any) => {
      try {
        // Resolve blockNumber robustly
        let blockNumber: number | null =
          ev?.blockNumber ?? ev?.log?.blockNumber ?? null;

        if (blockNumber == null) {
          // ethers v6: provider.getTransactionReceipt works on WSS
          const txh = ev?.log?.transactionHash ?? ev?.transactionHash;
          if (txh) {
            const receipt = await provider.getTransactionReceipt(txh);
            blockNumber = receipt?.blockNumber ?? null;
          }
        }

        const payload = {
          version: "1",
          txHash,
          chainId: Number(chainId),
          gasUsed: gasUsed.toString(),
          blockNumber,
          observedAt: new Date().toISOString(),
          meta, // raw bytes
        };

        // DB insert (idempotent by unique(chain_id, tx_hash))
        try {
          await pool.query(
            `INSERT INTO tx_events(
               id, chain_id, protocol_id, tx_hash, block_number, gas_used, payload
             )
             VALUES (
               gen_random_uuid(), $1,
               (SELECT id FROM protocols ORDER BY created_at LIMIT 1),
               $2, $3, $4, $5
             )
             ON CONFLICT (chain_id, tx_hash) DO NOTHING`,
            [payload.chainId, payload.txHash, payload.blockNumber, payload.gasUsed, payload]
          );
        } catch (e) {
          inc("db_errors_total");
          throw e;
        }

        // Publish to Kafka
        try {
          await producer.send({
            topic: TOPIC_RAW,
            messages: [{ key: payload.txHash, value: JSON.stringify(payload) }],
          });
          inc("messages_produced_total");
        } catch (e) {
          inc("kafka_errors_total");
          throw e;
        }

        inc("messages_consumed_total"); // we "consumed" a chain event
        metrics.lastMessageAt = new Date().toISOString();

        console.log("event-ingestor → published", txHash, "block", blockNumber);
      } catch (err) {
        console.error("ingest error", err);
      }
    }
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
