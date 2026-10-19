// Extrator conservador de pratos: não converte texto de navegação em cardápio.
export const RESTAURANTS = [
  { id:'setorial-i', patterns:[/setorial\s*(?:1|i)\b(?!\s*(?:e|\/|,|\+))/,/restaurante\s*1\b/] },
  { id:'setorial-ii', patterns:[/setorial\s*(?:2|ii)\b/,/restaurante\s*2\b/] },
  { id:'saude', patterns:[/sa[uú]de/] },
  { id:'direito', patterns:[/direito/] },
  { id:'ica', patterns:[/\bica\b/,/montes\s*claros/] },
];
export const MEALS = { almoco:/\balmo[çc]o\b/i, jantar:/\bjantar\b/i, cafe:/caf[eé]\s*da\s*manh[aã]/i };
export function norm(s) { return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim(); }
export function inferMealOption(text) {
  const t = norm(text);
  if (/almo[cç]o/.test(t)) return 'almoco';
  if (/jantar/.test(t)) return 'jantar';
  if (/caf[eé]|desjejum/.test(t)) return 'cafe';
  return null;
}
export function identifyRestaurant(text) {
  const t = norm(text);
  const ids = RESTAURANTS.filter(r=>r.patterns.some(regex=>regex.test(t))).map(r=>r.id);
  // Opções agrupadas ("Saúde e Direito") são explicitamente publicadas para as duas unidades.
  if (ids.includes('saude') && ids.includes('direito')) return ['saude','direito'];
  // Nunca confundir "Setorial I e II" com "Setorial I".
  if (/setorial\s*(i|1)\s*(e|\/|\+|,)\s*(ii|2)\b/.test(t)) return ['setorial-i','setorial-ii'];
  return ids.length === 1 ? ids : [];
}
function clean(line) {
  return String(line ?? '').replace(/[•·\u2022]/g,' ').replace(/\s+/g,' ').replace(/^[\-–—*\d.)\s]+(?=[A-Za-zÀ-ÿ])/, '').trim();
}
const IGNORE = [
  /^(observa[çc][aã]o|aten[çc][aã]o|card[aá]pio sujeito|o card[aá]pio pode|a fump|restaurante|fonte|data|data:|escolha|selecione|consultar|voltar|buscar|in[ií]cio|fale com|d[uú]vidas|institucional|programas|not[ií]cias|transpar[eê]ncia|endere[çc]o|atendimento|realiza[çc][aã]o|enviar|copyright|©|termos|pol[ií]tica|mapa do site|mais informa[çc][oõ]es|veja mais)/i,
  /^(prato prot[eé]ico|guarni[çc][aã]o|acompanhamento|entrada|sobremesa|refresco|saladas|protei[nn]a)$/i,
  /(RUs? da UFMG|Assist[eê]ncia Estudantil|Whatsapp|\bCEP\b|\bCNPJ\b|fump\.ufmg)/i,
];
const STOP = /^(observa[çc][aã]o\s*:|aten[çc][aã]o\s*:|card[aá]pio sujeito|realiza[çc][aã]o|©|todos os direitos reservados)/i;
function belongsAsDish(line) {
  if (!line || line.length < 3 || line.length > 200) return false;
  if (IGNORE.some(regex=>regex.test(line))) return false;
  if (/https?:|www\.|\b\d{2}\.\d{2}\.\d{4}\b|\b(19|20)\d{2}\b/.test(line)) return false;
  if (!/[a-zà-ÿ]{3,}/i.test(line)) return false;
  if (/(almo[çc]o|jantar|caf[eé] da manh[aã])\s*(?:das|de|\d)/i.test(line) && line.length < 48) return false;
  return true;
}
function categoryFromDish(line) {
  const c = (line.match(/\(([^()]*(?:prato prot[eé]ico|guarni[çc][aã]o|acompanhamento|entrada|sobremesa|refresco)[^()]*)\)/i) ||
    line.match(/\[([^\]]*(?:sobremesa|refresco)[^\]]*)\]/i) || [])[1] || '';
  if (/prato prot[eé]ico\s*3|vegetarian|vegano/i.test(line)) return 'vegetariana';
  if (/prato prot[eé]ico|prato principal/i.test(c)) return 'proteina';
  if (/guarni/i.test(c)) return 'guarnicao';
  if (/acompanhamento/i.test(c)) return 'acompanhamento';
  if (/entrada/i.test(c)) return 'salada';
  if (/sobremesa/i.test(c)) return 'sobremesa';
  if (/refresco/i.test(c)) return 'bebida';
  if (/salada/i.test(line)) return 'salada';
  if (/^(arroz|feij[aã]o)\b/i.test(line)) return 'acompanhamento';
  return '';
}
function mealHeading(line) {
  const t = norm(line).replace(/[:\-–—]+$/,'').trim();
  if (t === 'almoco' || t === 'almoço') return 'almoco';
  if (t === 'jantar') return 'jantar';
  if (t === 'cafe da manha' || t === 'desjejum') return 'cafe';
  return null;
}
function likelyMenu(lines) {
  // Refeições reais quase sempre contêm ao menos quatro itens, entre eles acompanhantes.
  const markers = lines.filter(l=> /(arroz|feij[aã]o|salada|guarni[çc][aã]o|sobremesa|prato prot[eé]ico|refresco|suco|vegetarian)/i.test(l.name)).length;
  return lines.length >= 4 && (markers >= 2 || lines.length >= 8);
}
export function extractMenus(text, forcedMeal = null) {
  if (typeof text !== 'string') return {};
  const rawLines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const result = {};
  let current = forcedMeal;
  let entries = [];
  let stopped = false;
  const flush = () => {
    if (current && likelyMenu(entries) && !result[current]) result[current] = { items:entries.slice(0,32) };
    entries = [];
  };
  for (const line of rawLines) {
    const heading = mealHeading(line);
    if (heading) { flush();current=heading;stopped=false;continue; }
    if (!current) continue;
    if (STOP.test(line)) {flush();current=null;stopped=true;continue;}
    if (/^card[aá]pio do dia$/i.test(line)) {flush();current=forcedMeal;continue;}
    if (belongsAsDish(line)) {
      const cleanedName = line.replace(/\s*\((?:prato prot[eé]ico|guarni[çc][aã]o|acompanhamento|entrada|sobremesa|refresco)[^)]*\)/gi,'').replace(/\s*\[(?:sobremesa|refresco)[^\]]*\]/gi,'').trim();
      if (cleanedName && !entries.some(x=>x.name===cleanedName)) entries.push({name:cleanedName,category:categoryFromDish(line)});
    }
    if (entries.length > 35) {flush();current=null;}
  }
  if (!stopped || entries.length) flush();
  return result;
}
export function mergeMenus(target, incoming) {
  for (const [name,meal] of Object.entries(incoming)) {
    if (!MEALS[name] || !Array.isArray(meal.items) || !likelyMenu(meal.items)) continue;
    if (!target[name] || target[name].items.length < meal.items.length) target[name] = meal;
  }
  return target;
}
