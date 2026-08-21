#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/demo-user/Documents/Projekt Management Owner"
OPEN_PATH="/"
LISTEN_HOST="127.0.0.1"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/airbnb-hoa-operations.log"

for arg in "$@"; do
  case "$arg" in
    --display)
      OPEN_PATH="/display"
      ;;
    --lan)
      LISTEN_HOST="0.0.0.0"
      ;;
    *)
      echo "Unbekannte Option: $arg" >&2
      exit 2
      ;;
  esac
done

BASE_URL="http://127.0.0.1:4327"
URL="${BASE_URL}${OPEN_PATH}"
HEALTH_URL="${BASE_URL}/api/bootstrap"

mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR"

if ! /usr/bin/curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  /usr/bin/nohup /bin/zsh -lc 'cd "$1" && HOST="$2" npm start' airbnb-hoa "$PROJECT_DIR" "$LISTEN_HOST" >"$LOG_FILE" 2>&1 &

  for _ in {1..24}; do
    if /usr/bin/curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      break
    fi
    /bin/sleep 0.5
  done
fi

if ! /usr/bin/curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  /usr/bin/open -R "$LOG_FILE"
  echo "Airbnb HOA Operations konnte nicht gestartet werden. Log: $LOG_FILE" >&2
  exit 1
fi

/usr/bin/open "$URL"
