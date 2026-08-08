#!/usr/bin/env bash
#
# Pull the images CI published and restart.
#
#   ./deploy/update.sh
#   ./deploy/update.sh --tag v1.4.0     pin a version instead of `latest`
#
# ## Why the server pulls instead of being pushed to
#
# It sits behind a Cloudflare Tunnel or a Tailscale tailnet and accepts no
# inbound connections — that is the whole point of those setups (see
# DEPLOY-PUBLICO.md), and it means GitHub cannot reach it. So the update is
# outbound: pull, migrate, restart. Run it by hand, or from cron:
#
#   0 4 * * *  cd /home/you/findhome && ./deploy/update.sh >> /tmp/findhome-update.log 2>&1
#
# ## What it will not do
#
# It never touches the database volume and it never runs a destructive Prisma
# command. `migrate deploy` applies pending migrations and nothing else; if one
# fails, the old containers are still running and this exits non-zero without
# restarting anything.

set -euo pipefail

cd "$(dirname "$0")/.."

TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?--tag needs a value}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ ! -f .env ]; then
  echo "error: no .env here. Run ./setup.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

if [ -z "${FINDHOME_IMAGE:-}" ]; then
  cat >&2 <<'MSG'
error: FINDHOME_IMAGE is not set in .env

Add your GHCR path, LOWER-CASED — GHCR is case-sensitive and the wrong case
fails with a 403 that reads like an authentication problem:

  FINDHOME_IMAGE=ghcr.io/your-user/findhome
  FINDHOME_TAG=latest
MSG
  exit 1
fi

[ -n "$TAG" ] && export FINDHOME_TAG="$TAG"
COMPOSE="docker compose -f docker-compose.yml -f deploy/ghcr-compose.yml"

echo "==> ${FINDHOME_IMAGE}:${FINDHOME_TAG:-latest}"

# A private package needs one login, stored by Docker afterwards:
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_USER --password-stdin
echo "==> pulling"
$COMPOSE pull

# Taken BEFORE the migration, not after. A migration that half-applies is exactly
# when a dump from five minutes ago is the difference between an inconvenience and
# a rebuild — and `make backup` is cheap.
if [ -x ./deploy/backup.sh ]; then
  echo "==> backing up first"
  ./deploy/backup.sh || echo "warning: backup failed; continuing" >&2
fi

echo "==> migrating"
$COMPOSE run --rm migrate

echo "==> restarting"
$COMPOSE up -d

echo "==> waiting for health"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT:-3000}/api/health" 2>/dev/null | grep -q '"database":"up"'; then
    echo "==> up"
    $COMPOSE ps
    exit 0
  fi
  sleep 5
done

echo "error: the app did not become healthy in 150s" >&2
$COMPOSE logs --tail=100 web
exit 1
