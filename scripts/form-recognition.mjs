/** Reconhecimento das opções oficiais de RU, sem confundir Setorial I/II. */
export const RU_LIST = Object.freeze(['setorial-i','setorial-ii','saude','direito','ica']);
export const normalize = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();

export function matchRU(label,id) {
  const s=normalize(label);
  const group=/\bsetorial\s*(?:i|1)\s*(?:e|\/|\+|,)\s*(?:ii|2)\b/.test(s);
  if (id === 'setorial-ii') return /\bsetorial\s*(?:ii|2)\b/.test(s) && !group;
  if (id === 'setorial-i') return /\bsetorial\s*(?:i|1)\b/.test(s) && !group;
  if (id === 'saude') return /\bsaude\b/.test(s);
  if (id === 'direito') return /\bdireito\b/.test(s);
  if (id === 'ica') return /\bica\b|montes claros/.test(s);
  return false;
}

export function matchingOptions(options,id) {
  if (!RU_LIST.includes(id)) throw new Error(`RU inválido: ${id}`);
  return options.filter(o=>o && !o.disabled && String(o.value ?? '') && matchRU(o.label??o.text,id));
}

export function mealOption(s, meal) {
  const n=normalize(s);
  if (meal === 'almoco') return /\balmoco\b/.test(n);
  if (meal === 'jantar') return /\bjantar\b/.test(n);
  return false;
}
