#!/usr/bin/env bash
set -euo pipefail

# === Load environment variables ===
if [ -f ../.env ]; then
  echo "→ Loading .env from project root..."
  set -a
  source ../.env
  set +a
else
  echo "❌ .env file not found at ../.env"
  exit 1
fi

# === Basic sanity checks ===
echo "→ API_KEY: ${API_KEY:-unset}"
echo "→ TEST_HASH: ${TEST_HASH:-unset}"

if [ -z "${API_KEY:-}" ]; then
  echo "❌ API_KEY not loaded."
  exit 1
fi

# === Health check ===
echo "→ Checking API Gateway health..."
curl -s http://localhost:8080/health | jq . || echo "(no health endpoint or jq missing)"

# === Verify auth with header ===
echo "→ Testing authorized request..."
curl -s -H "X-API-Key: $API_KEY" "http://localhost:8080/tx/$TEST_HASH" | jq . || true

# === Unauthorized check ===
echo "→ Testing unauthorized request..."
curl -s -H "X-API-Key: wrong-key" "http://localhost:8080/tx/$TEST_HASH" | jq . || true

echo "✅ Dev sanity checks complete."
