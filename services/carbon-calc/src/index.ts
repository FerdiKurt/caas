import { Kafka } from "kafkajs";
import pg from "pg";
const { Pool } = pg;

const TOPIC_RAW = process.env.KAFKA_TOPIC_TX_RAW || "tx.events.raw";
const TOPIC_EMISSIONS = process.env.KAFKA_TOPIC_EMISSIONS || "emissions.computed";

const kafka = new Kafka({ brokers: (process.env.KAFKA_BROKERS || "redpanda:9092").split(",") });
const consumer = kafka.consumer({ groupId: "carbon-calc" });
const producer = kafka.producer();

const pool = new Pool({
    host: process.env.PGHOST || "postgres",
    port: +(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: process.env.PGDATABASE || "caas",
});

function factorForChain(chainId: number): number {
    if (chainId === 1) return +(process.env.ETH_ENERGY_FACTOR_KG_PER_GAS || 0);
    if (chainId === 137) return +(process.env.POLYGON_ENERGY_FACTOR_KG_PER_GAS || 0);

    return +(process.env.ETH_ENERGY_FACTOR_KG_PER_GAS || 0); // default
}

async function main() {
    await consumer.connect();
    await producer.connect();
    await consumer.subscribe({ topic: TOPIC_RAW, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ message }) => {
        if (!message.value) return;
        const ev = JSON.parse(message.value.toString());
        const gasUsed = BigInt(ev.gasUsed);
        const kg = Number(gasUsed) * factorForChain(ev.chainId);
        const calc = {
            txHash: ev.txHash,
            chainId: ev.chainId,
            kg_co2e: kg,
            calc_version: "v0-mvp",
            details: { factor_kg_per_gas: factorForChain(ev.chainId) }
    };

    // persist if exists in tx_events
    await pool.query(
        `INSERT INTO emissions(id, tx_event_id, kg_co2e, calc_version, details)
        SELECT gen_random_uuid(), t.id, $1, $2, $3::jsonb FROM tx_events t
        WHERE t.chain_id=$4 AND t.tx_hash=$5
        ON CONFLICT (tx_event_id) DO NOTHING`,
        [calc.kg_co2e, calc.calc_version, calc.details, calc.chainId, calc.txHash]          
    );
            await producer.send({
                topic: TOPIC_EMISSIONS,
                messages: [{ key: calc.txHash, value: JSON.stringify(calc) }]
            });
            
        console.log("computed emission", calc.txHash, calc.kg_co2e);
        }
    });
}


main().catch((e) => { console.error(e); process.exit(1); });