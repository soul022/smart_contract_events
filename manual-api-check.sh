#!/usr/bin/env bash
set -u

BASE="${BASE:-http://localhost:3000}"

INTEGRATOR="${INTEGRATOR:-0xb9c0de368bece5e76b52545a8e377a4c118f597b}"
OTHER_INTEGRATOR="0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae"
POLYGON_CONTRACT="0xbd6c7b0d2f68c2b7805d88388319cfb6ecb50ea9"
ETHEREUM_CONTRACT="0x3ef238c36035880efbdfa239d218186b79ad1d6f"
USDT_POLYGON="0xc2132d05d31c914a87c6611c10748aeb04b58e8f"
ZERO="0x0000000000000000000000000000000000000000"
LOWERCASE_INTEGRATOR="$INTEGRATOR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass=0
fail=0

run() {
  local name="$1"
  local expected="$2"
  local url="$3"

  local body="$TMP_DIR/body.json"
  local headers="$TMP_DIR/headers.txt"
  local actual

  actual="$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' "$url" || true)"

  if [[ "$actual" == "$expected" ]]; then
    printf 'PASS %-48s expected=%s actual=%s\n' "$name" "$expected" "$actual"
    printf '  URL: %s\n' "$url"
    printf '  Body: '
    cat "$body" 2>/dev/null || true
    printf '\n'
    pass=$((pass + 1))
  else
    printf 'FAIL %-48s expected=%s actual=%s\n' "$name" "$expected" "$actual"
    printf '  URL: %s\n' "$url"
    printf '  Body: '
    cat "$body" 2>/dev/null || true
    printf '\n'
    fail=$((fail + 1))
  fi
}

run_header_echo() {
  local name="valid request id echoed"
  local expected_id="manual-test-123"
  local body="$TMP_DIR/body.json"
  local headers="$TMP_DIR/headers.txt"
  local returned_id

  curl -sS -D "$headers" -o "$body" -H "X-Request-Id: $expected_id" "$BASE/events?integrator=$INTEGRATOR&limit=1" >/dev/null || true
  returned_id="$(awk 'BEGIN{IGNORECASE=1} /^X-Request-Id:/ {print $2}' "$headers" | tr -d '\r' | tail -n 1)"

  if [[ "$returned_id" == "$expected_id" ]]; then
    printf 'PASS %-48s echoed=%s\n' "$name" "$expected_id"
    printf '  URL: %s\n' "$BASE/events?integrator=$INTEGRATOR&limit=1"
    printf '  Body: '
    cat "$body" 2>/dev/null || true
    printf '\n'
    pass=$((pass + 1))
  else
    printf 'FAIL %-48s expected echoed=%s actual=%s\n' "$name" "$expected_id" "${returned_id:-<empty>}"
    printf '  Headers:\n'
    sed 's/^/    /' "$headers" 2>/dev/null || true
    fail=$((fail + 1))
  fi
}

run_header_replaced() {
  local name="$1"
  local bad_id="$2"
  local body="$TMP_DIR/body.json"
  local headers="$TMP_DIR/headers.txt"
  local returned_id

  curl -sS -D "$headers" -o "$body" -H "X-Request-Id: $bad_id" "$BASE/events?integrator=$INTEGRATOR&limit=1" >/dev/null || true
  returned_id="$(awk 'BEGIN{IGNORECASE=1} /^X-Request-Id:/ {print $2}' "$headers" | tr -d '\r' | tail -n 1)"

  if [[ -n "$returned_id" && "$returned_id" != "$bad_id" ]]; then
    printf 'PASS %-48s returned=%s\n' "$name" "$returned_id"
    printf '  URL: %s\n' "$BASE/events?integrator=$INTEGRATOR&limit=1"
    printf '  Body: '
    cat "$body" 2>/dev/null || true
    printf '\n'
    pass=$((pass + 1))
  else
    printf 'FAIL %-48s expected replacement request id, got=%s\n' "$name" "${returned_id:-<empty>}"
    printf '  Headers:\n'
    sed 's/^/    /' "$headers" 2>/dev/null || true
    fail=$((fail + 1))
  fi
}

echo "Manual API check"
echo "BASE=$BASE"
echo

echo "== Health =="
run "health" 200 "$BASE/health"

