import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('agendamento envia confirmação necessária ao apply em produção', () => {
  const workflow = load('.github/workflows/hub-production-cardapios.yml');
  const run = workflow.split('\n').find(line => line.includes('node scripts/hub-production-menu-sync.mjs'));
  assert.ok(run, 'etapa do sincronizador ausente');
  assert.match(run, /github\.event_name == 'schedule'/);
  assert.match(run, /--confirm=PUBLICAR_SOMENTE_HUB_UFMG/);
  assert.match(load('scripts/hub-production-menu-sync.mjs'), /mode === 'apply' && \(!confirm/);
});

test('processador nunca contorna gates e pode retentar falhas', () => {
  const s = load('scripts/hub-production-request-processor.mjs');
  assert.match(s, /\['pending', 'running', 'error'\]/);
  assert.match(s, /PUBLICACAO_PRODUCAO_DESATIVADA/);
  assert.doesNotMatch(s, /HUB_PROD_PUBLISH_ENABLED: 'true'/);
  assert.match(s, /RETRY_MS = 5 \* 60 \* 1000/);
});

test('botão informa sucesso, espera e falha ao usuário', () => {
  const js = load('public/assets/app.js');
  assert.match(js, /Pedido registrado!/);
  assert.match(js, /requestStatus === 'pending'/);
  assert.match(js, /code === 'permission-denied'/);
  assert.doesNotMatch(js, /signInAnonymously\(auth\)/);
  assert.match(load('public/index.html'), /id="refresh-feedback"/);
});

test('sincronizador e processador não concorrem nas escritas', () => {
  assert.match(load('.github/workflows/hub-production-cardapios.yml'), /group: hub-production-menu-writer/);
  assert.match(load('.github/workflows/hub-production-request-processor.yml'), /group: hub-production-menu-writer/);
});
