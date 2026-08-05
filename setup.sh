#!/usr/bin/env bash
#
# FindHome — one-command bootstrap for an Ubuntu/Debian home server.
#
#   git clone <repo> findhome && cd findhome
#   ./setup.sh
#
# What it does (each step is idempotent — re-running is safe):
#   1. verifies/installs Docker Engine + the compose plugin
#   2. generates .env with strong random secrets (never overwrites an existing one)
#   3. builds the images and starts the stack
#   4. waits for the health probe, applies migrations, optionally seeds demo data
#   5. optionally installs a systemd unit (start on boot) and a nightly backup cron
#   6. prints the LAN URL and the demo credentials
#
# Flags:
#   --no-seed        skip the demo data
#   --no-systemd     skip the systemd unit
#   --no-cron        skip the nightly backup cron entry
#   --unattended     accept all defaults, never prompt
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SEED=1
SYSTEMD=1
CRON=1
UNATTENDED=0

for arg in "$@"; do
  case "$arg" in
    --no-seed)    SEED=0 ;;
    --no-systemd) SYSTEMD=0 ;;
    --no-cron)    CRON=0 ;;
    --unattended) UNATTENDED=1 ;;
    -h|--help)    sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
step() { echo; echo "${BOLD}==> $*${RESET}"; }
ok()   { echo "  ${GREEN}✓${RESET} $*"; }
warn() { echo "  ${YELLOW}!${RESET} $*"; }
die()  { echo "  ${RED}✗${RESET} $*" >&2; exit 1; }

ask() {
  # ask "question" "default(y|n)" -> returns 0 for yes
  local prompt="$1" default="$2" reply
  if [ "$UNATTENDED" = 1 ]; then [ "$default" = y ]; return; fi
  read -r -p "  $prompt [$([ "$default" = y ] && echo 'Y/n' || echo 'y/N')] " reply || true
  reply="${reply:-$default}"
  [[ "$reply" =~ ^[Yy]$ ]]
}

SUDO=''
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "Run as root or install sudo."
  SUDO='sudo'
fi

# ---------------------------------------------------------------------------
step "1/6  Checking prerequisites"

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker is not installed."
  if ask "Install Docker Engine from get.docker.com?" y; then
    curl -fsSL https://get.docker.com | $SUDO sh
    $SUDO usermod -aG docker "$(id -un)" || true
    warn "You were added to the 'docker' group — log out and back in for it to take effect."
  else
    die "Docker is required. See https://docs.docker.com/engine/install/"
  fi
fi
ok "docker $(docker --version | awk '{print $3}' | tr -d ,)"

docker compose version >/dev/null 2>&1 \
  || die "The Docker Compose v2 plugin is missing. Install docker-compose-plugin."
ok "compose $(docker compose version --short)"

docker info >/dev/null 2>&1 \
  || die "Cannot talk to the Docker daemon. Start it (systemctl start docker) or re-login for group membership."

command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets (apt install openssl)."

# ---------------------------------------------------------------------------
step "2/6  Configuration (.env)"

if [ -f .env ]; then
  ok ".env already exists — leaving it untouched"
else
  [ -f .env.example ] || die ".env.example is missing; are you in the project root?"
  cp .env.example .env

  # Secrets: base64 with the shell-hostile characters stripped, so the values
  # survive compose interpolation and psql connection strings unquoted.
  PG_PASS="$(openssl rand -base64 24 | tr -d '/+=\n')"
  JWT="$(openssl rand -base64 60 | tr -d '/+=\n' | cut -c1-64)"
  SEED_PASS="$(openssl rand -base64 12 | tr -d '/+=\n')"
  # Guards the scraper's manual-run endpoint. Hex, so no character in it can be
  # misread by compose interpolation or a shell.
  CONTROL_TOKEN="$(openssl rand -hex 24)"

  # Fill in the placeholders (| delimiter: the values contain no pipes).
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|"                   .env
  sed -i "s|^SEED_PASSWORD=.*|SEED_PASSWORD=${SEED_PASS}|"       .env
  sed -i "s|^SCRAPE_CONTROL_TOKEN=.*|SCRAPE_CONTROL_TOKEN=${CONTROL_TOKEN}|" .env

  HOST_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC)"
  sed -i "s|^TZ=.*|TZ=${HOST_TZ}|" .env

  chmod 600 .env
  ok "generated .env with random secrets (mode 600, timezone ${HOST_TZ})"
fi

