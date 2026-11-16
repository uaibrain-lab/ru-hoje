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

function diagnosticCode(error) {
  const http = String(error?.message || '').match(/\bHTTP\s+(\d{3})\b/i);
  const value = error?.cause?.code || error?.code || (http ? `HTTP_${http[1]}` : error?.name) || 'UNKNOWN';
  return String(value).replace(/[^A-Z0-9_-]/gi, '_').slice(0, 48).toUpperCase();
}

export async function safeGet(url, {
  getJsonFn = getJson,
  maxAttempts = 3,
  timeoutMs = 14000,
  baseDelayMs = 800,
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) fail('TENTATIVAS_INVALIDAS');
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await getJsonFn(url, {timeoutMs});
    } catch (error) {
      lastError = error;
      const transportCode = diagnosticCode(error);
      const host = (() => { try { return new URL(url).host; } catch { return 'HOST_INVALIDO'; } })();
      console.warn(`FUMP_FETCH_RETRY attempt=${attempt}/${maxAttempts} host=${host} cause=${transportCode}`);
      if (attempt < maxAttempts) await wait(baseDelayMs * (2 ** (attempt - 1)));
    }
  }
  throw new Error(`FUMP_FETCH_FAILED_${diagnosticCode(lastError)}`, {cause: lastError});
}

export async function collectSnapshot(days = 7, {
  getJsonFn = getJson,
  now = new Date(),
  maxAttempts = 3,
  baseDelayMs = 800,
} = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 7) fail('DIAS_INVALIDOS');
  checkRestaurantList(await safeGet(`${API_BASE}/cardapios/restaurantes`, {getJsonFn, maxAttempts, baseDelayMs}));
  const today = dateInBrasilia(now);
  const snapshot = {schemaVersion: 1, generatedAt: new Date().toISOString(), source: SOURCE, days: {}, verifiedCompleteDates: []};
  const rows = [];
  for (let offset = 0; offset < days; offset += 1) {
    const iso = addDate(today, offset);
    const day = {restaurants: {}};
    const sourcesWithVerifiedMenus = new Set();
    for (const source of RU_SOURCES) {
      const raw = await safeGet(menuUrl(source.sourceId, iso), {getJsonFn, maxAttempts, baseDelayMs});
      const {meals, meta} = parseMenuJson(raw, {iso, sourceId: source.sourceId});
      const hasMeals = Object.keys(meals).length > 0;
      const datedResponse = meta.cardapios > 0 && meta.checkedDates > 0;
      rows.push({iso, sourceId: source.sourceId,
        status: hasMeals && datedResponse ? 'com-cardapio-datado' : 'resposta-incompleta-nao-autoritativa',
        meals: Object.fromEntries(Object.entries(meals).map(([key, meal]) => [key, meal.items.length])), meta});
      if (hasMeals) {
        if (datedResponse) sourcesWithVerifiedMenus.add(String(source.sourceId));
        const fetchedAt = new Date().toISOString();
        for (const appId of source.appIds) day.restaurants[appId] = {meals: Object.fromEntries(Object.entries(meals).map(([key, meal]) => [key, {...meal, fetchedAt}])), fetchedAt, sourceRestaurantId: source.sourceId};
      }
    }
    // Só uma cobertura positiva e datada das QUATRO fontes autoriza remoção de dados antigos.
    // Resposta vazia, sem data ou parcial pode significar falha de rede ou cardápio ainda não publicado.
    // Nesse cenário o merge conservador atualiza os RUs com dados e preserva os demais.
    if (sourcesWithVerifiedMenus.size === RU_SOURCES.length) snapshot.verifiedCompleteDates.push(iso);
    snapshot.days[iso] = day;
  }
  snapshot.generatedAt = new Date().toISOString();
  const hasAnyMenu = Object.values(snapshot.days).some(day => Object.keys(day?.restaurants || {}).length > 0);
  if (!hasAnyMenu) fail('CARDAPIO_PERIODO_AUSENTE');
  return {snapshot, rows};
}

/**
 * Em dias úteis, o apply de produção exige cardápio válido e datado de todos os RUs
 * para HOJE. Não bloquear dry-run/coleta: eles devem produzir diagnóstico.
 * Feriados e dias de fechamento continuam exigindo avaliação externa/read-only.
 */
export function assertCurrentWeekdayCoverage(rows, now = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
  }).format(now);
  if (weekday === 'Sat' || weekday === 'Sun') return {skipped: true, reason: 'FIM_DE_SEMANA'};

  const today = dateInBrasilia(now);
  const verified = new Set(
    rows
      .filter(row => row?.iso === today && row?.status === 'com-cardapio-datado')
      .map(row => String(row.sourceId))
  );
  const missing = RU_SOURCES.map(source => String(source.sourceId)).filter(id => !verified.has(id)).sort((a, b) => Number(a) - Number(b));
  if (missing.length) fail(`CARDAPIO_ATUAL_INCOMPLETO_RU_${missing.join('_')}`);
  return {skipped: false, date: today, verifiedSourceIds: [...verified]};
}
