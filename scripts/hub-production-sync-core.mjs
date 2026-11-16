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
  const message = String(error?.message || '');
  const wrapped = message.match(/FUMP_FETCH_FAILED_([A-Z0-9_-]+)/i);
  const http = message.match(/\\bHTTP\\s+(\\d{3})\\b/i);
  const value = error?.cause?.code || error?.code || (wrapped ? wrapped[1] : null) || (http ? `HTTP_${http[1]}` : null) || (error?.name && error.name !== 'Error' ? error.name : message) || 'UNKNOWN';
  return String(value).replace(/[^A-Z0-9_-]/gi, '_').slice(0, 48).toUpperCase();
}

function isRetryable(error) {
  const code = diagnosticCode(error);
  if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_SOCKET|ABORTERROR)$/.test(code)) return true;
  const http = String(error?.message || '').match(/\\bHTTP\\s+(\\d{3})\\b/i);
  if (http) return http[1] === '429' || Number(http[1]) >= 500;
  return false;
}

export async function safeGet(url, {
  getJsonFn = getJson,
  maxAttempts = 3,
  timeoutMs = 30000,
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
      if (attempt >= maxAttempts || !isRetryable(error)) break;
      // Backoff exponencial com jitter leve; falhas permanentes (ex.: HTTP 403)
      // não recebem tentativas repetidas desnecessárias.
      const jitter = Math.floor(Math.random() * Math.min(500, baseDelayMs));
      await wait(baseDelayMs * (2 ** (attempt - 1)) + jitter);
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

  const today = dateInBrasilia(now);
  const snapshot = {schemaVersion: 1, generatedAt: new Date().toISOString(), source: SOURCE, days: {}, verifiedCompleteDates: []};
  const rows = [];
  // A lista de restaurantes é apenas uma verificação auxiliar. A origem (ID)
  // de cada endpoint já é fixa e conhecida. Se /restaurantes estiver fora do ar,
  // nunca bloquear /cardapios/cardapio dos quatro RUs por isso.
  try {
    checkRestaurantList(await safeGet(`${API_BASE}/cardapios/restaurantes`, {getJsonFn, maxAttempts, baseDelayMs}));
  } catch (error) {
    const detail = diagnosticCode(error);
    console.warn(`FUMP_RESTAURANTES_UNAVAILABLE=${detail}; tentando endpoints individuais`);
    rows.push({iso: today, sourceId: null, stage:'restaurant-list', status:'FETCH_ERROR', error: detail});
  }

  for (let offset = 0; offset < days; offset += 1) {
    const iso = addDate(today, offset);
    const day = {restaurants: {}};
    const verifiedSources = new Set();

    for (const source of RU_SOURCES) {
      let raw;
      try {
        raw = await safeGet(menuUrl(source.sourceId, iso), {getJsonFn, maxAttempts, baseDelayMs});
      } catch (error) {
        rows.push({iso, sourceId: source.sourceId, status: 'FETCH_ERROR', error: diagnosticCode(error)});
        continue;
      }

      let meals;
      let meta;
      try {
        // Uma resposta explicitamente atribuída a outro RU nunca pode contaminar
        // a publicação, mesmo com o mapeamento auxiliar indisponível.
        if (raw?.id != null && String(raw.id) !== String(source.sourceId)) {
          throw new Error('FUMP_RESPONSE_RU_MISMATCH');
        }
        ({meals, meta} = parseMenuJson(raw, {iso, sourceId: source.sourceId}));
      } catch (error) {
        rows.push({iso, sourceId: source.sourceId, status: 'PARSE_ERROR', error: diagnosticCode(error)});
        continue;
      }

      const hasMeals = Object.keys(meals).length > 0;
      if (!hasMeals) {
        // Vazio não significa RU fechado e nunca autoriza remoção.
        rows.push({iso, sourceId: source.sourceId, status:'NOT_PUBLISHED', meals:{}, meta});
        continue;
      }
      const dateEvidence = meta.checkedDates > 0 ? 'response' : 'request';
      // Se a FUMP não inclui "data" no corpo, os pratos foram solicitados
      // para uma ÚNICA data exata. Podem ser mesclados conservadoramente,
      // mas nunca tornam a data autoritativa para apagar dados antigos.
      if (dateEvidence === 'response') verifiedSources.add(String(source.sourceId));
      rows.push({
        iso,
        sourceId: source.sourceId,
        status: 'VALID_MENU',
        dateEvidence,
        meals: Object.fromEntries(Object.entries(meals).map(([key, meal]) => [key, meal.items.length])),
        meta
      });
      const fetchedAt = new Date().toISOString();
      for (const appId of source.appIds) {
        day.restaurants[appId] = {
          meals: Object.fromEntries(Object.entries(meals).map(([key, meal]) => [key, {...meal, fetchedAt}])),
          fetchedAt,
          sourceRestaurantId: source.sourceId
        };
      }
    }

    // Uma data só é autoritativa para remoção quando as quatro fontes têm menu validado.
    // Para dados incompletos, mergeSnapshots conserva tudo que não veio nesta leitura.
    if (verifiedSources.size === RU_SOURCES.length) snapshot.verifiedCompleteDates.push(iso);
    snapshot.days[iso] = day;
  }

  snapshot.generatedAt = new Date().toISOString();
  const hasAnyMenu = Object.values(snapshot.days).some(day => Object.keys(day?.restaurants || {}).length > 0);
  if (!hasAnyMenu) fail('CARDAPIO_PERIODO_AUSENTE');
  return {snapshot, rows};
}

/**
 * Proteção do apply em dia útil:
 * não exigir que todos os restaurantes publiquem refeições no mesmo momento.
 * Permitir atualização independente dos RUs com menu válido e datado;
 * a ausência de qualquer fonte continua não autoritativa e é preservada pelo merge.
 * Sem nenhum menu válido para hoje, bloquear a escrita.
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
      .filter(row => row?.iso === today && row?.status === 'VALID_MENU')
      .map(row => String(row.sourceId))
  );
  if (!verified.size) fail('CARDAPIO_ATUAL_SEM_FONTE_VALIDA');
  return {skipped: false, date: today, verifiedSourceIds: [...verified].sort()};
}
