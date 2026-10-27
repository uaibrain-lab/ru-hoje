const TZ = 'America/Sao_Paulo';

export const SCHEDULE_TIMEZONE = TZ;
export const OFFICIAL_SOURCES = Object.freeze([
  'https://vet.ufmg.br/fique-de-olho-avisos/nova-data-para-o-cafe-da-manha-e-jantar-mudarem-de-restaurante-no-campus-pampulha/',
  'https://www.ufmg.br/comunicacao/noticias/servicos/restaurante-setorial-ii-vai-ampliar-capacidade-de-atendimento-no-almoco/'
]);

export const MEAL_WINDOWS = Object.freeze({
  weekdays: Object.freeze({
    cafe: Object.freeze({start: '06:40', restaurants: ['setorial-i']}),
    almoco: Object.freeze({start: '10:30', restaurants: ['setorial-i', 'setorial-ii']}),
    jantar: Object.freeze({start: '17:10', restaurants: ['setorial-ii']})
  }),
  saturday: Object.freeze({
    almoco: Object.freeze({start: '11:00', restaurants: ['setorial-i']})
  }),
  sunday: Object.freeze({})
});

export const PROPOSED_WINDOWS = Object.freeze([
  Object.freeze({weekdays: [1, 2, 3, 4, 5], hour: 5, minute: 40, reason: 'antes do café'}),
  Object.freeze({weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 30, reason: 'antes do almoço'}),
  Object.freeze({weekdays: [1, 2, 3, 4, 5], hour: 16, minute: 10, reason: 'antes do jantar'}),
  Object.freeze({weekdays: [6], hour: 10, minute: 0, reason: 'antes do almoço de sábado'})
]);

export const RETRY_POLICY = Object.freeze({maxAttempts: 3, backoffMs: [600, 1800], readOnlyOnly: true, retryWrites: false});

const errorCode = e => String(e?.code || e?.name || e?.message || '').toUpperCase();
export function isTransientReadError(error) {
  const code = errorCode(error);
  return ['TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'HTTP_408', 'HTTP_429', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504'].some(x => code.includes(x));
}

export function retryDecision({attempt, error}) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('TENTATIVA_INVALIDA');
  return {retry: attempt < RETRY_POLICY.maxAttempts && RETRY_POLICY.readOnlyOnly && isTransientReadError(error), delayMs: RETRY_POLICY.backoffMs[Math.min(attempt - 1, RETRY_POLICY.backoffMs.length - 1)] || 0};
}

export function weekdayInBrasilia(date = new Date()) {
  const day = new Intl.DateTimeFormat('en-US', {timeZone: TZ, weekday: 'short'}).format(date);
  return {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6}[day];
}

export function proposedWindowsFor(date = new Date()) {
  const weekday = weekdayInBrasilia(date);
  return PROPOSED_WINDOWS.filter(w => w.weekdays.includes(weekday)).map(w => ({...w, timezone: TZ}));
}

export function classifyFreshness({generatedAt, updateTime, today, availableDates = [], now = new Date(), maxAgeHours = 8}) {
  const generated = Date.parse(generatedAt || '');
  const updated = Date.parse(updateTime || '');
  if (!Number.isFinite(generated)) return 'FONTE_TEMPORARIAMENTE_INDISPONIVEL';
  if (generated > now.getTime() + 5 * 60 * 1000) return 'DOCUMENTO_QA_DESATUALIZADO';
  if (Number.isFinite(updated) && updated > now.getTime() + 5 * 60 * 1000) return 'DOCUMENTO_QA_DESATUALIZADO';
  if (now.getTime() - generated > maxAgeHours * 3600000 && !availableDates.includes(today)) return 'DOCUMENTO_QA_DESATUALIZADO';
  if (!availableDates.includes(today)) return 'FUMP_SEM_CARDAPIO_NOVO';
  if (!Number.isFinite(updated)) return 'FALHA_DE_PUBLICACAO';
  return 'OK';
}

export function compareContent({feedFingerprint, publicFingerprint}) {
  if (feedFingerprint == null || publicFingerprint == null) return 'FONTE_TEMPORARIAMENTE_INDISPONIVEL';
  return feedFingerprint === publicFingerprint ? 'SEM_ALTERACOES' : 'OK';
}

export function summarize({event = 'workflow_dispatch', mode = 'simulation', status = 'OK', plannedWrites = 0, remoteWrites = 0, generatedAt = null, updateTime = null, dates = []}) {
  return {timezone: TZ, event, mode, status, plannedWrites, remoteWrites, generatedAt, updateTime, dates: [...dates].sort()};
}

export function futureScheduleContract() {
  return {timezone: TZ, enabled: false, trigger: 'schedule', writeEnabled: false, identity: 'ocupa-qa-cardapios-scheduler', workflow: 'ocupa-qa-cardapios-schedule.yml', concurrency: {group: 'ocupa-qa-cardapios-schedule', cancelInProgress: false}};
}
