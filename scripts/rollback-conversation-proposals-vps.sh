#!/usr/bin/env bash
# Roll back SOLAR application image using a deploy-conversation-proposals-vps.sh checkpoint.
# Never restore databases or persistent data automatically.
set -Eeuo pipefail
umask 077
fail() { printf '[SOLAR rollback] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[SOLAR rollback] %s\n' "$*" >&2; }
for cmd in docker realpath flock; do command -v "$cmd" >/dev/null 2>&1 || fail "Missing: $cmd"; done

ROLLBACK_APPROVED="$(printenv ROLLBACK_APPROVED || true)"
PROD_DIR="$(printenv PROD_DIR || printf '%s' "$HOME/ai-project/solar")"
CHECKPOINT="$(printenv CHECKPOINT || true)"
IMAGE_TAG="$(printenv IMAGE_TAG || printf 'mesthi/solar:local')"
CONTAINER_NAME="$(printenv CONTAINER_NAME || printf 'solar-app')"

[[ "$ROLLBACK_APPROVED" == YES ]] || fail 'Explicit ROLLBACK_APPROVED=YES is required.'
[[ -n "$CHECKPOINT" && -d "$CHECKPOINT" ]] || fail 'Set CHECKPOINT to a verified release checkpoint directory.'
case "$(realpath "$CHECKPOINT")" in
  "$(realpath "$PROD_DIR")"/.solar-deploy-backups/*) ;;
  *) fail 'Checkpoint is outside the expected production backup root.' ;;
esac
for file in previous-image-id.txt previous-version.txt service.txt; do
  [[ -f "$CHECKPOINT/$file" ]] || fail "Missing checkpoint marker: $file"
done
[[ -f "$PROD_DIR/compose.vps.yml" && -f "$PROD_DIR/compose.source.yml" ]] || fail 'Missing Compose overlays.'

docker_cmd() {
  if docker info >/dev/null 2>&1; then command docker "$@"
  elif command -v sudo >/dev/null && sudo -n docker info >/dev/null 2>&1; then sudo -n docker "$@"
  else fail 'No Docker permission'; fi
}
compose() {
  docker_cmd compose --project-directory "$PROD_DIR" \
    -f "$PROD_DIR/compose.vps.yml" -f "$PROD_DIR/compose.source.yml" "$@"
}
exec 9>"$PROD_DIR/.solar-deploy.lock"
flock -n 9 || fail 'Another deployment or rollback is running.'
SERVICE="$(cat "$CHECKPOINT/service.txt")"
OLD_IMAGE="$(cat "$CHECKPOINT/previous-image-id.txt")"
OLD_VERSION="$(cat "$CHECKPOINT/previous-version.txt")"
[[ "$OLD_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Invalid old image identifier.'
[[ "$OLD_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid old version marker.'
LIVE_SERVICE="$(docker_cmd inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$CONTAINER_NAME" 2>/dev/null)" || fail 'Container absent.'
[[ "$SERVICE" == "$LIVE_SERVICE" ]] || fail 'Checkpoint service differs from running service.'
[[ "$(docker_cmd inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CONTAINER_NAME")" == "$PROD_DIR" ]] || fail 'Container project directory differs.'
docker_cmd image inspect "$OLD_IMAGE" >/dev/null || fail 'Checkpoint image is no longer available.'
docker_cmd tag "$OLD_IMAGE" "$IMAGE_TAG"
compose up -d --no-deps --no-build --force-recreate "$SERVICE"
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  VERSION="$(docker_cmd exec "$CONTAINER_NAME" node -e '
const port=process.env.PORT||"8790";
fetch("http://127.0.0.1:"+port+"/api/health",{signal:AbortSignal.timeout(4000)})
.then(async r=>{if(!r.ok)throw Error("HTTP "+r.status);const x=await r.json();if(x.ok!==true)throw Error("health");process.stdout.write(x.version);})
.catch(()=>process.exit(1));
' 2>/dev/null || true)"
  if [[ "$VERSION" == "$OLD_VERSION" ]]; then
    log "SUCCESS: restored image from checkpoint ($OLD_VERSION). Persistent data unchanged."
    exit 0
  fi
  sleep 3
done
fail 'Rollback image was applied but health verification did not pass.'
