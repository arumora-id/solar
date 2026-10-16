#!/usr/bin/env bash
# SOLAR VPS deployment for a reviewed commit. Never runs merely by being present.
# Uses the existing production Docker Compose files; does not alter .env or application data.
set -Eeuo pipefail
umask 077

log() { printf '[SOLAR deploy] %s\n' "$*" >&2; }
fail() { log "ERROR: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Missing required executable: $1"; }

for cmd in docker git node python3 realpath flock tar; do need "$cmd"; done
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
PROD_DIR="$(printenv PROD_DIR || printf '%s' "$HOME/ai-project/solar")"
DEPLOY_APPROVED="$(printenv DEPLOY_APPROVED || true)"
BACKUP_CONFIRMED="$(printenv BACKUP_CONFIRMED || true)"
EXPECTED_SHA="$(printenv EXPECTED_SHA || true)"
EXPECTED_VERSION="$(printenv EXPECTED_VERSION || true)"
IMAGE_TAG="$(printenv IMAGE_TAG || printf 'mesthi/solar:local')"
CONTAINER_NAME="$(printenv CONTAINER_NAME || printf 'solar-app')"

[[ "$DEPLOY_APPROVED" == YES ]] || fail 'Set DEPLOY_APPROVED=YES after approval to deploy.'
[[ "$BACKUP_CONFIRMED" == YES ]] || fail 'Set BACKUP_CONFIRMED=YES only after verifying external database/object-store backups if used.'
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || fail 'EXPECTED_SHA must be the reviewed 40-character commit SHA.'
[[ "$EXPECTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'EXPECTED_VERSION must be a numeric release version.'
[[ -f "$PROD_DIR/.env" && -d "$PROD_DIR/data" ]] || fail 'Production .env and data directory are required.'
[[ -f "$PROD_DIR/compose.vps.yml" && -f "$PROD_DIR/compose.source.yml" ]] || fail 'Missing production Docker Compose files.'
[[ -d "$SOURCE_DIR/.git" ]] || fail "Source is not a Git checkout: $SOURCE_DIR"
[[ "$(git -C "$SOURCE_DIR" branch --show-current)" == main ]] || fail 'Deploy only reviewed code from local main, never a feature branch.'
git -C "$SOURCE_DIR" diff --quiet || fail 'Tracked source is modified.'
git -C "$SOURCE_DIR" diff --cached --quiet || fail 'Staged source is modified.'
ACTUAL_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || fail "Source commit $ACTUAL_SHA does not equal reviewed $EXPECTED_SHA."
ACTUAL_VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$SOURCE_DIR/package.json")"
[[ "$ACTUAL_VERSION" == "$EXPECTED_VERSION" ]] || fail "Source version $ACTUAL_VERSION differs from expected $EXPECTED_VERSION."

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    command docker "$@"
  elif command -v sudo >/dev/null && sudo -n docker info >/dev/null 2>&1; then
    sudo -n docker "$@"
  else
    fail 'No permission to access Docker.'
  fi
}
compose() {
  docker_cmd compose --project-directory "$PROD_DIR" \
    -f "$PROD_DIR/compose.vps.yml" -f "$PROD_DIR/compose.source.yml" "$@"
}
compose version >/dev/null || fail 'Docker Compose v2 is required.'
exec 9>"$PROD_DIR/.solar-deploy.lock"
flock -n 9 || fail 'Another deployment or rollback holds the lock.'

SERVICE="$(docker_cmd inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$CONTAINER_NAME" 2>/dev/null)" \
  || fail "Container $CONTAINER_NAME is not found."
[[ -n "$SERVICE" && "$SERVICE" != '<no value>' ]] || fail 'Container is not Compose-managed.'
WORK_DIR="$(docker_cmd inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CONTAINER_NAME")"
[[ "$(realpath -m "$WORK_DIR")" == "$(realpath -m "$PROD_DIR")" ]] || fail 'Container belongs to a different Compose project.'

# Resolve the actual production overlay before attempting a build or touching the container.
compose config --format json | python3 -c '
import json, os, sys
c=json.load(sys.stdin)
service=c["services"].get(sys.argv[1])
if not service: raise SystemExit("Compose service not found")
if service.get("image") != sys.argv[2]: raise SystemExit("Unexpected image tag")
build=service.get("build")
if not isinstance(build,dict) or os.path.realpath(build.get("context","")) != os.path.realpath(sys.argv[3]):
    raise SystemExit("Build context must point to the reviewed source checkout")
