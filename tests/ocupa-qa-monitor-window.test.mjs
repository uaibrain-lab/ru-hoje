import test from 'node:test';
import assert from 'node:assert/strict';
import {monitorWindowState} from '../scripts/ocupa-qa-monitor-window.mjs';

test('a scheduled monitor after the 14-day cutoff is a clean no-op', () => {
  assert.deepEqual(
    monitorWindowState({today:'2026-11-16',windowStart:'2026-10-27',windowDays:14}),
    {active:false,reason:'WINDOW_CLOSED',today:'2026-11-16',windowStart:'2026-10-27',cutoff:'2026-11-09'}
  );
});

test('a monitor before its configured start date is also a no-op', () => {
  assert.equal(monitorWindowState({today:'2026-10-26',windowStart:'2026-10-27',windowDays:14}).reason,'BEFORE_WINDOW');
});

test('last day of the configured window remains active', () => {
  assert.equal(monitorWindowState({today:'2026-11-09',windowStart:'2026-10-27',windowDays:14}).active,true);
});

test('first day after the configured window is closed', () => {
  assert.equal(monitorWindowState({today:'2026-11-10',windowStart:'2026-10-27',windowDays:14}).reason,'WINDOW_CLOSED');
});

test('invalid date or window length remains a real configuration error', () => {
  assert.throws(()=>monitorWindowState({today:'2026-02-30',windowStart:'2026-02-01',windowDays:14}),/MONITOR_TODAY_INVALID/);
  assert.throws(()=>monitorWindowState({today:'2026-11-16',windowStart:'2026-10-27',windowDays:0}),/MONITOR_WINDOW_DAYS_INVALID/);
});
