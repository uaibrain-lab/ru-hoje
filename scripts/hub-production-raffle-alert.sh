#!/usr/bin/env bash
# Não executa sorteios e não tem acesso à chave secreta.
set -euo pipefail
repo="${GITHUB_REPOSITORY:?}"
runs="$(gh api "repos/$repo/actions/workflows/hub-production-raffles.yml/runs?per_page=50")"
last="$(jq -r '[.workflow_runs[] | select(.event == "schedule" and .conclusion == "success") | .created_at] | max // ""' <<<"$runs")"
now="$(date -u +%s)"
if [[ -n "$last" ]] && (( now - $(date -u -d "$last" +%s) <= 120 * 60 )); then
  echo "Sorteio agendado concluído no período esperado: $last"
  HUB_INCIDENT_LABEL=sorteios-agendados HUB_INCIDENT_STATUS=success bash scripts/hub-sync-incident.sh
  exit 0
fi
echo "::error::Sem execução agendada bem-sucedida de sorteios nas últimas duas horas."
HUB_INCIDENT_LABEL=sorteios-agendados HUB_INCIDENT_STATUS=failure bash scripts/hub-sync-incident.sh
exit 1
