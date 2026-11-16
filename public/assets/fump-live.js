/**
 * Leitura pública direta FUMP por navegador. Não escreve no Firebase.
 * Se CORS não permitir a origem do Hub, devolve FETCH_ERROR e preserva
 * o snapshot Firestore/cache exibido. Nunca usa mode:'no-cors'.
 */
import {parseMenuJson} from './fump-parse.js';

const BASE = 'https://fump.ufmg.br:3003';
const APP_TO_SOURCE = Object.freeze({
  'setorial-i':'6', 'setorial-ii':'1', saude:'2', direito:'2', ica:'5'
});
const DEFAULT_TIMEOUT_MS = 8500;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = error => String(error?.message || error?.name || 'UNKNOWN')
  .replace(/[^A-Za-z0-9_ .:/-]/g, '_').slice(0, 96);

export function sourceForRu(ruId) { return APP_TO_SOURCE[ruId] || null; }
export function validISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso+'T12:00:00Z');
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0,10)===iso;
}
export function buildLiveUrl(ruId, iso) {
  const id = sourceForRu(ruId);
  if (!id || !validISO(iso)) throw new Error('FUMP_LIVE_INVALID_SOURCE_OR_DATE');
  const url = new URL('/cardapios/cardapio',BASE);
  url.searchParams.set('id',id);
  url.searchParams.set('dataInicio',iso);
  url.searchParams.set('dataFim',iso);
  return url.href;
}

/**
 * Recebe somente a origem HTTPS configurada pelo proprietário do Hub.
 * Nunca permite ao usuário escolher URL de upstream.
 */
export function buildProxyMenuUrl(ruId, iso, proxyBase) {
  const id=sourceForRu(ruId);
  if(!id || !validISO(iso)) throw new Error('FUMP_PROXY_INVALID_SOURCE_OR_DATE');
  let base;
  try {base=new URL(proxyBase);} catch {throw new Error('FUMP_PROXY_URL_INVALID');}
  if(base.protocol!=='https:' || base.username || base.password ||
      base.search || base.hash || !['','/'].includes(base.pathname)) {
    throw new Error('FUMP_PROXY_URL_INVALID');
  }
  const endpoint=new URL('/api/menu',base);
  endpoint.searchParams.set('id',id);
  endpoint.searchParams.set('data',iso);
  return endpoint.href;
}

async function fetchOnce(url, fetchFn, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),timeoutMs);
  try {
    const response = await fetchFn(url, {
      method:'GET',mode:'cors',credentials:'omit',cache:'no-store',
      signal:controller.signal, headers:{Accept:'application/json'},redirect:'error'
    });
    const status = Number(response.status || 0);
    if (!response.ok) {
      const err = new Error('FUMP_LIVE_HTTP_'+status);
      err.status = status;
      const retry = response.headers?.get?.('retry-after') || '';
      const seconds = /^\d+$/.test(retry) ? Number(retry) : NaN;
      err.retryAfterMs = Number.isFinite(seconds) ? Math.min(seconds*1000,8000) : 0;
      throw err;
    }
    const ct = response.headers?.get?.('content-type') || '';
    if (ct && !/json/i.test(ct)) throw new Error('FUMP_LIVE_NOT_JSON');
    const body = await response.text();
    if (!body || body.length > 2_000_000) throw new Error('FUMP_LIVE_BAD_BODY');
    try { return JSON.parse(body); }
    catch { throw new Error('FUMP_LIVE_INVALID_JSON'); }
  } finally {
    clearTimeout(timer);
  }
}

function transient(err) {
  return err?.name === 'AbortError' || err?.name === 'TimeoutError'
    || err instanceof TypeError || err?.status === 429 || (err?.status >= 500 && err?.status <= 599);
}

export async function readLiveMenu(ruId, iso, {
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = 2,
  sleepFn = sleep,
  nowFn = () => new Date(),
  proxyUrl = ''
} = {}) {
  let url;
  try { url = proxyUrl ? buildProxyMenuUrl(ruId,iso,proxyUrl) : buildLiveUrl(ruId,iso); }
  catch { return {status:'PARSE_ERROR',ruId,iso,error:'INVALID_SOURCE_OR_DATE'}; }
  const sourceId = sourceForRu(ruId);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error('FUMP_LIVE_INVALID_ATTEMPTS');
  }
  let response;
  for (let attempt=1;attempt<=maxAttempts;attempt++) {
    try {
      response = await fetchOnce(url,fetchFn,timeoutMs);
      break;
    } catch (error) {
      if (!transient(error) || attempt===maxAttempts) {
        return {status:'FETCH_ERROR',ruId,iso,error:error?.status ? 'HTTP_'+error.status : clean(error)};
      }
      await sleepFn(error?.retryAfterMs || 400*(2**(attempt-1))+Math.floor(Math.random()*200));
    }
  }
  try {
    if (!response || !Array.isArray(response.cardapios)) throw new Error('FUMP_LIVE_SCHEMA_CHANGED');
    if (response.id != null && String(response.id)!==sourceId) throw new Error('FUMP_LIVE_RU_MISMATCH');
    const {meals,meta} = parseMenuJson(response,{iso,sourceId});
    if (!Object.values(meals).some(v => Array.isArray(v.items) && v.items.length)) {
      return {status:'NOT_PUBLISHED',ruId,iso,sourceId,meta};
    }
    // Quando o JSON não traz data explícita, a consulta é atribuída à data
    // solicitada nos dois parâmetros oficiais. Não aceitar qualquer data divergente.
    const fetchedAt = nowFn().toISOString();
    return {status:'VALID_MENU',ruId,iso,sourceId,fetchedAt,
      dateEvidence:meta.checkedDates ? 'response' : 'request',
      meals:Object.fromEntries(Object.entries(meals).map(([key,v]) => [
        key,{...v,fetchedAt}
      ])),meta};
  } catch (error) {
    return {status:'PARSE_ERROR',ruId,iso,error:clean(error)};
  }
}

/** Evita cache antigo de outra data ou fonte ser mostrado como cardápio atual. */
export function isValidLiveEntry(value, iso, ruId) {
  return !!(value && value.iso===iso
    && value.sourceRestaurantId===sourceForRu(ruId)
    && typeof value.fetchedAt==='string' && Number.isFinite(Date.parse(value.fetchedAt))
    && Date.parse(value.fetchedAt)<=Date.now()+600000
    && value.meals && typeof value.meals==='object'
    && Object.values(value.meals).some(meal => Array.isArray(meal?.items)
      && meal.items.some(item => typeof item?.name==='string' && item.name.trim())));
}
