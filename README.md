# 🌍 Carbon-as-a-Service (CaaS)

Making every DeFi transaction remove CO₂ from the atmosphere — automatically.

This repository contains the **MVP implementation** of the Carbon-as-a-Service protocol, inspired by the [Medium concept article](https://medium.com/coinmonks/introducing-carbon-as-a-service-making-every-defi-transaction-remove-co2-from-the-atmosphere-e7b651fbd477).  
The system tracks blockchain transactions, estimates their carbon footprint, and orchestrates carbon offset purchases through mock vendors — fully automated via a microservice architecture.

---


## ⚙️ Tech Stack

| Layer | Technologies |
|-------|---------------|
| **Smart Contracts** | Solidity, Foundry (forge/cast) |
| **Event Pipeline** | Ethers.js, KafkaJS, Redpanda |
| **Database** | PostgreSQL (via node-pg) |
| **Runtime** | Node.js 20 + PNPM workspaces |
| **Infra** | Docker Compose for local orchestration |

---

## 🚀 Quick Start

### 1. Clone & setup
```bash
git clone https://github.com/<your-org>/caas.git
cd caas
cp infra/.env.example .env
```
### 2. Build and start core stack
```bash
cd infra
docker compose up -d --build

# check running services:
docker compose ps
```
## 🪙 Contract Deployment
```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url $RPC_ETHEREUM_WSS --private-key $PRIVATE_KEY --broadcast

# Save the deployed address to .env:
WRAPPER_ADDRESS_ETH=0xYourDeployedWrapper

# Allowlist your wallet:
cast send $WRAPPER_ADDRESS_ETH \
  "setProtocol(address,bool)" 0x<YOUR_EOA> true \
  --rpc-url "$RPC_ETHEREUM_WSS" --private-key $PRIVATE_KEY
```
## 🧩 Trigger an End-to-End Flow
```bash
export TEST_HASH=0xabc0000000000000000000000000000000000000000000000000000000000abc
cast send $WRAPPER_ADDRESS_ETH \
  "emitTxForOffset(bytes32,uint256,bytes)" \
  $TEST_HASH 120000 0x \
  --rpc-url "$RPC_ETHEREUM_HTTPS" --private-key $PRIVATE_KEY

# Follow the pipeline logs:
docker compose -f infra/docker-compose.yml logs -f --tail=100 event-ingestor carbon-calc offset-orchestrator
```
## 📡 Verify Results
```bash
# REST Api
curl "http://localhost:8080/tx/$TEST_HASH"

# Sample output:
{
  "chain_id": 11155111,
  "tx_hash": "0xabc...",
  "block_number": "9474103",
  "kg_co2e": 0.0012,
  "target_kg_co2e": 0.00132,
  "purchased_kg_co2e": 0.00132,
  "order_status": "SETTLED"
}
```