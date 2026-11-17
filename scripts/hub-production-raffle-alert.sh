#!/usr/bin/env bash
# Monitor read-only do executor: não possui segredo, não apura e não despacha sorteios.
set -euo pipefail
repo="${GITHUB_REPOSITORY:?}"
if [[ "${HUB_PROD_RAFFLES_ENABLED:-false}" != "true" ]]; then
  echo "SORTEIOS_DESABILITADOS: nenhuma execução esperada; não criar falso incidente."
  HUB_INCIDENT_LABEL=sorteios-agendados HUB_INCIDENT_STATUS=success bash scripts/hub-sync-incident.sh
  exit 0
fi
runs="$(gh api "repos/$repo/actions/workflows/hub-production-raffles.yml/runs?per_page=50")"
status="$(printf '%s' "$runs" | node scripts/raffle-monitor-policy.mjs)"
case "$status" in
  SUCCESS)
    echo "SORTEIO_AGENDADO_EXECUCAO_CONFIRMADA: job da main concluído com sucesso."
    HUB_INCIDENT_LABEL=sorteios-agendados HUB_INCIDENT_STATUS=success bash scripts/hub-sync-incident.sh
    ;;
  PENDING)
    echo "::warning::Execução agendada ainda pendente; monitor fará nova conferência."
    ;;
  MISSING_OR_FAILED)
    echo "::error::Sorteio habilitado, mas não há execução agendada bem-sucedida recente na main."
    HUB_INCIDENT_LABEL=sorteios-agendados HUB_INCIDENT_STATUS=failure bash scripts/hub-sync-incident.sh
    exit 1
    ;;
  *)
    echo "::error::RESPOSTA_MONITOR_INVALIDA: $status"
    exit 1
    ;;
esac
