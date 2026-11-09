#!/usr/bin/env bash
# Coleta FUMP somente no projeto hubufmg; aplica gates em dois niveis.
set -euo pipefail
mode="${HUB_PROD_MODE:-apply}"
case "$mode" in apply|collect|dry-run) ;; *) echo "::error::MODO_INVALIDO"; exit 1;; esac
if [[ "${HUB_PROD_SYNC_ENABLED:-false}" != "true" ]]; then
  echo "::error::HUB_PROD_SYNC_ENABLED desativado"; exit 1
fi
args=("--mode=$mode" "--days=7")
if [[ "$mode" == "apply" ]]; then
  if [[ "${HUB_PROD_PUBLISH_ENABLED:-false}" != "true" ]]; then
    echo "::error::HUB_PROD_PUBLISH_ENABLED desativado"; exit 1
  fi
  args+=("--confirm=PUBLICAR_SOMENTE_HUB_UFMG")
fi
for attempt in 1 2 3; do
  echo "Tentativa $attempt/3 (modo $mode, projeto hubufmg)"
  if node scripts/hub-production-menu-sync.mjs "${args[@]}"; then
    echo "HUB_PROD_SCHEDULE_SUCCESS=1"
    exit 0
  fi
  if [[ "$attempt" == 3 ]]; then
    echo "::error::Sincronizacao FUMP falhou apos 3 tentativas"
    exit 1
  fi
  sleep $((attempt * 25))
done
