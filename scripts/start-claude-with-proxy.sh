#!/usr/bin/env bash
set -euo pipefail

# Use Claude subscription login. API-key variables from old 302.ai sessions can
# confuse Claude Code, so clear them before launching.
unset ANTHROPIC_API_KEY
unset ANTHROPIC_BASE_URL

# Avoid carrying custom certificate settings into Claude Code.
unset NODE_EXTRA_CA_CERTS
unset SSL_CERT_FILE
unset REQUESTS_CA_BUNDLE
unset CURL_CA_BUNDLE

PROXY_URL="${CLAUDE_PROXY_URL:-http://127.0.0.1:7890}"

export HTTPS_PROXY="${PROXY_URL}"
export HTTP_PROXY="${PROXY_URL}"
export ALL_PROXY="${PROXY_URL}"
export NO_PROXY="localhost,127.0.0.1,::1"

exec claude "$@"

