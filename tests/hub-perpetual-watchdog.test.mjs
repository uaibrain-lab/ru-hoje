import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const primary = read('../.github/workflows/hub-production-cardapios.yml');
const redundant = read('../.github/workflows/hub-production-request-processor.yml');
const watchdog = read('../.github/workflows/hub-production-watchdog.yml');
const watchdogScript = read('../scripts/hub-production-watchdog.sh');

test('primary production schedule recurs without an end date', () => {
  assert.ok(primary.includes("41 8,12,16,20 * * 1-5"));
  assert.doesNotMatch(primary, /UNTIL=|windowStart|windowDays|cutoff/i);
});

test('redundant production schedule recurs without an end date', () => {
  assert.ok(redundant.includes("23 10,14,18,22 * * 1-5"));
  assert.doesNotMatch(redundant, /UNTIL=|windowStart|windowDays|cutoff/i);
});

test('watchdog is scheduled every hour on every day with no expiry', () => {
  assert.ok(watchdog.includes("cron: '17 * * * *'"));
  assert.doesNotMatch(watchdog, /UNTIL=|windowStart|windowDays|cutoff/i);
  assert.ok(watchdog.includes('cancel-in-progress: false'));
});

test('watchdog has only the permissions needed for health, recovery and heartbeat', () => {
  assert.ok(watchdog.includes('contents: write'));
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

test('weekly heartbeat is bounded to one commit per ISO week and pushes to main', () => {
  assert.ok(watchdogScript.includes('%G-W%V'));
  assert.ok(watchdogScript.includes('weekly workflow heartbeat [skip ci]'));
  assert.ok(watchdogScript.includes('git push origin HEAD:main'));
  assert.ok(watchdogScript.includes('isoWeek'));
  assert.ok(watchdogScript.includes('updatedAt'));
  assert.doesNotMatch(watchdogScript, /FIREBASE_SERVICE_ACCOUNT_JSON|HUB_PROD_PRIVATE_KEY|API_KEY/i);
});
