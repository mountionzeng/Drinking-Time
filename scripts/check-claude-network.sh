#!/usr/bin/env bash
set -euo pipefail

PROXY_URL="${CLAUDE_PROXY_URL:-http://127.0.0.1:7890}"

echo "Checking Anthropic API through ${PROXY_URL} ..."
curl -v --max-time 15 -x "${PROXY_URL}" https://api.anthropic.com/

