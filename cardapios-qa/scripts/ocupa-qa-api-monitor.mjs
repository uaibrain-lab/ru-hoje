import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {API_BASE, RU_SOURCES, SOURCE_PAGE, addDate, dateInBrasilia, getJson, checkRestaurantList, menuUrl, parseMenuJson} from './fump-api.mjs';

const args = new Map(process.argv.slice(2).filter(x => x.startsWith('--')).map(x => {
  const [key, ...value] = x.slice(2).split('=');
  return [key, value.join('=')];
}));
const days = Number(args.get('days') || '7');
const stateDir = path.resolve(args.get('state-dir') || 'monitor-state');
const windowStart = args.get('window-start') || '2026-10-27';
const windowDays = Number(args.get('window-days') || '14');
if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('DIAS_INVALIDOS');
if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 31) throw new Error('JANELA_INVALIDA');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const now = new Date();
const observedAt = now.toISOString();
const today = dateInBrasilia(now);
const cutoff = addDate(windowStart, windowDays - 1);
if (today < windowStart || today > cutoff) throw new Error('JANELA_MONITORAMENTO_ENCERRADA');

await fs.mkdir(stateDir, {recursive: true});
let previous = {schemaVersion: 1, observations: {}};
try {
  previous = JSON.parse(await fs.readFile(path.join(stateDir, 'last.json'), 'utf8'));
  if (previous.schemaVersion !== 1 || !previous.observations || typeof previous.observations !== 'object') throw new Error('ESTADO_INVALIDO');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function content(items) {
  return items.map(item => [normalize(item.name), normalize(item.category), normalize(item.sourceType)]);
}

function changedDishCount(before, after) {
  const a = new Set((before || []).map(item => normalize(item.name)));
  const b = new Set((after || []).map(item => normalize(item.name)));
  return new Set([...a, ...b].filter(name => a.has(name) !== b.has(name))).size;
}

async function collect() {
  const restaurants = await getJson(`${API_BASE}/cardapios/restaurantes`, {timeoutMs: 12000});
  checkRestaurantList(restaurants);
  const observations = {};
  const empty = [];
  const failures = [];
  const dates = [];
  for (let offset = 0; offset < days; offset++) dates.push(addDate(today, offset));
  for (const iso of dates) {
    for (const source of RU_SOURCES) {
      try {
        const raw = await getJson(menuUrl(source.sourceId, iso), {timeoutMs: 12000});
        const parsed = parseMenuJson(raw, {iso, sourceId: source.sourceId});
        const sourceTimestamp = raw?.generatedAt || raw?.updatedAt || raw?.timestamp || raw?.dataAtualizacao || null;
        for (const ru of source.appIds) {
          for (const [meal, value] of Object.entries(parsed.meals)) {
            const items = value.items || [];
            const key = `${ru}|${iso}|${meal}`;
            observations[key] = {
              key, restaurant: ru, sourceId: source.sourceId, date: iso, meal,
              observedAt, sourceTimestamp,
              dishCount: items.length,
              contentHash: sha256(JSON.stringify(content(items))),
              items: content(items),
            };
          }
        }
        if (!Object.keys(parsed.meals).length) empty.push({sourceId: source.sourceId, date: iso});
      } catch (error) {
        failures.push({sourceId: source.sourceId, date: iso, error: String(error?.message || error).replace(/[^A-Za-z0-9_ .:/-]/g, '_').slice(0, 160)});
      }
    }
  }
  return {observations, empty, failures, dates};
}

const result = await collect();
const changes = [];
for (const [key, current] of Object.entries(result.observations)) {
  const old = previous.observations[key];
  if (!old || old.contentHash !== current.contentHash) {
    changes.push({
      key, restaurant: current.restaurant, date: current.date, meal: current.meal,
      fromObservedAt: old?.observedAt || null, toObservedAt: current.observedAt,
      previousHash: old?.contentHash || null, currentHash: current.contentHash,
      previousDishCount: old?.dishCount || 0, currentDishCount: current.dishCount,
      changedDishCount: changedDishCount(old?.items, current.items),
      sourceTimestamp: current.sourceTimestamp,
    });
  }
}

const state = {schemaVersion: 1, source: SOURCE_PAGE, api: API_BASE, windowStart, windowDays, lastObservedAt: observedAt, observations: result.observations};
const report = {
  schemaVersion: 1, mode: 'read-only', source: SOURCE_PAGE, api: API_BASE,
  observedAt, timezone: 'America/Sao_Paulo', date: today, windowStart, windowDays,
  dates: result.dates, observationCount: Object.keys(result.observations).length,
  changes, empty: result.empty, failures: result.failures, remoteWrites: 0,
};
await fs.writeFile(path.join(stateDir, 'last.json'), JSON.stringify(state, null, 2) + '\n', {mode: 0o600});
await fs.writeFile(path.join(stateDir, 'observation.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
console.log(JSON.stringify({mode: report.mode, observedAt, date: today, observations: report.observationCount, changes: changes.length, empty: result.empty.length, failures: result.failures.length, remoteWrites: 0}));
