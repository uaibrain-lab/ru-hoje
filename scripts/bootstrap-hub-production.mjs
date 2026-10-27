/**
 * Bootstrap inicial do Hub UFMG.
 *
 * Regras de segurança:
 * - somente hubufmg e somente Firestore/(default);
 * - coleta exclusivamente a API JSON oficial da FUMP;
 * - nenhuma resposta parcial é publicada;
 * - criação somente: nunca sobrescreve publicMenus/current;
 * - nenhuma chave JSON é aceita; usa ADC temporária/externa do ambiente.
 *
 * Uso explícito:
 * node scripts/bootstrap-hub-production.mjs --days=7 --confirm=HUB_UFMG_PRODUCTION_BOOTSTRAP
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Firestore, FieldValue} from '@google-cloud/firestore';
import {API_BASE, SOURCE_PAGE, RU_SOURCES, dateInBrasilia, addDate, getJson, checkRestaurantList, menuUrl, parseMenuJson} from './fump-api.mjs';

const PROJECT = 'hubufmg';
const DOCUMENT = 'publicMenus/current';
const STATE_DOCUMENT = 'menuSyncState/current';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const daysArg = args.find(value => value.startsWith('--days='));
const days = Number(daysArg?.slice('--days='.length) || 7);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };

if (args.length !== 2 || !daysArg || !args.includes('--confirm=HUB_UFMG_PRODUCTION_BOOTSTRAP') || !Number.isInteger(days) || days < 1 || days > 7) {
  fail('USO: --days=1..7 --confirm=HUB_UFMG_PRODUCTION_BOOTSTRAP');
}
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) fail('EMULADOR_NAO_PERMITIDO');
for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_PROJECT_ID']) {
  if (process.env[key] && process.env[key] !== PROJECT) fail(`PROJETO_DIVERGENTE_${key}`);
}
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) fail('CHAVE_JSON_NAO_PERMITIDA');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function safeGet(url) {
  try { return await getJson(url, {timeoutMs: 14000}); }
  catch (error) { await sleep(700); return getJson(url, {timeoutMs: 14000}); }
}

async function collect() {
  const restaurants = await safeGet(`${API_BASE}/cardapios/restaurantes`);
  checkRestaurantList(restaurants);
  const today = dateInBrasilia();
  const snapshot = {schemaVersion: 1, generatedAt: new Date().toISOString(), source: SOURCE_PAGE, days: {}, verifiedCompleteDates: []};
  const rows = [];
  for (let offset = 0; offset < days; offset += 1) {
    const iso = addDate(today, offset);
    const day = {restaurants: {}};
    let completed = true;
    for (const source of RU_SOURCES) {
      let raw;
      try { raw = await safeGet(menuUrl(source.sourceId, iso)); }
      catch (error) { completed = false; throw new Error(`FONTE_FUMP_${iso}_${source.sourceId}_${String(error.message || error)}`); }
      const {meals, meta} = parseMenuJson(raw, {iso, sourceId: source.sourceId});
      rows.push({date: iso, sourceId: source.sourceId, meals: Object.fromEntries(Object.entries(meals).map(([key, meal]) => [key, meal.items.length])), meta});
      if (Object.keys(meals).length) {
        const fetchedAt = new Date().toISOString();
        for (const appId of source.appIds) {
          day.restaurants[appId] = {
            meals: Object.fromEntries(Object.entries(meals).map(([key, meal]) => [key, {...meal, fetchedAt}])),
            fetchedAt,
            sourceRestaurantId: source.sourceId,
          };
        }
      }
    }
    if (completed) snapshot.verifiedCompleteDates.push(iso);
    if (Object.keys(day.restaurants).length) snapshot.days[iso] = day;
  }
  snapshot.generatedAt = new Date().toISOString();
  if (!snapshot.days[dateInBrasilia()]?.restaurants?.['setorial-i']?.meals?.almoco?.items?.length ||
      !snapshot.days[dateInBrasilia()]?.restaurants?.['setorial-ii']?.meals?.almoco?.items?.length) {
    fail('ALMOCOS_ATUAIS_DOS_DOIS_SETORIAIS_AUSENTES');
  }
  return {snapshot, rows};
}

async function savePrivateCandidate(snapshot) {
  const parent = path.resolve(process.env.HUB_UFMG_PRIVATE_BACKUP_DIR || path.join(path.dirname(ROOT), 'HUB-UFMG-PRIVATE-BACKUPS'));
  if (parent === ROOT || parent.startsWith(`${ROOT}${path.sep}`)) fail('BACKUP_PRIVADO_DENTRO_DO_PROJETO');
  await fs.mkdir(parent, {recursive: true, mode: 0o700});
  const payload = JSON.stringify(snapshot, null, 2) + '\n';
  const file = path.join(parent, `hub-production-bootstrap-${new Date().toISOString().replace(/[:.]/g, '-')}-${sha256(payload).slice(0, 12)}.json`);
  await fs.writeFile(file, payload, {flag: 'wx', mode: 0o600});
  return {file, hash: sha256(payload), bytes: Buffer.byteLength(payload)};
}

async function main() {
  const {snapshot, rows} = await collect();
  const payload = JSON.stringify(snapshot);
  if (Buffer.byteLength(payload, 'utf8') > 850_000) fail('DOCUMENTO_ACIMA_850KB');
  const candidate = await savePrivateCandidate(snapshot);
  const db = new Firestore({projectId: PROJECT, databaseId: '(default)'});
  try {
    const menuRef = db.doc(DOCUMENT);
    const stateRef = db.doc(STATE_DOCUMENT);
    await db.runTransaction(async tx => {
      const existing = await tx.get(menuRef);
      if (existing.exists) fail('PUBLIC_MENUS_CURRENT_JA_EXISTE_NENHUMA_ESCRITA');
      tx.create(menuRef, {payload, updatedAt: FieldValue.serverTimestamp(), source: SOURCE_PAGE, bootstrap: true});
      tx.create(stateRef, {
        acceptingRequests: false,
        status: 'disabled',
        requestProcessor: 'not-activated',
        lastQueryAt: null,
        lastSuccessAt: null,
        lastPublishedAt: null,
        lastFailureAt: null,
        nextAllowedAt: null,
        inProgressAt: null,
        queryDay: null,
        queryCount: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    const after = await menuRef.get();
    const stateAfter = await stateRef.get();
    if (!after.exists || after.data()?.payload !== payload || !stateAfter.exists || stateAfter.data()?.acceptingRequests !== false) {
      fail('VERIFICACAO_POS_BOOTSTRAP_FALHOU');
    }
    console.log(JSON.stringify({project: PROJECT, database: '(default)', document: DOCUMENT, stateDocument: STATE_DOCUMENT, remoteWrites: 2, days: Object.keys(snapshot.days).length, verifiedCompleteDates: snapshot.verifiedCompleteDates.length, candidateSha256: candidate.hash, candidateBytes: candidate.bytes, rows, acceptingRequests: false}));
  } finally { await db.terminate(); }
}

try { await main(); }
catch (error) {
  console.error(`HUB_PRODUCTION_BOOTSTRAP_BLOCKED=${String(error?.message || error).replace(/[^A-Z0-9_-]/gi, '_').slice(0, 160)}`);
  process.exitCode = 1;
}
