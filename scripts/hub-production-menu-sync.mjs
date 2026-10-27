/** Sincronizador FUMP de produção. Nunca faz fallback para QA ou produção antiga. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Firestore, FieldValue} from '@google-cloud/firestore';
import {mergeSnapshots} from './merge-snapshots.mjs';
import {decideWrite} from './ocupa-qa-menu-core.mjs';
import {PROJECT, DOCUMENT, assertProductionEnvironment, collectSnapshot} from './hub-production-sync-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args.find(value => value.startsWith('--mode='))?.slice(7);
const days = Number(args.find(value => value.startsWith('--days='))?.slice(7) || 7);
const confirm = args.includes('--confirm=PUBLICAR_SOMENTE_HUB_UFMG');
const sha = value => createHash('sha256').update(value).digest('hex');
const code = value => String(value || 'ERRO').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 100);
const fail = message => { throw new Error(message); };

if (!['collect', 'dry-run', 'apply'].includes(mode) || args.some(value => !/^--(?:mode=(?:collect|dry-run|apply)|days=[1-7]|confirm=PUBLICAR_SOMENTE_HUB_UFMG)$/.test(value))) fail('ARGUMENTOS_NAO_PERMITIDOS');
assertProductionEnvironment();
if (mode === 'apply' && (!confirm || process.env.HUB_PROD_SYNC_ENABLED !== 'true' || process.env.HUB_PROD_PUBLISH_ENABLED !== 'true')) fail('FLAGS_PRODUCAO_DESATIVADAS');

async function backup(oldPayload, updateTime) {
  const dir = process.env.HUB_PROD_BACKUP_DIR;
  if (!dir || !path.isAbsolute(dir) || path.resolve(dir).startsWith(ROOT + path.sep)) fail('BACKUP_PRIVADO_OBRIGATORIO');
  await fs.mkdir(dir, {recursive: true, mode: 0o700});
  const text = JSON.stringify({project: PROJECT, document: DOCUMENT, updateTime, payload: oldPayload}, null, 2) + '\n';
  const file = path.join(dir, `hub-prod-before-${new Date().toISOString().replace(/[:.]/g, '-')}-${sha(text).slice(0, 12)}.json`);
  await fs.writeFile(file, text, {flag: 'wx', mode: 0o600});
  return {file, hash: sha(text)};
}

async function main() {
  const {snapshot, rows} = await collectSnapshot(days);
  const summary = {project: PROJECT, document: DOCUMENT, mode, rows, days: Object.keys(snapshot.days).length, verifiedCompleteDates: snapshot.verifiedCompleteDates.length, remoteWrites: 0};
  if (mode === 'collect') { console.log(JSON.stringify(summary)); return; }
  const db = new Firestore({projectId: PROJECT, databaseId: '(default)'});
  try {
    const ref = db.doc(DOCUMENT);
    const old = await ref.get();
    if (!old.exists || typeof old.data()?.payload !== 'string') fail('DOCUMENTO_PRODUCAO_AUSENTE');
    const previous = JSON.parse(old.data().payload);
    const merged = mergeSnapshots(previous, snapshot);
    const decision = decideWrite(previous, merged);
    const payload = JSON.stringify(merged);
    if (Buffer.byteLength(payload, 'utf8') > 850_000) fail('DOCUMENTO_ACIMA_850KB');
    if (mode === 'dry-run') { console.log(JSON.stringify({...summary, plannedWrite: decision.write, reason: decision.reason, candidateSha256: sha(payload)})); return; }
    if (!decision.write) { console.log(JSON.stringify({...summary, reason: 'SEM_ALTERACOES', writePerformed: 0})); return; }
    const save = await backup(old.data().payload, old.updateTime.toDate().toISOString());
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (!current.exists || current.updateTime.toMillis() !== old.updateTime.toMillis()) fail('PRECONDICAO_LAST_UPDATE_TIME');
      tx.update(ref, {payload, updatedAt: FieldValue.serverTimestamp(), source: snapshot.source}, {lastUpdateTime: old.updateTime});
    });
    const after = await ref.get();
    if (after.data()?.payload !== payload) fail('VERIFICACAO_PUBLICACAO_DIVERGENTE');
    console.log(JSON.stringify({...summary, reason: decision.reason, writePerformed: 1, remoteWrites: 1, backupSha256: save.hash, backupPath: save.file, payloadSha256: sha(payload)}));
  } finally { await db.terminate(); }
}
try { await main(); } catch (error) { console.error(`HUB_PROD_SYNC_BLOCKED=${code(error.message)}`); process.exitCode = 1; }
