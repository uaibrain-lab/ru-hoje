/** Parser compartilhado entre a coleta Node e a consulta ao vivo do navegador.
 * A origem é a API JSON da FUMP. Este módulo não efetua operações de rede.
 */
import {categoryFromSourceType} from './dish-category.js';
const ALLOWED_SOURCE_IDS = new Set(['1','2','5','6']);
const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const fail = message => {throw new Error(message);};
function assertIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Data inválida (esperado YYYY-MM-DD)');
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) fail('Data inexistente');
  return value;
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
  if (!ALLOWED_SOURCE_IDS.has(String(sourceId))) fail('Fonte desconhecida');
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
