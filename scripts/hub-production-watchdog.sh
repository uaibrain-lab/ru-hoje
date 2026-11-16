#!/usr/bin/env bash
# Auto-recuperacao permanente: reconhece a contingencia manual e nao enfileira
# recuperacoes duplicadas enquanto uma sincronizacao ja esta ativa.
set -euo pipefail

repo="${GITHUB_REPOSITORY:?}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

gh api "repos/$repo/actions/workflows/hub-production-cardapios.yml/runs?per_page=50" > "$tmp/main.json"
gh api "repos/$repo/actions/workflows/hub-production-request-processor.yml/runs?per_page=50" > "$tmp/fallback.json"

# O principal conta eventos schedule. A contingencia conta schedule E workflow_dispatch,
# pois esse workflow sempre executa HUB_PROD_MODE=apply (nao tem modo dry-run).
main_latest="$(jq -r '[.workflow_runs[] | select(.conclusion == "success" and .event == "schedule") | .created_at] | max // empty' "$tmp/main.json")"
fallback_latest="$(jq -r '[.workflow_runs[] | select(.conclusion == "success" and (.event == "schedule" or .event == "workflow_dispatch")) | .created_at] | max // empty' "$tmp/fallback.json")"
latest="$(printf '%s\n%s\n' "$main_latest" "$fallback_latest" | sed '/^$/d' | sort | tail -n 1 || true)"

now="$(date -u +%s)"
last=0
if [[ -n "$latest" ]]; then last="$(date -u -d "$latest" +%s)"; fi
age=$((now - last))

# Nunca iniciar outro executor se o principal ou o redundante estiver queued/running.
active="$(jq -s '[.[].workflow_runs[]? | select(.status == "queued" or .status == "in_progress")] | length' "$tmp/main.json" "$tmp/fallback.json")"

if (( last > 0 && age < 5 * 60 * 60 )); then
  echo "Sincronizacao verificada: ultima execucao apply/schedule bem-sucedida em $latest."
  HUB_INCIDENT_LABEL=redundante HUB_INCIDENT_STATUS=success bash scripts/hub-sync-incident.sh
  exit 0
fi

if (( active > 0 )); then
  echo "::warning::Sincronizacao atrasada, mas ja existe executor queued/in_progress. Nao sera criada outra execucao."
  HUB_INCIDENT_LABEL=redundante HUB_INCIDENT_STATUS=failure bash scripts/hub-sync-incident.sh
  exit 0
fi

echo "::warning::Nenhuma sincronizacao apply/schedule bem-sucedida nas ultimas 5 horas."

if [[ "${HUB_PROD_SYNC_ENABLED:-false}" == "true" && "${HUB_PROD_PUBLISH_ENABLED:-false}" == "true" ]]; then
  # O workflow redundante tem modo apply fixo e sua identidade WIF separada.
  # Um workflow_dispatch bem-sucedido sera reconhecido na proxima verificacao.
  if gh workflow run hub-production-request-processor.yml --repo "$repo" --ref main; then
    echo "::notice::Recuperacao redundante solicitada. A issue permanece aberta ate a validacao posterior."
  else
    echo "::error::Falha ao solicitar a recuperacao automatica."
  fi
else
  echo "::error::Gates de sincronizacao/publicacao desativados; recuperacao automatica bloqueada."
fi

# Usa o mesmo incidente do executor redundante para que uma recuperacao bem-sucedida
# possa fechar o alerta, sem gerar uma issue por cada verificacao.
HUB_INCIDENT_LABEL=redundante HUB_INCIDENT_STATUS=failure bash scripts/hub-sync-incident.sh
exit 0
