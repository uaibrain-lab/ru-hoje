/**
 * Estado de uma janela temporária de monitoramento.
 * Fora da janela é uma condição esperada: não coleta, não escreve estado e não falha o workflow.
 */
function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function monitorWindowState({today, windowStart, windowDays}) {
  if (!validIsoDate(today)) throw new Error('MONITOR_TODAY_INVALID');
  if (!validIsoDate(windowStart)) throw new Error('MONITOR_WINDOW_START_INVALID');
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 31) {
    throw new Error('MONITOR_WINDOW_DAYS_INVALID');
  }
  const end = new Date(`${windowStart}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + windowDays - 1);
  const cutoff = end.toISOString().slice(0, 10);
  if (today < windowStart) return {active:false, reason:'BEFORE_WINDOW', today, windowStart, cutoff};
  if (today > cutoff) return {active:false, reason:'WINDOW_CLOSED', today, windowStart, cutoff};
  return {active:true, reason:null, today, windowStart, cutoff};
}
