import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync('.github/workflows/ocupa-qa-cardapios-monitor.yml','utf8');
const monitor=fs.readFileSync('cardapios-qa/scripts/ocupa-qa-api-monitor.mjs','utf8');

test('read-only FUMP monitor runs every weekday at 09:07 in Sao Paulo',()=>{
  assert.match(workflow,/cron: '7 9 \* \* 1-5'/);
  assert.match(workflow,/timezone: 'America\/Sao_Paulo'/);
});

test('monitor is recurring on schedule and manual dispatch',()=>{
  assert.match(workflow,/^\s+schedule:/m);
  assert.match(workflow,/^\s+workflow_dispatch:/m);
  assert.match(workflow,/github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
});

test('monitor has no fixed start date, cutoff or finite run count',()=>{
  assert.doesNotMatch(workflow,/MONITOR_START_DATE|MONITOR_WINDOW_DAYS|UNTIL=|COUNT=/);
  assert.doesNotMatch(monitor,/JANELA_MONITORAMENTO_ENCERRADA|windowStart|windowDays|cutoff/);
});

test('monitor remains read-only and records zero remote writes',()=>{
  assert.match(monitor,/mode: 'read-only'/);
  assert.match(monitor,/remoteWrites: 0/);
  assert.equal(monitor.includes('Firestore'),false);
  assert.equal(monitor.includes('firebase-admin'),false);
  assert.equal(monitor.includes('@google-cloud/firestore'),false);
});
