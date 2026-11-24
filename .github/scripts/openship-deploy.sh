#!/usr/bin/env bash
# Deploy one commit of book-recommendations to production through Openship's MCP endpoint, then wait
# until Openship reports the deployment ready (exit 0) or failed (exit 1).
#
#   OPENSHIP_TOKEN=... ./openship-deploy.sh deploy <commit-sha>
#   OPENSHIP_TOKEN=... ./openship-deploy.sh watch <deployment-id>   # wait on an existing deployment only
#
# Production runs on a self-hosted Openship (deploy.ubaid.stream). Openship's own push-to-deploy needs a
# GitHub webhook its GitHub login may not create, so .github/workflows/deploy.yml calls this after CI
# passes on main instead: a commit that fails the build is never deployed.
set -euo pipefail

OPENSHIP_URL="${OPENSHIP_URL:-https://deploy.ubaid.stream/api/mcp}"
PROJECT_ID="${OPENSHIP_PROJECT_ID:-proj_36supYe4DKoJUvEu}"   # Openship project "book-recommendations"
POLL_SECONDS="${POLL_SECONDS:-15}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-1500}"

: "${OPENSHIP_TOKEN:?OPENSHIP_TOKEN is not set (GitHub: repo Settings -> Secrets and variables -> Actions)}"

# Call one Openship MCP tool. Prints the tool's JSON result (the text content, parsed); exits on any
# transport, JSON-RPC or tool error. The token is never printed.
call_tool() {
  local name="$1" args="$2" raw
  raw=$(curl -sS --fail-with-body --max-time 60 "$OPENSHIP_URL" \
    -H "Authorization: Bearer ${OPENSHIP_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "$(jq -cn --arg n "$name" --argjson a "$args" '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$n,arguments:$a}}')") || {
    echo "::error::Openship request for $name failed: $raw" >&2
    return 1
  }
  if jq -e '.error' >/dev/null <<<"$raw"; then
    echo "::error::Openship JSON-RPC error on $name: $(jq -c '.error' <<<"$raw")" >&2
    return 1
  fi
  local text
  text=$(jq -r '[.result.content[]? | select(.type=="text") | .text] | join("")' <<<"$raw")
  if [ "$(jq -r '.result.isError // false' <<<"$raw")" = "true" ]; then
    echo "::error::Openship $name returned an error: $text" >&2
    return 1
  fi
  printf '%s' "$text"
}

watch_deployment() {
  local id="$1" waited=0 status build msg
  echo "Waiting for Openship deployment $id"
  while :; do
    build=$(call_tool get_deployments_by_id_build "$(jq -cn --arg id "$id" '{id:$id}')")
    status=$(jq -r '.deploymentStatus // .status // "unknown"' <<<"$build")
    echo "  $(date -u +%H:%M:%S) status=$status progress=$(jq -r '.progress // "?"' <<<"$build")%"
    case "$status" in
      ready|success|succeeded|active)
        echo "Deployment $id is $status."
        return 0 ;;
      failed|error|canceled|cancelled|rejected)
        msg=$(jq -r '[.failureMessage, .errorCode, (.errorDetails|tostring?)] | map(select(. != null and . != "" and . != "null")) | join(" | ")' <<<"$build")
        echo "::error::Openship deployment $id ended as $status${msg:+: $msg}"
        return 1 ;;
      action_required)
        echo "::error::Openship deployment $id is waiting on a decision in Openship (action_required): $(jq -c '.pendingPrompt // {}' <<<"$build")"
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
  local sha="$1" resp id
  echo "Deploying ${sha} of main to Openship project ${PROJECT_ID} (production)"
  resp=$(call_tool post_deployments "$(jq -cn --arg p "$PROJECT_ID" --arg s "$sha" \
    '{body:{projectId:$p, branch:"main", commitSha:$s, environment:"production"}}')")
  id=$(jq -r '.data.id // .data.deploymentId // .deploymentId // .deployment_id // .id // empty' <<<"$resp" 2>/dev/null || true)
  if [ -z "$id" ]; then
    echo "::error::Openship accepted the request but returned no deployment id. Response: $(head -c 1500 <<<"$resp")"
    return 1
  fi
  watch_deployment "$id"
}

case "${1:-}" in
  deploy) deploy_commit "${2:?usage: $0 deploy <commit-sha>}" ;;
  watch)  watch_deployment "${2:?usage: $0 watch <deployment-id>}" ;;
  *) echo "usage: $0 deploy <commit-sha> | watch <deployment-id>" >&2; exit 2 ;;
esac
