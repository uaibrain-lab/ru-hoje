import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const primary = read('../.github/workflows/hub-production-cardapios.yml');
const redundant = read('../.github/workflows/hub-production-request-processor.yml');
const watchdog = read('../.github/workflows/hub-production-watchdog.yml');
const watchdogScript = read('../scripts/hub-production-watchdog.sh');

test('primary production schedule recurs without an end date', () => {
  assert.match(primary, /schedule:/);
  assert.match(primary, /41 8,12,16,20 \* \* 1-5/);
  assert.doesNotMatch(primary, /UNTIL=|windowStart|windowDays|cutoff/i);
});

test('redundant production schedule recurs without an end date', () => {
  assert.match(redundant, /schedule:/);
  assert.match(redundant, /23 10,14,18,22 \* \* 1-5/);
  assert.doesNotMatch(redundant, /UNTIL=|windowStart|windowDays|cutoff/i);
});

test('watchdog is scheduled every hour on every day with no expiry', () => {
  assert.match(watchdog, /cron: '17 \* \* \* \*'/);
  assert.doesNotMatch(watchdog, /UNTIL=|windowStart|windowDays|cutoff/i);
  assert.match(watchdog, /cancel-in-progress: false/);
});

test('watchdog has only the permissions needed for health, recovery and heartbeat', () => {
  assert.match(watchdog, /contents: write/);
  assert.match(watchdog, /actions: write/);
  assert.match(watchdog, /issues: write/);
});

test('only successful scheduled runs and explicitly tagged recovery runs count as healthy', () => {
  assert.match(watchdogScript, /conclusion == "success"/);
  assert.match(watchdogScript, /contains\("WATCHDOG_RECOVERY"\)/);
  assert.match(watchdogScript, /-f recovery=true/);
});

test('watchdog prevents duplicate recovery and applies a cooldown', () => {
  assert.match(watchdogScript, /status == "queued" or .status == "in_progress"/);
  assert.match(watchdogScript, /2 \* 60 \* 60/);
  assert.match(watchdogScript, /5 \* 60 \* 60/);
});

test('weekly heartbeat is non-sensitive, bounded to one commit per ISO week and pushes to main', () => {
  assert.match(watchdogScript, /%G-W%V/);
  assert.match(watchdogScript, /weekly workflow heartbeat \[skip ci\]/);
  assert.match(watchdogScript, /git push origin HEAD:main/);
  assert.match(watchdogScript, /\"isoWeek\"/);\n  assert.match(watchdogScript, /\"updatedAt\"/);\n  assert.doesNotMatch(watchdogScript, /FIREBASE_SERVICE_ACCOUNT_JSON|HUB_PROD_PRIVATE_KEY|API_KEY/i);
});