echo
echo "== Valid /events requests =="
run "required filter only" 200 "$BASE/events?integrator=$INTEGRATOR"
run "explicit limit" 200 "$BASE/events?integrator=$INTEGRATOR&limit=5"
run "limit clamped to max" 200 "$BASE/events?integrator=$INTEGRATOR&limit=999"
run "with offset" 200 "$BASE/events?integrator=$INTEGRATOR&limit=5&offset=5"
run "filter by chain name" 200 "$BASE/events?integrator=$INTEGRATOR&chain=polygon"
run "filter by chain id" 200 "$BASE/events?integrator=$INTEGRATOR&chainId=137"
run "chain name and id agree" 200 "$BASE/events?integrator=$INTEGRATOR&chain=polygon&chainId=137"
run "filter by contract address" 200 "$BASE/events?integrator=$INTEGRATOR&contractAddress=$POLYGON_CONTRACT"
run "filter by token" 200 "$BASE/events?integrator=$INTEGRATOR&token=$USDT_POLYGON"
run "native token zero allowed" 200 "$BASE/events?integrator=$INTEGRATOR&token=$ZERO"
run "combined filters" 200 "$BASE/events?integrator=$INTEGRATOR&chain=polygon&chainId=137&contractAddress=$POLYGON_CONTRACT&token=$USDT_POLYGON&limit=25&offset=0"
run "lowercase integrator accepted" 200 "$BASE/events?integrator=$LOWERCASE_INTEGRATOR&chain=polygon"
run "bad mixed-case checksum rejected" 400 "$BASE/events?integrator=0x1231DeB6F5749Ef6cE6943A275A1D3E7486F4EaE&chain=polygon"

echo
echo "== Invalid address scenarios =="
run "missing integrator" 400 "$BASE/events"
run "empty integrator" 400 "$BASE/events?integrator="
run "malformed integrator" 400 "$BASE/events?integrator=not-an-address"
run "zero integrator rejected" 400 "$BASE/events?integrator=$ZERO"
run "malformed contract address" 400 "$BASE/events?integrator=$INTEGRATOR&contractAddress=not-an-address"
run "zero contract address rejected" 400 "$BASE/events?integrator=$INTEGRATOR&contractAddress=$ZERO"
run "malformed token" 400 "$BASE/events?integrator=$INTEGRATOR&token=not-an-address"

echo
echo "== Invalid chain scenarios =="
run "unknown chain name" 400 "$BASE/events?integrator=$INTEGRATOR&chain=solana"
run "unknown chain id" 400 "$BASE/events?integrator=$INTEGRATOR&chainId=999999"
run "non-numeric chain id" 400 "$BASE/events?integrator=$INTEGRATOR&chainId=abc"
run "chain conflict" 400 "$BASE/events?integrator=$INTEGRATOR&chain=polygon&chainId=1"
run "chain whitespace trims" 200 "$BASE/events?integrator=$INTEGRATOR&chain=%20polygon%20"

echo
echo "== Invalid pagination scenarios =="
run "limit zero" 400 "$BASE/events?integrator=$INTEGRATOR&limit=0"
run "limit negative" 400 "$BASE/events?integrator=$INTEGRATOR&limit=-1"
run "limit decimal" 400 "$BASE/events?integrator=$INTEGRATOR&limit=1.5"
run "limit non-numeric" 400 "$BASE/events?integrator=$INTEGRATOR&limit=abc"
run "offset negative" 400 "$BASE/events?integrator=$INTEGRATOR&offset=-1"
run "offset decimal" 400 "$BASE/events?integrator=$INTEGRATOR&offset=1.5"
run "offset non-numeric" 400 "$BASE/events?integrator=$INTEGRATOR&offset=abc"

echo
echo "== Duplicate scalar rejection =="
run "duplicate integrator" 400 "$BASE/events?integrator=$INTEGRATOR&integrator=$OTHER_INTEGRATOR"
run "duplicate chain" 400 "$BASE/events?integrator=$INTEGRATOR&chain=polygon&chain=ethereum"
run "duplicate chain id" 400 "$BASE/events?integrator=$INTEGRATOR&chainId=137&chainId=1"
run "duplicate contract address" 400 "$BASE/events?integrator=$INTEGRATOR&contractAddress=$POLYGON_CONTRACT&contractAddress=$ETHEREUM_CONTRACT"
run "duplicate token" 400 "$BASE/events?integrator=$INTEGRATOR&token=$USDT_POLYGON&token=$ZERO"
run "duplicate limit" 400 "$BASE/events?integrator=$INTEGRATOR&limit=10&limit=20"
run "duplicate offset" 400 "$BASE/events?integrator=$INTEGRATOR&offset=0&offset=10"

echo
echo "== Request ID behavior =="
run_header_echo
run_header_replaced "invalid request id replaced" "bad id with spaces"
LONG_ID="$(python3 - <<'PY'
print('a' * 200)
PY
)"
run_header_replaced "overlong request id replaced" "$LONG_ID"

echo
echo "== URL and route guards =="
LONG_Q="$(python3 - <<'PY'
print('a' * 5000)
PY
)"
run "url length guard" 414 "$BASE/events?integrator=$INTEGRATOR&x=$LONG_Q"
run "unknown route" 404 "$BASE/not-found"

echo
echo "== Summary =="
printf 'PASS=%s FAIL=%s\n' "$pass" "$fail"

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
