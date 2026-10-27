/** Processador comunitário de produção. Mantém o botão desativado até ativação coordenada. */
import {spawn} from 'node:child_process';
import {Firestore, Timestamp} from '@google-cloud/firestore';
import {PROJECT, assertProductionEnvironment} from './hub-production-sync-core.mjs';

const COOLDOWN_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_QUERIES_PER_DAY = 48;
const args = new Map(process.argv.slice(2).map(value => value.split('=')));
const mode = args.get('--mode') || 'dry-run';
const safe = value => String(value || 'ERRO').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 100);
assertProductionEnvironment();
if (mode === 'apply' && process.env.HUB_PROD_SYNC_ENABLED !== 'true') throw new Error('PROCESSADOR_PRODUCAO_DESATIVADO');
const db = new Firestore({projectId: PROJECT, databaseId: '(default)'});
const stateRef = db.doc('menuSyncState/current');
const requestRef = db.doc('menuSyncRequests/current');
const dayKey = date => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
async function inspect() { const [state, request] = await Promise.all([stateRef.get(), requestRef.get()]); return {state: state.exists ? state.data() : {}, request: request.exists ? request.data() : null}; }
async function claim() {
  return db.runTransaction(async tx => {
    const [stateSnap, requestSnap] = await Promise.all([tx.get(stateRef), tx.get(requestRef)]);
    if (!requestSnap.exists) return {kind: 'empty'};
    const state = stateSnap.exists ? stateSnap.data() : {}, request = requestSnap.data();
    if (state.acceptingRequests !== true) return {kind: 'disabled'};
    const now = Date.now(), runningAt = state.inProgressAt?.toMillis?.() || 0;
    const stale = state.status === 'running' && now - runningAt >= CLAIM_TIMEOUT_MS;
    if (state.status === 'running' && !stale) return {kind: 'running'};
    if (!['pending', 'running'].includes(request.status)) return {kind: 'not-pending'};
    const next = state.nextAllowedAt?.toMillis?.() || 0;
    if (next > now) return {kind: 'cooldown'};
    const today = dayKey(new Date()), count = state.queryDay === today ? Number(state.queryCount || 0) : 0;
    if (count >= MAX_QUERIES_PER_DAY) return {kind: 'daily-cap'};
    const nowTs = Timestamp.fromMillis(now);
    tx.set(stateRef, {status: 'running', inProgressAt: nowTs, lastAttemptAt: nowTs, queryDay: today, queryCount: count + 1, updatedAt: nowTs}, {merge: true});
    tx.update(requestRef, {status: 'running'});
    return {kind: 'claimed', requestedAt: request.requestedAt || null};
  });
}
function runSync() { return new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/hub-production-menu-sync.mjs', '--mode=apply', '--days=7', '--confirm=PUBLICAR_SOMENTE_HUB_UFMG'], {env: {...process.env, GCLOUD_PROJECT: PROJECT, GOOGLE_CLOUD_PROJECT: PROJECT, HUB_PROD_SYNC_ENABLED: 'true', HUB_PROD_PUBLISH_ENABLED: 'true'}, stdio: ['ignore', 'pipe', 'pipe']});
  let out = '', err = ''; const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60 * 1000);
  child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
  child.on('error', reject); child.on('close', exitCode => { clearTimeout(timer); if (exitCode) reject(new Error(`SYNC_FALHOU_${safe(err || out)}`)); else resolve(out.trim()); });
}); }
async function finish(patch, requestStatus) { const now = Timestamp.now(); await db.runTransaction(async tx => { tx.set(stateRef, {...patch, updatedAt: now}, {merge: true}); tx.update(requestRef, {status: requestStatus}); }); }
try {
  if (mode === 'dry-run') { const value = await inspect(); console.log(JSON.stringify({project: PROJECT, mode, pending: value.request?.status === 'pending', state: value.state.status || 'unknown', acceptingRequests: value.state.acceptingRequests === true, remoteWrites: 0})); }
  else if (mode === 'apply') {
    const claimResult = await claim();
    if (claimResult.kind !== 'claimed') console.log(JSON.stringify({project: PROJECT, mode, outcome: claimResult.kind, remoteWrites: 0}));
    else try { const output = await runSync(); const now = Timestamp.now(); await finish({status: 'success', lastRequestedAt: claimResult.requestedAt, lastQueryAt: now, lastSuccessAt: now, lastPublishedAt: now, nextAllowedAt: Timestamp.fromMillis(now.toMillis() + COOLDOWN_MS), inProgressAt: null, errorCode: null}, 'complete'); console.log(JSON.stringify({project: PROJECT, mode, outcome: 'processed', syncOutput: output, remoteWrites: 3})); }
    catch (error) { const now = Timestamp.now(); await finish({status: 'error', lastQueryAt: now, lastFailureAt: now, nextAllowedAt: Timestamp.fromMillis(now.toMillis() + RETRY_MS), inProgressAt: null, errorCode: safe(error.message)}, 'error'); throw error; }
  } else throw new Error('MODO_INVALIDO');
} catch (error) { console.error(`HUB_PROD_REQUEST_PROCESSOR_BLOCKED=${safe(error.message)}`); process.exitCode = 1; } finally { await db.terminate(); }
