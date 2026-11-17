import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const primary = read('../.github/workflows/hub-production-cardapios.yml');
const redundant = read('../.github/workflows/hub-production-request-processor.yml');
const watchdog = read('../.github/workflows/hub-production-watchdog.yml');
const watchdogScript = read('../scripts/hub-production-watchdog.sh');

test('coleta primaria e manual e nao depende de cron', () => {
  assert.doesNotMatch(primary,/^  schedule:/m);
  assert.match(primary,/workflow_dispatch:/);
  assert.doesNotMatch(primary, /UNTIL=|windowStart|windowDays|cutoff/i);
});

test('coleta redundante fica disponivel somente para acionamento manual', () => {
  assert.doesNotMatch(redundant,/^  schedule:/m);
  assert.match(redundant,/workflow_dispatch:/);
  assert.doesNotMatch(redundant, /UNTIL=|windowStart|windowDays|cutoff/i);
});

test('watchdog nao aciona recuperacao horaria sem autorizacao', () => {
  assert.doesNotMatch(watchdog,/^  schedule:/m);
  assert.match(watchdog,/workflow_dispatch:/);
  assert.doesNotMatch(watchdog, /UNTIL=|windowStart|windowDays|cutoff/i);
  assert.ok(watchdog.includes('cancel-in-progress: false'));
});

test('watchdog has only the permissions needed for health, recovery and heartbeat', () => {
  assert.ok(watchdog.includes('contents: read'));
  assert.ok(watchdog.includes('actions: write'));
  assert.ok(watchdog.includes('issues: write'));
});

test('only successful scheduled runs and explicitly tagged recovery runs count as healthy', () => {
  assert.ok(watchdogScript.includes('conclusion == "success"'));
  assert.ok(watchdogScript.includes('contains("WATCHDOG_RECOVERY")'));
  assert.ok(watchdogScript.includes('-f recovery=true'));
});

test('watchdog prevents duplicate recovery and applies a cooldown', () => {
  assert.ok(watchdogScript.includes('status == "queued" or .status == "in_progress"'));
  assert.ok(watchdogScript.includes('2 * 60 * 60'));
  assert.ok(watchdogScript.includes('5 * 60 * 60'));
});

test('weekly heartbeat is recorded once per ISO week without modifying the default branch', () => {
  assert.ok(watchdogScript.includes('%G-W%V'));
  assert.ok(watchdogScript.includes('HEARTBEAT_WEEK=$current_week'));
  assert.ok(watchdogScript.includes('gh issue comment'));
  assert.ok(watchdogScript.includes('gh issue close'));
  assert.doesNotMatch(watchdogScript, /git push origin HEAD:main/);
  assert.doesNotMatch(watchdogScript, /FIREBASE_SERVICE_ACCOUNT_JSON|HUB_PROD_PRIVATE_KEY|API_KEY/i);
});
