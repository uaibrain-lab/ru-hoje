#!/usr/bin/env bash
# Alerta somente com URLs do Actions, sem dados pessoais ou conteudo de cardapios.
set -euo pipefail
label="${HUB_INCIDENT_LABEL:?}"
state="${HUB_INCIDENT_STATUS:?}"
title="Hub UFMG - alerta sincronizacao FUMP [$label]"
message="A sincronizacao automatica do Hub UFMG falhou ou atrasou."
if [[ "$label" == "sorteios-agendados" ]]; then
  title="Hub UFMG - alerta sorteios automaticos"
  message="A execucao automatica dos sorteios do Hub UFMG atrasou ou falhou."
fi
repo="${GITHUB_REPOSITORY:?}"
url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
number="$(gh issue list --repo "$repo" --state open --limit 100 --json number,title | jq -r --arg title "$title" '.[] | select(.title == $title) | .number' | head -n 1)"
if [[ "$state" == "failure" ]]; then
  if [[ -n "$number" ]]; then
    gh issue comment "$number" --repo "$repo" --body "Nova falha ou atraso detectado: $url"
  else
    gh issue create --repo "$repo" --title "$title" --body "$message Verifique a execucao: $url"
  fi
elif [[ "$state" == "success" ]]; then
  if [[ -n "$number" ]]; then
    gh issue close "$number" --repo "$repo" --comment "Uma execucao posterior foi concluida com sucesso: $url"
  fi
else
  echo "::error::Estado de incidente invalido"; exit 1
fi
