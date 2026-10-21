#!/usr/bin/env bash
# SOLAR v1.0.10 VPS deploy from the exact published release tag, not moving main.
# Uses existing production Compose mounts; never overwrites .env or persistent data.
# This deploy script is safe to run OUTSIDE the release source checkout.
set -Eeuo pipefail
umask 077

log() { printf '[SOLAR deploy] %s\n' "$*" >&2; }
fail() { log "ERROR: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Missing required executable: $1"; }

usage() {
  cat <<'HELP'
Usage:
  SOURCE_DIR=/absolute/path/to/solar-at-v1.0.10 PROD_DIR=/absolute/path/to/production \\
    bash scripts/deploy-v1.0.10-vps.sh --preflight

  SOURCE_DIR=/absolute/path/to/solar-at-v1.0.10 PROD_DIR=/absolute/path/to/production \\
    DEPLOY_APPROVED=YES BACKUP_CONFIRMED=YES \\
    bash scripts/deploy-v1.0.10-vps.sh --deploy

The source must be a clean checkout of the published v1.0.10 tag.
The release tag is pinned to commit 566a2b0d65569401491946103dafb8768fc3d062.
External Neon/Postgres and object-store backups require separate verification.
This script does not pull/checkout code, modify .env, or restore persistent data.
HELP
}
[[ $# -eq 1 ]] || { usage; exit 2; }
case "$1" in
  --preflight|--deploy) MODE="$1" ;;
  -h|--help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

for cmd in docker git node python3 realpath flock tar curl awk; do need "$cmd"; done
SOURCE_DIR="${SOURCE_DIR:-}"
PROD_DIR="${PROD_DIR:-}"
[[ "$SOURCE_DIR" == /* && -n "$SOURCE_DIR" ]] || fail 'Set SOURCE_DIR to an absolute checkout of the v1.0.10 tag.'
[[ "$PROD_DIR" == /* && -n "$PROD_DIR" ]] || fail 'Set PROD_DIR to the absolute production Compose directory.'
SOURCE_DIR="$(realpath -m "$SOURCE_DIR")"
PROD_DIR="$(realpath -m "$PROD_DIR")"
DEPLOY_APPROVED="$(printenv DEPLOY_APPROVED || true)"
BACKUP_CONFIRMED="$(printenv BACKUP_CONFIRMED || true)"
EXPECTED_SHA="566a2b0d65569401491946103dafb8768fc3d062"
EXPECTED_VERSION="1.0.10"
IMAGE_TAG="$(printenv IMAGE_TAG || printf 'mesthi/solar:local')"
CONTAINER_NAME="$(printenv CONTAINER_NAME || printf 'solar-app')"

# Actual deployment approvals are checked only AFTER read-only preflight validation.
[[ -f "$PROD_DIR/.env" && -d "$PROD_DIR/data" ]] || fail 'Production .env and data directory are required.'
[[ -f "$PROD_DIR/compose.vps.yml" && -f "$PROD_DIR/compose.source.yml" ]] || fail 'Missing production Docker Compose files.'
[[ -d "$SOURCE_DIR/.git" ]] || fail "Source is not a Git checkout: $SOURCE_DIR"
# A detached checkout of the v1.0.10 tag is expected; main can move ahead.
# Still verify the tag both locally and on the canonical upstream repository.
case "$(git -C "$SOURCE_DIR" remote get-url origin)" in
  https://github.com/arumora-id/solar|https://github.com/arumora-id/solar.git|git@github.com:arumora-id/solar|git@github.com:arumora-id/solar.git|ssh://git@github.com/arumora-id/solar|ssh://git@github.com/arumora-id/solar.git) ;;
  *) fail 'origin must be the official arumora-id/solar repository.' ;;
esac
git -C "$SOURCE_DIR" diff --quiet || fail 'Tracked source is modified.'
git -C "$SOURCE_DIR" diff --cached --quiet || fail 'Staged source is modified.'
ACTUAL_SHA="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
[[ "$ACTUAL_SHA" == "$EXPECTED_SHA" ]] || fail "Source commit $ACTUAL_SHA differs from release v1.0.10 ($EXPECTED_SHA)."
LOCAL_TAG_SHA="$(git -C "$SOURCE_DIR" rev-parse -q --verify 'refs/tags/v1.0.10^{commit}' 2>/dev/null)" \\
  || fail 'Local checkout must contain the v1.0.10 tag.'
[[ "$LOCAL_TAG_SHA" == "$EXPECTED_SHA" ]] || fail 'Local v1.0.10 tag points to another commit.'
REMOTE_TAG_REFS="$(git -C "$SOURCE_DIR" ls-remote --exit-code --tags origin 'refs/tags/v1.0.10' 'refs/tags/v1.0.10^{}')" \\
  || fail 'Origin tag v1.0.10 was not found.'
REMOTE_TAG_SHA="$(printf '%s\n' "$REMOTE_TAG_REFS" | awk '$2=="refs/tags/v1.0.10^{}" {print $1; exit}')"
if [[ -z "$REMOTE_TAG_SHA" ]]; then
  REMOTE_TAG_SHA="$(printf '%s\n' "$REMOTE_TAG_REFS" | awk '$2=="refs/tags/v1.0.10" {print $1; exit}')"
fi
[[ "$REMOTE_TAG_SHA" == "$EXPECTED_SHA" ]] || fail 'Origin v1.0.10 tag does not match the pinned release commit.'
# GitHub Release is a separate gate from the Git tag. The .exe and .zip must
# both be present before the operator may build the VPS Docker image.
curl --fail --silent --show-error --location --connect-timeout 10 --max-time 40 --retry 2 \\
  --header 'Accept: application/vnd.github+json' \\
  'https://api.github.com/repos/arumora-id/solar/releases/tags/v1.0.10' | python3 -c '
import json, sys
try:
  release=json.load(sys.stdin)
  files={a.get("name"): a.get("size", 0) for a in release.get("assets", [])}
  required=("SOLAR-AI-AGENT-Setup-1.0.10.exe", "SOLAR-AI-AGENT-server-1.0.10.zip")
  if release.get("tag_name")!="v1.0.10" or release.get("draft") or release.get("prerelease") or not release.get("published_at"):
    raise ValueError("v1.0.10 Release has not been published")
  if any(files.get(name, 0)<=0 for name in required):
    raise ValueError("v1.0.10 Release is missing the Windows or server asset")
except (ValueError, KeyError, json.JSONDecodeError) as exc:
  print("Release validation failed: "+str(exc), file=sys.stderr)
  sys.exit(1)
' || fail 'Official v1.0.10 Release validation failed.'
ACTUAL_VERSION="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$SOURCE_DIR/package.json")"
[[ "$ACTUAL_VERSION" == "$EXPECTED_VERSION" ]] || fail "Source version $ACTUAL_VERSION differs from expected $EXPECTED_VERSION."
grep -Fxq "export const APP_VERSION = '1.0.10';" "$SOURCE_DIR/apps/server/src/config.ts" \\
  || fail 'Source APP_VERSION is not 1.0.10.'
for pkg in packages/shared apps/server apps/web apps/desktop; do
  package_version="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$SOURCE_DIR/$pkg/package.json")"
  [[ "$package_version" == "$EXPECTED_VERSION" ]] || fail "$pkg version is not 1.0.10."
done

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
if [[ "$MODE" == --preflight ]]; then
  log "PREFLIGHT OK: published v1.0.10 ($EXPECTED_SHA), Compose source, mounts and current health (v$OLD_VERSION)."
  log 'No deployment, image build, container restart or data modification was performed.'
  exit 0
fi
[[ "$DEPLOY_APPROVED" == YES ]] || fail 'Set DEPLOY_APPROVED=YES after independent change approval.'
[[ "$BACKUP_CONFIRMED" == YES ]] || fail 'Set BACKUP_CONFIRMED=YES after consistent database/object-store backups are verified.'
OLD_IMAGE="$(docker_cmd inspect -f '{{.Image}}' "$CONTAINER_NAME")"
# Hold an independent rollback tag BEFORE the mutable service tag is rebuilt.
ROLLBACK_TAG="${IMAGE_TAG%:*}:rollback-before-v1.0.10-$(date -u +%Y%m%dT%H%M%SZ)"
docker_cmd tag "$OLD_IMAGE" "$ROLLBACK_TAG" || fail 'Could not protect the current image with a rollback tag.'
BACKUPS="$PROD_DIR/.solar-deploy-backups"
mkdir -p "$BACKUPS"
CHECKPOINT="$(mktemp -d "$BACKUPS/release-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
log "Checkpoint: $CHECKPOINT"
tar -C "$PROD_DIR" -czf "$CHECKPOINT/config.tar.gz" .env compose.vps.yml compose.source.yml
# Local files are copied best-effort while the app is running; this is NOT a consistent database snapshot.
tar -C "$PROD_DIR" -czf "$CHECKPOINT/data-best-effort.tar.gz" data
printf '%s\n' "$OLD_IMAGE" > "$CHECKPOINT/previous-image-id.txt"
printf '%s\n' "$ROLLBACK_TAG" > "$CHECKPOINT/previous-image-tag.txt"
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

log "Building published SOLAR v1.0.10 commit $EXPECTED_SHA"
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
