/**
 * Adapter para o JSON usado pelo próprio formulário da FUMP.
 * Fonte: código-fonte público de https://fump.ufmg.br/cardapio-do-dia/
 * Este módulo NÃO depende do HTML, cookies, DOM ou Playwright.
 */
export const API_BASE = 'https://fump.ufmg.br:3003';
export const SOURCE_PAGE = 'https://fump.ufmg.br/cardapio-do-dia/';
// IDs observados nas <option> do HTML (19/10/2026). A lista da API é checada em tempo de execução.
export const RU_SOURCES = Object.freeze([
  {sourceId: '6', label: 'RU Setorial I', appIds: ['setorial-i']},
  {sourceId: '1', label: 'RU Setorial II', appIds: ['setorial-ii']},
  {sourceId: '2', label: 'RU Saúde e Direito', appIds: ['saude', 'direito']},
  {sourceId: '5', label: 'RU ICA', appIds: ['ica']},
]);

const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function fail(message) { throw new Error(message); }
export function assertIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Data inválida (esperado YYYY-MM-DD)');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) fail('Data inexistente');
  return value;
}
export function dateInBrasilia(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(now).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function addDate(iso, days) {
  const date = new Date(`${assertIsoDate(iso)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
export function menuUrl(sourceId, iso) {
  assertIsoDate(iso);
  if (!RU_SOURCES.some(x=>x.sourceId===String(sourceId))) fail('ID de restaurante não reconhecido');
  const url=new URL('/cardapios/cardapio',API_BASE);
  url.searchParams.set('id',String(sourceId));
  url.searchParams.set('dataInicio',iso);
  url.searchParams.set('dataFim',iso);
  return url.href;
}
export async function getJson(url, {fetchFn = fetch, timeoutMs = 14000} = {}) {
  const relayUrl = process.env.FUMP_RELAY_URL || '';
  const relayToken = process.env.FUMP_RELAY_TOKEN || '';
  if (relayUrl || relayToken) {
    if (!relayUrl || !relayToken) fail('FUMP_RELAY_CONFIG_INCOMPLETE');
    return getJsonViaRelay(url, {fetchFn, timeoutMs, relayUrl, relayToken});
  }

  // Direct fallback remains available for local tests and environments allowed by FUMP.
  const controller = new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchFn(url, {
      signal:controller.signal,
      headers:{Accept:'application/json'},
      redirect:'error',
    });
    if (!response.ok) fail(`HTTP ${response.status} em ${new URL(url).pathname}`);
    const ct=response.headers.get('content-type') || '';
    if (ct && !/json/i.test(ct)) fail(`Resposta inesperada: Content-Type ${ct}`);
    const raw=await response.text();
    if (raw.length > 2_000_000) fail('Resposta excede limite de segurança (2 MB)');
    try {return JSON.parse(raw);} catch {fail('Resposta não é JSON válido');}
  } finally {clearTimeout(timer);}
}

export function buildFumpRelayRequest(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'fump.ufmg.br' || parsed.port !== '3003') {
    fail('FUMP_RELAY_TARGET_NOT_ALLOWED');
  }
  if (parsed.pathname === '/cardapios/restaurantes') return {resource:'restaurants'};
  if (parsed.pathname !== '/cardapios/cardapio') fail('FUMP_RELAY_PATH_NOT_ALLOWED');

  const id = parsed.searchParams.get('id');
  const start = parsed.searchParams.get('dataInicio');
  const end = parsed.searchParams.get('dataFim');
  if (!RU_SOURCES.some(x => x.sourceId === id)) fail('FUMP_RELAY_RU_NOT_ALLOWED');
  assertIsoDate(start);
  assertIsoDate(end);
  if (start !== end) fail('FUMP_RELAY_DATE_RANGE_NOT_ALLOWED');
  return {resource:'menu',id,date:start};
}

export async function getJsonViaRelay(url, {
  fetchFn = fetch,
  timeoutMs = 30000,
  relayUrl,
  relayToken,
} = {}) {
  let endpoint;
  try { endpoint = new URL(relayUrl); } catch { fail('FUMP_RELAY_URL_INVALID'); }
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'script.google.com' ||
      !endpoint.pathname.startsWith('/macros/s/') || !endpoint.pathname.endsWith('/exec')) {
    fail('FUMP_RELAY_URL_NOT_ALLOWED');
  }
  if (typeof relayToken !== 'string' || !/^[a-f0-9]{64}$/i.test(relayToken)) fail('FUMP_RELAY_TOKEN_INVALID');

  const request = buildFumpRelayRequest(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(endpoint.href, {
      method:'POST',
      signal:controller.signal,
      redirect:'follow',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({...request,token:relayToken}),
    });
    if (!response.ok) fail(`FUMP_RELAY_HTTP_${response.status}`);
    const text = await response.text();
    if (text.length > 2_000_000) fail('FUMP_RELAY_RESPONSE_TOO_LARGE');
    let envelope;
    try { envelope = JSON.parse(text); } catch { fail('FUMP_RELAY_INVALID_JSON'); }
    if (!envelope?.ok || envelope?.version !== 1 || !Object.hasOwn(envelope,'data')) {
      fail(`FUMP_RELAY_${String(envelope?.code || 'INVALID_ENVELOPE').replace(/[^A-Z0-9_-]/gi,'_').slice(0,48)}`);
    }
    return envelope.data;
  } finally {
    clearTimeout(timer);
  }
}

/** Checa se IDs continuam associados aos mesmos RUs; aborta se estiverem invertidos. */
export function checkRestaurantList(json) {
  if (!Array.isArray(json)) fail('Lista de restaurantes não é um array');
  const map=new Map(json.map(row=>[String(row?.id ?? ''),norm(row?.nome)]));
  for (const ru of RU_SOURCES) {
    const label=map.get(ru.sourceId);
    if (!label) fail(`Restaurante ID=${ru.sourceId} não encontrado na API`);
    const valid = ru.sourceId==='6' ? /setorial\s*(?:i|1)\b(?!i|1)/.test(label) && !/ii|2\b/.test(label) :
      ru.sourceId==='1' ? /setorial\s*(?:ii|2)\b/.test(label) :
      ru.sourceId==='2' ? /saude/.test(label) && /direito/.test(label) :
      /\bica\b|montes claros/.test(label);
    if (!valid) fail(`Mapeamento divergente ID=${ru.sourceId}: ${label}`);
  }
  return RU_SOURCES.map(ru=>({sourceId:ru.sourceId,apiName:map.get(ru.sourceId),appIds:ru.appIds}));
}

// Uma unica implementacao de interpretacao para Node e navegador.
export {mealKey, categoryKey, parseMenuJson} from '../public/assets/fump-parse.js';
