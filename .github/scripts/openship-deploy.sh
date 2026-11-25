#!/usr/bin/env bash
# Deploy one commit of book-recommendations to production through Openship's REST API, then wait until
# Openship reports the deployment ready (exit 0) or failed (exit 1).
#
#   OPENSHIP_TOKEN=... ./openship-deploy.sh deploy <commit-sha>
#   OPENSHIP_TOKEN=... ./openship-deploy.sh watch <deployment-id>   # wait on an existing deployment only
#
# Production runs on a self-hosted Openship (deploy.ubaid.stream). Openship's own push-to-deploy needs a
# GitHub webhook its GitHub login may not create, so .github/workflows/deploy.yml calls this after CI
# passes on main instead: a commit that fails the build is never deployed.
#
# OPENSHIP_TOKEN must be an Openship API token (`openship token create`, deployment permission), sent as a
# Bearer token. Until 2026-11-25 this script used Openship's MCP endpoint, which only accepted a short-lived
# sign-in token: the secret worked for a day and then every deploy failed with 401. The REST API takes the
# long-lived API token. API: POST /api/deployments {projectId, branch}; GET /api/deployments/<id>.
set -euo pipefail

OPENSHIP_URL="${OPENSHIP_URL:-https://deploy.ubaid.stream}"
PROJECT_ID="${OPENSHIP_PROJECT_ID:-proj_36supYe4DKoJUvEu}"   # Openship project "book-recommendations"
POLL_SECONDS="${POLL_SECONDS:-15}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-1500}"

: "${OPENSHIP_TOKEN:?OPENSHIP_TOKEN is not set (GitHub: repo Settings -> Secrets and variables -> Actions)}"

# One REST call. Prints the JSON body; on failure explains it (a 401 names the token) and returns 1.
# The token is never printed.
api() {
  local method="$1" path="$2" body="${3:-}" out code
  out=$(mktemp)
  code=$(curl -sS --max-time 60 -o "$out" -w '%{http_code}' -X "$method" "${OPENSHIP_URL}${path}" \
    -H "Authorization: Bearer ${OPENSHIP_TOKEN}" -H "Accept: application/json" \
    ${body:+-H "Content-Type: application/json" -d "$body"}) || { echo "::error::Could not reach Openship at ${OPENSHIP_URL}" >&2; rm -f "$out"; return 1; }
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    echo "::error::Openship refused OPENSHIP_TOKEN (HTTP $code): $(head -c 300 "$out"). Create an API token in Openship (openship token create, deployment permission) and save it as the repo secret OPENSHIP_TOKEN." >&2
    rm -f "$out"; return 1
  fi
  if [ "${code:0:1}" != "2" ]; then
    echo "::error::Openship $method $path answered HTTP $code: $(head -c 500 "$out")" >&2
    rm -f "$out"; return 1
  fi
  cat "$out"; rm -f "$out"
}

LAST_FAILURE=""
watch_deployment() {
  local id="$1" waited=0 d status msg
  echo "Waiting for Openship deployment $id"
  while :; do
    d=$(api GET "/api/deployments/${id}")
    status=$(jq -r '(.data // .) | .status // "unknown"' <<<"$d")
    echo "  $(date -u +%H:%M:%S) status=$status"
    case "$status" in
      ready|success|succeeded|active)
        echo "Deployment $id is $status."
        return 0 ;;
      failed|error|canceled|cancelled|rejected)
        msg=$(jq -r '(.data // .) | [.errorMessage, .failureReason, .error] | map(select(. != null and . != "")) | join(" | ")' <<<"$d")
        LAST_FAILURE="$msg"
        echo "::error::Openship deployment $id ended as $status${msg:+: $msg}"
        return 1 ;;
      action_required)
        echo "::error::Openship deployment $id is waiting on a decision in Openship (action_required)."
        return 1 ;;
    esac
    if [ "$waited" -ge "$TIMEOUT_SECONDS" ]; then
      echo "::error::Deployment $id still '$status' after ${TIMEOUT_SECONDS}s; check it in Openship."
      return 1
    fi
    sleep "$POLL_SECONDS"
    waited=$((waited + POLL_SECONDS))
  done
}

deploy_commit() {
  local sha="$1" resp id got
  echo "Deploying ${sha} of main to Openship project ${PROJECT_ID} (production)"
  resp=$(api POST /api/deployments "$(jq -cn --arg p "$PROJECT_ID" '{projectId:$p, branch:"main"}')")
  # Openship answers {"data":{"deployment_id":"dep_…","deployment":{"id":"dep_…","commitSha":"…",…}}} (seen 2026-11-25).
  id=$(jq -r '.data.deployment_id // .data.deployment.id // .data.id // empty' <<<"$resp" 2>/dev/null || true)
  if [ -z "$id" ]; then
    echo "::error::Openship accepted the request but returned no deployment id. Response: $(head -c 1500 <<<"$resp")"
    return 1
  fi
  # Openship builds the head of main; the workflow already skipped runs whose commit is no longer the head.
  got=$(jq -r '.data.deployment.commitSha // empty' <<<"$resp")
  if [ -n "$got" ] && [ "$got" != "$sha" ]; then echo "::warning::Openship is building ${got}, not ${sha} (main moved on); that is the newer commit."; fi
  watch_deployment "$id" && return 0
  # A failure of the server rather than the build (the SSH link to the build host dropping, a command timing
  # out while Openship prepares the image) passes on a second try: retry once, a minute later.
  if grep -qiE 'SSH connection|timed out|ECONNRESET|connection reset|socket hang up' <<<"$LAST_FAILURE" && [ -z "${OPENSHIP_RETRIED:-}" ]; then
    echo "That looks like a server hiccup, not the build: retrying once in 60s."
    sleep 60
    OPENSHIP_RETRIED=1 deploy_commit "$sha"
    return $?
  fi
  return 1
}

case "${1:-}" in
  deploy) deploy_commit "${2:?usage: $0 deploy <commit-sha>}" ;;
  watch)  watch_deployment "${2:?usage: $0 watch <deployment-id>}" ;;
  *) echo "usage: $0 deploy <commit-sha> | watch <deployment-id>" >&2; exit 2 ;;
esac