# Read individual keys instead of sourcing the file: .env legitimately holds
# values with spaces (SCRAPE_CRON, SCRAPE_DEFAULT_CITY) that `. ./.env` would
# try to execute.
env_get() { sed -n "s/^$1=//p" .env | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"; }

WEB_PORT="$(env_get WEB_PORT)"; WEB_PORT="${WEB_PORT:-3000}"
SEED_PASSWORD="$(env_get SEED_PASSWORD)"

mkdir -p backups
chmod +x deploy/backup.sh 2>/dev/null || true

# ---------------------------------------------------------------------------
step "3/6  Building images and starting the stack"
echo "  (the scraper image downloads Chromium — expect several minutes the first time)"

docker compose up -d --build

# ---------------------------------------------------------------------------
step "4/6  Waiting for the app to become healthy"

READY=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 3
  printf '.'
done
echo

if [ "$READY" = 1 ]; then
  ok "http://127.0.0.1:${WEB_PORT}/api/health is up"
else
  warn "The app did not answer within 3 minutes."
  warn "Check the logs:  docker compose logs -f web migrate"
fi

# `migrate` already ran as a one-shot dependency; confirm it succeeded.
MIGRATE_CODE="$(docker inspect -f '{{.State.ExitCode}}' findhome-migrate 2>/dev/null || echo '?')"
if [ "$MIGRATE_CODE" = "0" ]; then
  ok "database migrations applied"
else
  warn "the migrate container exited with code ${MIGRATE_CODE} — run: docker compose logs migrate"
fi

if [ "$SEED" = 1 ] && ask "Load demo accounts, a demo party and sample listings?" y; then
  if docker compose run --rm migrate npm run db:seed; then
    ok "demo data loaded"
  else
    warn "seeding failed — the app still works, just with an empty database"
    SEED=0
  fi
else
  SEED=0
fi

# ---------------------------------------------------------------------------
step "5/6  Boot persistence and backups"

if [ "$SYSTEMD" = 1 ] && command -v systemctl >/dev/null 2>&1; then
  if ask "Install a systemd unit so FindHome starts on boot?" y; then
    $SUDO tee /etc/systemd/system/findhome.service >/dev/null <<UNIT
[Unit]
Description=FindHome (docker compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${ROOT}
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
UNIT
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable findhome.service >/dev/null
    ok "systemd unit installed and enabled (systemctl status findhome)"
  fi
else
  warn "skipping systemd unit"
fi

if [ "$CRON" = 1 ]; then
  if ask "Add a nightly database backup at 03:15 to your crontab?" y; then
    CRON_LINE="15 3 * * * cd ${ROOT} && ./deploy/backup.sh >> ${ROOT}/backups/backup.log 2>&1"
    # Replace any previous FindHome entry rather than stacking duplicates.
    ( crontab -l 2>/dev/null | grep -v 'deploy/backup.sh' || true; echo "$CRON_LINE" ) | crontab -
    ok "cron entry installed (crontab -l to review)"
  fi
else
  warn "skipping backup cron"
fi

# ---------------------------------------------------------------------------
step "6/6  Done"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "${LAN_IP:-}" ] || LAN_IP='<server-ip>'

cat <<SUMMARY

  ${BOLD}FindHome is running.${RESET}

    On this machine   http://127.0.0.1:${WEB_PORT}
    On your LAN       http://${LAN_IP}:${WEB_PORT}

SUMMARY

if [ "$SEED" = 1 ]; then
  cat <<CREDS
  ${BOLD}Demo accounts${RESET} (password: ${SEED_PASSWORD})
    alex@findhome.local   owner of the demo party
    sam@findhome.local    member of the demo party
    Invite code: DEMO2026

CREDS
else
  echo "  Open the URL above and register the first account."
  echo
fi

cat <<NEXT
  ${BOLD}Next steps${RESET}
    make logs                 follow all logs
    make scrape               run the scraper now and wait for it
    make scrape-now           run it in the background (same as the app's button)
    make doctor               probe every portal and report what is broken
    make backup               dump the database to ./backups

  The scraper defaults to ${BOLD}SCRAPE_SOURCES=DEMO${RESET} (synthetic listings, no network
  calls) so you can verify the pipeline first. To switch to the real portals:

    1. set SCRAPE_SOURCES in .env, e.g. ZAP,VIVA_REAL,QUINTO_ANDAR,OLX
    2. docker compose up -d scraper
    3. ${BOLD}make doctor${RESET}  — confirm each one actually answers before trusting it

  Portals break: set a City AND a State in Preferences, because two of them
  scope their search by state and return the wrong region without it.

  Once everyone has an account, set ALLOW_REGISTRATION=false in .env.
NEXT
