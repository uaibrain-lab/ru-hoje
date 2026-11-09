import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const load = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const exists = path => existsSync(new URL('../' + path, import.meta.url));

test('nenhum botão manual ou escrita de pedido ao Firestore no frontend', () => {
  const app = load('public/assets/app.js');
  const html = load('public/index.html');
  assert.doesNotMatch(html, /refresh-button|refresh-feedback/);
  assert.doesNotMatch(app, /requestCommunityRefresh|menuSyncRequests|refresh-button|readRefreshState|refreshMessage|refreshDb/);
  assert.match(app, /window\.addEventListener\('online',fetchMenus\)/);
  assert.match(app, /document\.addEventListener\('visibilitychange'/);
  assert.match(load('public/service-worker.js'), /data\/pratos-ingredientes\.json/);
});

test('agendamentos alternados usam gates e impedem concorrência', () => {
  const primary = load('.github/workflows/hub-production-cardapios.yml');
  const fallback = load('.github/workflows/hub-production-request-processor.yml');
  for (const w of [primary, fallback]) {
    assert.match(w, /schedule:/);
    assert.match(w, /group: hub-production-menu-writer/);
    assert.match(w, /cancel-in-progress: false/);
    assert.match(w, /bash scripts\/hub-production-scheduled-run\.sh/);
    assert.match(w, /HUB_PROD_PUBLISH_ENABLED/);
    assert.match(w, /issues: write/);
    assert.match(w, /cron: '[0-9][0-9] /);
  }
  assert.match(primary, /hub-prod-sync@hubufmg\.iam\.gserviceaccount\.com/);
  assert.match(fallback, /hub-prod-refresh@hubufmg\.iam\.gserviceaccount\.com/);
  assert.doesNotMatch(fallback, /hub-production-request-processor\.mjs/);
});

test('aplicação exige confirmação dupla e retenta até três vezes', () => {
  const run = load('scripts/hub-production-scheduled-run.sh');
  assert.match(run, /--confirm=PUBLICAR_SOMENTE_HUB_UFMG/);
  assert.match(run, /HUB_PROD_PUBLISH_ENABLED/);
  assert.match(run, /HUB_PROD_SYNC_ENABLED/);
  assert.match(run, /1 2 3/);
  assert.match(load('scripts/hub-production-menu-sync.mjs'), /mode === 'apply' && \(!confirm/);
  assert.equal(exists('scripts/hub-production-request-processor.mjs'), false);
});

test('watchdog detecta falta de execuções bem sucedidas e aciona recuperação', () => {
  const cron=load('.github/workflows/hub-production-watchdog.yml');
  const script=load('scripts/hub-production-watchdog.sh');
  assert.match(cron, /actions: write/);
  assert.match(cron, /issues: write/);
  assert.match(script, /5 \* 60 \* 60/);
  assert.match(script, /gh workflow run hub-production-cardapios\.yml/);
  assert.match(script, /mode=apply/);
  assert.match(load('scripts/hub-sync-incident.sh'), /gh issue create/);
});

test('rules negam pedido manual e mantêm o cardápio público', () => {
  const rules=load('firestore.rules');
  assert.match(rules, /match \/publicMenus\/current \{\s+allow get: if true/);
  assert.match(rules, /match \/menuSyncRequests\/current \{\s+allow read, write: if false;/);
  assert.doesNotMatch(rules, /request\.resource\.data\.requestedAt == request\.time/);
});
