#!/usr/bin/env bash
# Somente status de workflows; jamais acessa dados de participantes nem chaves.
set -euo pipefail
repo="${GITHUB_REPOSITORY:?}"
workflow="hub-production-raffles.yml"
runs="$(gh api "repos/$repo/actions/workflows/$workflow/runs?per_page=50")"
now="$(date -u +%s)"
last="$(jq -r '[.workflow_runs[] | select(.event == "schedule" and .conclusion == "success") | .created_at] | max // ""' <<<"$runs")"
running="$(jq -r '[.workflow_runs[] | select(.event == "schedule" and (.status == "queued" or .status == "in_progress")) | .created_at] | max // ""' <<<"$runs")"
incident() {
  HUB_INCIDENT_LABEL=sorteios-agendados HUB_INCIDENT_STATUS="$1" bash scripts/hub-sync-incident.sh
}
if [[ -n "$last" ]] && (( now - $(date -u -d "$last" +%s) < 35 * 60 )); then
  echo "Sorteio automatico: cron saudavel; ultima execucao $last."
  incident success
  exit 0
fi
if [[ -n "$running" ]] && (( now - $(date -u -d "$running" +%s) < 15 * 60 )); then
  echo "Uma execucao agendada recente ainda esta em andamento: $running."
  exit 0
fi
echo "::warning::Ausencia de sorteio agendado bem-sucedido ha mais de 35 minutos."
if [[ "${HUB_PROD_RAFFLES_ENABLED:-false}" != "true" ]]; then
  echo "::error::Gate HUB_PROD_RAFFLES_ENABLED esta desativado."
  incident failure
  exit 1
fi
gh workflow run "$workflow" --repo "$repo" --ref main
echo "Recuperacao disparada usando workflow de producao homologado."
incident failure
exit 1
