import {Firestore, Timestamp} from '@google-cloud/firestore';
import {spawn} from 'node:child_process';

const PROJECT = 'bandeco-homologacao';
const COOLDOWN_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_REAL_QUERIES_PER_DAY = 48;
const MAX_ATTEMPTS_PER_REQUEST = 3;
const MAX_RECOVERIES = 2;
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;
const mode = new Map(process.argv.slice(2).map(arg => arg.split('=')));
const requestedMode = mode.get('--mode') || 'dry-run';

function assertQa() {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('EMULATOR_NAO_PERMITIDO');
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT) throw new Error('PROJETO_QA_OBRIGATORIO');
  if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) throw new Error('PROJETO_QA_OBRIGATORIO');
  if (requestedMode === 'apply' && process.env.OCUPA_QA_SYNC_ENABLED !== 'true') throw new Error('SYNC_QA_DESABILITADO');
  if (requestedMode === 'apply' && process.env.OCUPA_QA_PUBLISH_ENABLED !== 'true') throw new Error('PUBLISH_QA_DESABILITADO');
}
function safeCode(value) { return String(value || 'ERRO').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80); }
function dayKey(date = new Date()) { return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date); }
function firestore() { return new Firestore({projectId: PROJECT}); }
async function inspect(db) {
  const [stateSnap, requestSnap] = await Promise.all([
    db.doc('menuSyncState/current').get(),
    db.doc('menuSyncRequests/current').get(),
  ]);
  const state = stateSnap.exists ? stateSnap.data() : {};
  const request = requestSnap.exists ? requestSnap.data() : null;
  return {state, request, stateSnap, requestSnap};
}
async function claim(db) {
  return db.runTransaction(async tx => {
    const stateRef = db.doc('menuSyncState/current');
    const requestRef = db.doc('menuSyncRequests/current');
    const [stateSnap, requestSnap] = await Promise.all([tx.get(stateRef), tx.get(requestRef)]);
    if (!requestSnap.exists) return {kind: 'empty'};
    const state = stateSnap.exists ? stateSnap.data() : {};
    const request = requestSnap.data();
    const now = Date.now();
    const next = state.nextAllowedAt?.toMillis?.() || 0;
    if (state.acceptingRequests !== true) return {kind: 'disabled'};
    const inProgress = state.inProgressAt?.toMillis?.() || 0;
    const stale = state.status === 'running' && inProgress > 0 && now - inProgress >= CLAIM_TIMEOUT_MS;
    if (request.status !== 'pending' && !(request.status === 'running' && stale)) return {kind: 'not-pending'};
    if (state.status === 'running' && !stale) return {kind: 'running'};
    if (next > now) return {kind: 'cooldown'};
    const today = dayKey();
    const queryCount = state.queryDay === today ? Number(state.queryCount || 0) : 0;
    if (queryCount >= MAX_REAL_QUERIES_PER_DAY) {
      const nextDay = new Date();
      nextDay.setDate(nextDay.getDate() + 1);
      const ts = Timestamp.fromDate(nextDay);
      tx.set(stateRef, {status: 'error', errorCode: 'LIMITE_DIARIO', nextAllowedAt: ts, inProgressAt: null, updatedAt: Timestamp.fromMillis(now)}, {merge: true});
      tx.update(requestRef, {status: 'error'});
      return {kind: 'daily-cap'};
    }
    const requestKey = request.requestedAt?.toMillis?.()?.toString() || 'sem-data';
    const sameRequest = state.requestKey === requestKey;
    const attempts = sameRequest ? Number(state.attemptCount || 0) : 0;
    const recoveries = sameRequest ? Number(state.recoveryCount || 0) : 0;
    if (attempts >= MAX_ATTEMPTS_PER_REQUEST) {
      tx.set(stateRef, {status: 'error', errorCode: 'LIMITE_TENTATIVAS', nextAllowedAt: Timestamp.fromMillis(now + RETRY_MS), inProgressAt: null, updatedAt: Timestamp.fromMillis(now)}, {merge: true});
      tx.update(requestRef, {status: 'error'});
      return {kind: 'attempt-cap'};
    }
    if (stale && recoveries >= MAX_RECOVERIES) {
      tx.set(stateRef, {status: 'error', errorCode: 'LIMITE_RECUPERACAO', nextAllowedAt: Timestamp.fromMillis(now + RETRY_MS), inProgressAt: null, updatedAt: Timestamp.fromMillis(now)}, {merge: true});
      tx.update(requestRef, {status: 'error'});
      return {kind: 'recovery-cap'};
    }
    const nowTs = Timestamp.fromMillis(now);
    tx.set(stateRef, {status: 'running', inProgressAt: nowTs, lastAttemptAt: nowTs, queryDay: today, queryCount: queryCount + 1, requestKey, attemptCount: attempts + 1, recoveryCount: stale ? recoveries + 1 : recoveries, updatedAt: nowTs}, {merge: true});
    tx.update(requestRef, {status: 'running'});
    return {kind: 'claimed', requestedAt: request.requestedAt || null, recovered: stale};
  });
}
function runSync() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/ocupa-qa-menu-sync.mjs', '--mode=apply', '--days=1', '--ack=PUBLICAR_SOMENTE_OCUPA_QA'], {
      env: {...process.env, GCLOUD_PROJECT: PROJECT, GOOGLE_CLOUD_PROJECT: PROJECT},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, PROCESS_TIMEOUT_MS);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      let summary = null;
      for (const line of out.trim().split(/\r?\n/).reverse()) {
        try { summary = JSON.parse(line); break; } catch {}
      }
      if (code !== 0) reject(Object.assign(new Error(timedOut ? 'SYNC_TIMEOUT' : 'SYNC_FALHOU'), {code: safeCode(err || out), summary}));
      else resolve(summary || {});
    });
  });
}
async function finish(db, patch, requestStatus) {
  const now = Timestamp.now();
  await db.runTransaction(async tx => {
    tx.set(db.doc('menuSyncState/current'), {...patch, updatedAt: now}, {merge: true});
    tx.set(db.doc('menuSyncRequests/current'), {status: requestStatus}, {merge: true});
  });
}
async function main() {
  assertQa();
  const db = firestore();
  if (requestedMode === 'dry-run') {
    const {state, request} = await inspect(db);
    console.log(JSON.stringify({project: PROJECT, mode: requestedMode, pending: request?.status === 'pending', state: state.status || 'unknown', remoteWrites: 0}));
    return;
  }
  if (requestedMode !== 'apply') throw new Error('MODO_INVALIDO');
  const claimed = await claim(db);
  if (claimed.kind !== 'claimed') {
    console.log(JSON.stringify({project: PROJECT, mode: requestedMode, outcome: claimed.kind, publicMenuWrites: 0, controlWrites: claimed.kind === 'empty' || claimed.kind === 'not-pending' ? 0 : 2}));
    return;
  }
  try {
    const summary = await runSync();
    const now = Timestamp.now();
    const published = summary.remoteWrites === 1 ? {lastPublishedAt: now} : {};
    await finish(db, {status: summary.remoteWrites === 1 ? 'success' : 'no-change', lastRequestedAt: claimed.requestedAt, lastQueryAt: now, lastSuccessAt: now, nextAllowedAt: Timestamp.fromMillis(now.toMillis() + COOLDOWN_MS), inProgressAt: null, errorCode: null, ...published}, 'complete');
    console.log(JSON.stringify({project: PROJECT, mode: requestedMode, outcome: summary.remoteWrites === 1 ? 'published' : 'no-change', publicMenuWrites: summary.remoteWrites === 1 ? 1 : 0, controlWrites: 2}));
  } catch (error) {
    const now = Timestamp.now();
    await finish(db, {status: 'error', lastRequestedAt: claimed.requestedAt, lastQueryAt: now, lastFailureAt: now, nextAllowedAt: Timestamp.fromMillis(now.toMillis() + RETRY_MS), inProgressAt: null, errorCode: safeCode(error.code || error.message)}, 'error');
    throw error;
  }
}
main().catch(error => { console.error(`OCUPA_QA_REFRESH_PROCESSOR_BLOCKED=${safeCode(error.message)}`); process.exitCode = 1; });
