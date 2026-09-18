#!/usr/bin/env bash
# Lance le site en local et l'ouvre dans le navigateur.
#   ./go.sh          valide, construit, sert dist/ sur http://localhost:8765
#   ./go.sh build    valide et construit seulement
set -euo pipefail
cd "$(dirname "$0")"

node validate.js
node build.js

if [ "${1:-}" = "build" ]; then exit 0; fi

PORT="${PORT:-8765}"
URL="http://localhost:$PORT/"
echo "Page servie sur $URL  (Ctrl+C pour arrêter)"
( sleep 1; (xdg-open "$URL" || true) >/dev/null 2>&1 & ) &
exec python3 -m http.server "$PORT" --directory dist --bind 127.0.0.1