' "$SERVICE" "$IMAGE_TAG" "$SOURCE_DIR" || fail 'Compose overlay does not match the verified source.'
verify_mounts() {
  local env_mount data_mount
  env_mount="$(docker_cmd inspect -f '{{range .Mounts}}{{if eq .Destination "/app/.env"}}{{.Source}}{{end}}{{end}}' "$CONTAINER_NAME")"
  data_mount="$(docker_cmd inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$CONTAINER_NAME")"
  [[ -n "$env_mount" && -n "$data_mount" ]] || return 1
  [[ "$(realpath -m "$env_mount")" == "$(realpath -m "$PROD_DIR/.env")" ]] &&
    [[ "$(realpath -m "$data_mount")" == "$(realpath -m "$PROD_DIR/data")" ]]
}
verify_mounts || fail 'The current production .env/data mounts differ from expected paths.'

health_version() {
  docker_cmd exec "$CONTAINER_NAME" node -e '
const port=process.env.PORT || "8790";
fetch("http://127.0.0.1:"+port+"/api/health",{signal:AbortSignal.timeout(4000)})
.then(async r=>{if(!r.ok)throw Error("HTTP "+r.status);const x=await r.json();
if(x.ok!==true || !x.version)throw Error("Invalid health response");process.stdout.write(x.version);})
.catch(e=>{console.error(e.message);process.exit(1);});
' 2>/dev/null
}
wait_health() {
  local n version
  for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if version="$(health_version)" && [[ "$version" == "$1" ]]; then return 0; fi
    sleep 3
  done
  return 1
}

OLD_VERSION="$(health_version)" || fail 'Current production health check failed.'
OLD_IMAGE="$(docker_cmd inspect -f '{{.Image}}' "$CONTAINER_NAME")"
BACKUPS="$PROD_DIR/.solar-deploy-backups"
mkdir -p "$BACKUPS"
CHECKPOINT="$(mktemp -d "$BACKUPS/release-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
log "Checkpoint: $CHECKPOINT"
tar -C "$PROD_DIR" -czf "$CHECKPOINT/config.tar.gz" .env compose.vps.yml compose.source.yml
# Local files are copied best-effort while the app is running; this is NOT a consistent database snapshot.
tar -C "$PROD_DIR" -czf "$CHECKPOINT/data-best-effort.tar.gz" data
printf '%s\n' "$OLD_IMAGE" > "$CHECKPOINT/previous-image-id.txt"
printf '%s\n' "$OLD_VERSION" > "$CHECKPOINT/previous-version.txt"
printf '%s\n' "$EXPECTED_SHA" > "$CHECKPOINT/source-sha.txt"
printf '%s\n' "$SERVICE" > "$CHECKPOINT/service.txt"

restore_previous() {
  log 'Attempting automatic IMAGE rollback; persistent data is never restored over live data.'
  if docker_cmd tag "$OLD_IMAGE" "$IMAGE_TAG" &&
    compose up -d --no-deps --no-build --force-recreate "$SERVICE" &&
    verify_mounts && wait_health "$OLD_VERSION"; then
    log "Image rollback succeeded (v$OLD_VERSION)."
  else
    log "CRITICAL: rollback could not be verified. Inspect docker logs and $CHECKPOINT."
  fi
}

log "Building reviewed SOLAR commit $EXPECTED_SHA"
if ! compose build "$SERVICE"; then restore_previous; fail 'Build failed'; fi
if ! compose up -d --no-deps --no-build --force-recreate "$SERVICE"; then
  restore_previous; fail 'Container recreation failed'
fi
if ! verify_mounts || ! wait_health "$EXPECTED_VERSION"; then
  restore_previous; fail 'Health or mount check failed'
fi
docker_cmd inspect -f '{{.Image}}' "$CONTAINER_NAME" > "$CHECKPOINT/new-image-id.txt"
log "SUCCESS: version $EXPECTED_VERSION, SHA $EXPECTED_SHA"
log "Checkpoint for manual rollback: $CHECKPOINT"
