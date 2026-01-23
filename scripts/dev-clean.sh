#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

port="${APP_PORT:-3000}"

if command -v lsof >/dev/null 2>&1; then
  port_pids="$(lsof -t -iTCP:${port} -sTCP:LISTEN || true)"
  if [ -n "$port_pids" ]; then
    kill $port_pids || true
    sleep 0.2
  fi
fi

dist_pids="$(pgrep -f 'node dist/server.js' || true)"
if [ -n "$dist_pids" ]; then
  kill $dist_pids || true
fi

exec npm run dev
