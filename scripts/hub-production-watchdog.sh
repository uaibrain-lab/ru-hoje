#!/usr/bin/env bash
# Dispara uma tentativa de reparo se os dois agendamentos nao tiveram sucesso recente.
set -euo pipefail
repo="${GITHUB_REPOSITORY:?}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
gh api "repos/$repo/actions/workflows/hub-production-cardapios.yml/runs?per_page=50" > "$tmp/main.json"
gh api "repos/$repo/actions/workflows/hub-production-request-processor.yml/runs?per_page=50" > "$tmp/fallback.json"
latest="$(jq -rs '[.[].workflow_runs[] | select(.conclusion == "success") | select(.event == "schedule" or .event == "workflow_dispatch") | .created_at] | max // empty' "$tmp/main.json" "$tmp/fallback.json")"
now="$(date -u +%s)"
last=0
if [[ -n "$latest" ]]; then last="$(date -u -d "$latest" +%s)"; fi
age=$((now - last))
if (( last > 0 && age < 5 * 60 * 60 )); then
  echo "Sincronizacao saudavel; ultima execucao: $latest"
  HUB_INCIDENT_LABEL=agendamento-atrasado HUB_INCIDENT_STATUS=success bash scripts/hub-sync-incident.sh
  exit 0
fi
echo "::warning::Sem sincronizacao bem-sucedida nas ultimas 5 horas de monitoramento."
if [[ "${HUB_PROD_SYNC_ENABLED:-false}" == "true" && "${HUB_PROD_PUBLISH_ENABLED:-false}" == "true" ]]; then
  gh workflow run hub-production-cardapios.yml --repo "$repo" --ref main -f mode=apply
  echo "Recuperacao automatica acionada (apply protegido por gates)."
else
  echo "::error::Gates de sincronizacao ou publicacao desativados."
fi
HUB_INCIDENT_LABEL=agendamento-atrasado HUB_INCIDENT_STATUS=failure bash scripts/hub-sync-incident.sh
exit 1
