#!/usr/bin/env bash
# Vigilante permanente dos workflows de produção. Não consulta nem grava dados FUMP.
set -euo pipefail

repo="${GITHUB_REPOSITORY:?}"
[[ "${GITHUB_REF:-}" == "refs/heads/main" ]] || { echo "::error::WATCHDOG_EXIGE_MAIN"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

gh api "repos/$repo/actions/workflows/hub-production-cardapios.yml/runs?per_page=50" > "$tmp/main.json"
gh api "repos/$repo/actions/workflows/hub-production-request-processor.yml/runs?per_page=50" > "$tmp/fallback.json"

# Conta somente sync agendada concluída ou recovery explicitamente marcado.
# Dispatch manual em dry-run/collect nunca é confundido com publicação automática.
latest_success="$(
  jq -rs '
    [.[].workflow_runs[]
      | select(.conclusion == "success")
      | select(
          .event == "schedule"
          or (
            .event == "workflow_dispatch"
            and ((.display_title // "") | contains("WATCHDOG_RECOVERY"))
          )
        )
      | .created_at
    ] | max // empty
  ' "$tmp/main.json" "$tmp/fallback.json"
)"

now="$(date -u +%s)"
last=0
if [[ -n "$latest_success" ]]; then
  last="$(date -u -d "$latest_success" +%s)"
fi
age=$((now - last))

# Recovery attempt cooldown avoids repeatedly dispatching apply while FUMP is offline.
latest_recovery="$(
  jq -r '
    [.workflow_runs[]
      | select(.event == "workflow_dispatch")
      | select((.display_title // "") | contains("WATCHDOG_RECOVERY"))
      | .created_at
    ] | max // empty
  ' "$tmp/main.json"
)"
recovery_age=999999
if [[ -n "$latest_recovery" ]]; then
  recovery_epoch="$(date -u -d "$latest_recovery" +%s)"
  recovery_age=$((now - recovery_epoch))
fi

active="$(
  jq -s '
    [.[].workflow_runs[]
      | select(.status == "queued" or .status == "in_progress")
    ] | length
  ' "$tmp/main.json" "$tmp/fallback.json"
)"

if (( last > 0 && age < 5 * 60 * 60 )); then
  echo "SYNC_HEALTHY latest_success=$latest_success age_seconds=$age"
  HUB_INCIDENT_LABEL=agendamento-atrasado HUB_INCIDENT_STATUS=success bash scripts/hub-sync-incident.sh
elif (( active > 0 )); then
  echo "::warning::SYNC_STALE_BUT_EXECUTION_ACTIVE latest_success=${latest_success:-none} active_runs=$active"
  HUB_INCIDENT_LABEL=agendamento-atrasado HUB_INCIDENT_STATUS=failure bash scripts/hub-sync-incident.sh
elif [[ "${HUB_PROD_SYNC_ENABLED:-false}" != "true" || "${HUB_PROD_PUBLISH_ENABLED:-false}" != "true" ]]; then
  echo "::error::SYNC_STALE_RECOVERY_GATES_DISABLED latest_success=${latest_success:-none}"
  HUB_INCIDENT_LABEL=agendamento-atrasado HUB_INCIDENT_STATUS=failure bash scripts/hub-sync-incident.sh
elif (( recovery_age < 2 * 60 * 60 )); then
  echo "::warning::SYNC_STALE_RECOVERY_COOLDOWN latest_success=${latest_success:-none} last_recovery=$latest_recovery"
  HUB_INCIDENT_LABEL=agendamento-atrasado HUB_INCIDENT_STATUS=failure bash scripts/hub-sync-incident.sh
else
  echo "::warning::SYNC_STALE_DISPATCHING_RECOVERY latest_success=${latest_success:-none} age_seconds=$age"
  gh workflow run hub-production-cardapios.yml --repo "$repo" --ref main -f mode=apply -f recovery=true
  HUB_INCIDENT_LABEL=agendamento-atrasado HUB_INCIDENT_STATUS=failure bash scripts/hub-sync-incident.sh
fi

# Keep a small, non-sensitive weekly repository heartbeat. Public repositories
# can have scheduled workflows disabled by GitHub after 60 days without activity.
# This updates one marker per ISO week; it contains no user data or secrets.
heartbeat_file=".github/automation/heartbeat.json"
current_week="$(TZ=America/Sao_Paulo date +%G-W%V)"
previous_week=""
if [[ -f "$heartbeat_file" ]]; then
  previous_week="$(jq -r '.isoWeek // empty' "$heartbeat_file" 2>/dev/null || true)"
fi
if [[ "$previous_week" != "$current_week" ]]; then
  mkdir -p "$(dirname "$heartbeat_file")"
  printf '{\n  "isoWeek": "%s",\n  "updatedAt": "%s",\n  "purpose": "keep scheduled automation active"\n}\n' \
    "$current_week" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$heartbeat_file"
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git add "$heartbeat_file"
  git commit -m "chore(automation): weekly workflow heartbeat [skip ci]" || true
  if ! git push origin HEAD:main; then
    echo "::warning::WEEKLY_HEARTBEAT_PUSH_FAILED"
  else
    echo "WEEKLY_HEARTBEAT_UPDATED isoWeek=$current_week"
  fi
else
  echo "WEEKLY_HEARTBEAT_CURRENT isoWeek=$current_week"
fi

# A stale menu is reported as a failed health check even when a recovery was dispatched.
if (( last == 0 || age >= 5 * 60 * 60 )); then
  exit 1
fi
