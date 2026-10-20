import {categoryFromSourceType} from '../public/assets/dish-category.js';
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
  // A chamada usa TLS verificado. Não desabilitar verificação de certificado.
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

export function mealKey(tipo) {
  const t=norm(tipo);
  if(t==='almoco') return 'almoco';
  if(t==='jantar') return 'jantar';
  if(t==='cafe da manha' || t==='desjejum') return 'cafe';
  return null;
}
// API e aplicativo utilizam a MESMA interpretação de tipos da FUMP.
export const categoryKey = categoryFromSourceType;
function parseDate(value) {
  if (!value) return null;
  const text=String(value);
  const iso=text.match(/^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
  if(iso) return iso[1];
  const br=text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}
const BLOCKED = /(?:valorizamos sua privacidade|personalizar|aceitar tudo|ir para o menu|cardapios dos rus|cookieyes-consent|document\.body|<[^>]+>)/i;
function cleanDish(value) {
  if(typeof value !== 'string') return null;
  const v=value.replace(/\s+/g,' ').trim();
  if (!v || v.length>180 || /[\r\n]/.test(value) || BLOCKED.test(v)) return null;
  return v;
}

/**
 * Schema observável no JavaScript oficial:
 * {cardapios: [{refeicoes:[{tipoRefeicao:'Almoço', pratos:[{tipoPrato, descricaoPrato}]}]}]}
 * Qualquer estrutura diferente falha explicitamente, não produz falsos cardápios.
 */
export function parseMenuJson(json, {iso, sourceId} = {}) {
  assertIsoDate(iso);
  if (!RU_SOURCES.some(r=>r.sourceId===String(sourceId))) fail('Fonte desconhecida');
  if (!json || !Array.isArray(json.cardapios)) fail('JSON não contém cardapios[]');
  const result={};
  let checkedDates=0;
  let ignored=0;
  for (const day of json.cardapios) {
    if (!day || !Array.isArray(day.refeicoes)) fail('Entrada cardapios[] sem refeicoes[]');
    // Quando a fonte trouxer um campo de data reconhecível, exigir correspondência exata.
    for(const field of ['data','dataCardapio','dataReferencia']) {
      if (day[field] == null) continue;
      const dayDate=parseDate(day[field]);
      if (!dayDate) fail(`Formato de data desconhecido em ${field}`);
      checkedDates++;
      if (dayDate!==iso) fail(`A API retornou ${dayDate}, mas foi solicitada ${iso}`);
    }
    for (const meal of day.refeicoes) {
      const key=mealKey(meal?.tipoRefeicao);
      if (!key) {ignored++;continue;}
      if (!Array.isArray(meal?.pratos)) fail(`Refeição ${key} sem pratos[]`);
      const items=result[key]?.items || [];
      const seen=new Set(items.map(p=>norm(p.name)));
      for (const prato of meal.pratos) {
        const name=cleanDish(prato?.descricaoPrato);
        if (!name) {ignored++;continue;}
        const lowered=norm(name);
        if(seen.has(lowered)) continue;
        seen.add(lowered);
        // Guardar o tipo original evita perder a distinção entre
        // "Prato protéico 1" e "Prato protéico 3" no Firestore.
        // O campo é opcional para compatibilidade com cardápios legados.
        const sourceType = typeof prato?.tipoPrato === 'string'
          ? prato.tipoPrato.trim().slice(0, 120) : '';
        items.push({name,category:categoryKey(sourceType, name), ...(sourceType ? {sourceType} : {})});
      }
      if(items.length) result[key]={items:items.slice(0,40)};
    }
  }
  return {meals:result,meta:{cardapios:json.cardapios.length,checkedDates,ignored,sourceId:String(sourceId)}};
}
