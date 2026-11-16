/**
 * Pré-carregamento oportunista dos cardápios públicos.
 * Não grava no Firestore, não transmite IP/identidade e não cria filas remotas.
 *
 * Prioridade: usuário escolheu RU/data > próximas datas do mesmo RU >
 * demais fontes na data escolhida > primeiras datas dessas fontes.
 * Saúde e Direito são a mesma fonte (id=2) e nunca devem duplicar requisições.
 */
import {sourceForRu, validISO} from './fump-live.js';

export const PREFETCH_LIMIT_PER_DAY = 12;
export const PREFETCH_MIN_GAP_MS = 850;
export const PREFETCH_TTL_MS = Object.freeze({
  VALID_MENU: 45 * 60_000,
  NOT_PUBLISHED: 20 * 60_000,
  FETCH_ERROR: 10 * 60_000,
  PARSE_ERROR: 60 * 60_000,
});

export function nextIso(iso, n) {
  if (!validISO(iso) || !Number.isInteger(n) || n < 0 || n > 14) throw new Error('PREFETCH_DATE_INVALID');
  const date = new Date(iso + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0,10);
}

/**
 * O plano é limitado por fonte/dia e pelo fim do calendário visível.
 * Nunca supõe que menu vazio é fechamento; a tentativa futura será reavaliada.
 */
export function buildPrefetchPlan(selectedRu, iso, {
  maxDate = nextIso(iso, 14),
  futureDays = 5,
  otherFutureDays = 2,
  limit = PREFETCH_LIMIT_PER_DAY,
} = {}) {
  const selectedSource = sourceForRu(selectedRu);
  if (!selectedSource || !validISO(iso) || !validISO(maxDate) || maxDate < iso) return [];
  if (![futureDays, otherFutureDays, limit].every(Number.isInteger)) return [];
  if (futureDays < 0 || otherFutureDays < 0 || limit < 0) return [];
  const others = ['setorial-i','setorial-ii','saude','ica']
    .filter(ru => sourceForRu(ru) !== selectedSource);
  const result = [];
  const seen = new Set([iso+'|'+selectedSource]);
  function add(ruId, date) {
    if (date > maxDate || result.length >= limit) return;
    const source = sourceForRu(ruId);
    const key = date+'|'+source;
    if (!source || seen.has(key)) return;
    seen.add(key);
    result.push({ruId,iso:date,sourceId:source,key});
  }
  for (let n=1; n<=futureDays && result.length<limit; n++) {
    const date = nextIso(iso,n);
    if (date > maxDate) break;
    add(selectedRu,date);
  }
  for (const ru of others) add(ru,iso);
  for (let n=1; n<=otherFutureDays && result.length<limit; n++) {
    const date = nextIso(iso,n);
    if (date > maxDate) break;
    for (const ru of others) add(ru,date);
  }
  return result;
}

export function canRunBackgroundFetch({online=true, visible=true, connection=null} = {}) {
  if (!online || !visible || connection?.saveData === true) return false;
  if (['slow-2g','2g'].includes(connection?.effectiveType)) return false;
  return true;
}

/**
 * Com prova de consulta já registrada, evita requisições repetidas entre abas e
 * visitas. TTLs se referem à coleta (não a validade do prato).
 */
export function recentlyChecked(check, nowMs=Date.now()) {
  if (!check || !Object.hasOwn(PREFETCH_TTL_MS,check.status)) return false;
  const at=Number(check.at);
  const age=nowMs-at;
  return Number.isFinite(at) && at>0 && age>=0 && age<PREFETCH_TTL_MS[check.status];
}
