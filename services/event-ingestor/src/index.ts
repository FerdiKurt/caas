import { WebSocketProvider, Interface, Contract } from "ethers";
import { Kafka } from "kafkajs";
import pg from "pg";

const { Pool } = pg;
const RPC_WSS = process.env.RPC_ETHEREUM_WSS!;
const WRAPPER_ADDR = process.env.WRAPPER_ADDRESS_ETH!;
const TOPIC_RAW = process.env.KAFKA_TOPIC_TX_RAW || "tx.events.raw";

const ABISIG = [
  "event TxForOffset(address indexed protocol, bytes32 indexed txHash, uint256 gasUsed, uint256 chainId, bytes meta)"
];

const provider = new WebSocketProvider(RPC_WSS);
const iface = new Interface(ABISIG);
const contract = new Contract(WRAPPER_ADDR, ABISIG, provider);

const kafka = new Kafka({
  brokers: (process.env.KAFKA_BROKERS || "redpanda:9092").split(","),
});
const producer = kafka.producer();

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: +(process.env.PGPORT || 5432),
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "caas",
});

async function main() {
  await producer.connect();
  console.log("event-ingestor connected");

  contract.on("TxForOffset", async (protocol, txHash, gasUsed, chainId, meta, ev) => {
    try {
      // Prefer direct values, then fall back to receipt lookup
      let blockNumber: number | null =
        (ev as any)?.blockNumber ??
        (ev as any)?.log?.blockNumber ??
        null;

      if (blockNumber == null) {
        const txh = (ev as any)?.log?.transactionHash ?? (ev as any)?.transactionHash;
        if (txh) {
          const receipt = await provider.getTransactionReceipt(txh);
          blockNumber = receipt?.blockNumber ?? null;
        }
      }

      const payload = {
        protocol,
        txHash,
        gasUsed: gasUsed.toString(),
        chainId: Number(chainId),
        meta,
        blockNumber,
        observedAt: new Date().toISOString(),
      };

      await pool.query(
        `INSERT INTO tx_events (
          id, chain_id, protocol_id, tx_hash, block_number, gas_used, payload
        ) VALUES (
          gen_random_uuid(), $1,
          (SELECT id FROM protocols ORDER BY created_at LIMIT 1),
          $2, $3, $4, $5
        ) ON CONFLICT (chain_id, tx_hash) DO NOTHING`,
        [payload.chainId, payload.txHash, payload.blockNumber, payload.gasUsed, payload]
      );

      await producer.send({
        topic: TOPIC_RAW,
        messages: [{ key: payload.txHash, value: JSON.stringify(payload) }],
      });

      console.log("event-ingestor → published", txHash, "block", blockNumber);
    } catch (err) {
      console.error("ingest error", err);
    }
  });

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
