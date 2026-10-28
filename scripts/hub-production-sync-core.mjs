/** Núcleo de produção: coleta FUMP e validação sem efeitos remotos. */
import {API_BASE, SOURCE_PAGE, RU_SOURCES, dateInBrasilia, addDate, getJson, checkRestaurantList, menuUrl, parseMenuJson} from './fump-api.mjs';

export const PROJECT = 'hubufmg';
export const DOCUMENT = 'publicMenus/current';
export const SOURCE = SOURCE_PAGE;
const fail = message => { throw new Error(message); };

export function assertProductionEnvironment(env = process.env) {
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) fail('EMULADOR_NAO_PERMITIDO');
  for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_PROJECT_ID']) {
    if (env[key] && env[key] !== PROJECT) fail(`PROJETO_DIVERGENTE_${key}`);
  }
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) fail('CHAVE_JSON_NAO_PERMITIDA');
  return PROJECT;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function safeGet(url) {
  try { return await getJson(url, {timeoutMs: 14000}); }
  catch (error) { await wait(700); return getJson(url, {timeoutMs: 14000}); }
}

export async function collectSnapshot(days = 7) {
  if (!Number.isInteger(days) || days < 1 || days > 7) fail('DIAS_INVALIDOS');
  checkRestaurantList(await safeGet(`${API_BASE}/cardapios/restaurantes`));
  const today = dateInBrasilia();
  const snapshot = {schemaVersion: 1, generatedAt: new Date().toISOString(), source: SOURCE, days: {}, verifiedCompleteDates: []};
  const rows = [];
  for (let offset = 0; offset < days; offset += 1) {
    const iso = addDate(today, offset);
    const day = {restaurants: {}};
    for (const source of RU_SOURCES) {
      const raw = await safeGet(menuUrl(source.sourceId, iso));
      const {meals, meta} = parseMenuJson(raw, {iso, sourceId: source.sourceId});
      rows.push({iso, sourceId: source.sourceId, meals: Object.fromEntries(Object.entries(meals).map(([key, meal]) => [key, meal.items.length])), meta});
      if (Object.keys(meals).length) {
        const fetchedAt = new Date().toISOString();
        for (const appId of source.appIds) day.restaurants[appId] = {meals: Object.fromEntries(Object.entries(meals).map(([key, meal]) => [key, {...meal, fetchedAt}])), fetchedAt, sourceRestaurantId: source.sourceId};
      }
    }
    snapshot.verifiedCompleteDates.push(iso);
    // A data consultada sem refeições também é uma data verificada; manter a
    // data vazia permite ao merge remover somente conteúdo comprovadamente obsoleto.
    snapshot.days[iso] = day;
  }
  snapshot.generatedAt = new Date().toISOString();
  if (!Object.keys(snapshot.days[today]?.restaurants || {}).length) fail('CARDAPIO_ATUAL_AUSENTE');
  return {snapshot, rows};
}
