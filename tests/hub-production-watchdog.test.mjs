import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script=fs.readFileSync('scripts/hub-production-watchdog.sh','utf8');
const workflow=fs.readFileSync('.github/workflows/hub-production-watchdog.yml','utf8');

test('watchdog treats successful contingency workflow_dispatch as a successful apply',()=>{
  assert.match(script,/\.event == "schedule" or \.event == "workflow_dispatch"/);
  assert.match(script,/hub-production-request-processor\.yml/);
});

test('watchdog will not dispatch another recovery while a sync is queued or running',()=>{
  assert.match(script,/\.status == "queued" or \.status == "in_progress"/);
  assert.match(script,/if \(\( active > 0 \) \)/);
});

test('watchdog uses the same incident as the redundant workflow',()=>{
  assert.match(script,/HUB_INCIDENT_LABEL=redundante HUB_INCIDENT_STATUS=failure/);
  assert.match(script,/HUB_INCIDENT_LABEL=redundante HUB_INCIDENT_STATUS=success/);
});

test('watchdog does not fail merely because it has requested recovery',()=>{
  assert.match(script,/gh workflow run hub-production-request-processor\.yml/);
  assert.match(script,/exit 0/);
});

test('watchdog is serialized and retains an unbounded recurring schedule',()=>{
  assert.match(workflow,/group: hub-production-menu-watchdog/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/^\s+schedule:/m);
  assert.doesNotMatch(workflow,/UNTIL=|COUNT=/);
});
