/**
 * Consolida cardápios sem confundir uma coleta incompleta com remoção oficial.
 *
 * verifiedCompleteDates é emitido SOMENTE pelo gate da API após conferir as
 * quatro fontes oficiais de cada data. Nessas datas, o resultado recebido é
 * autoritativo: refeições/estabelecimentos ausentes deixam de ser publicados.
 * Para entradas legadas sem essa prova, prevalece a estratégia conservadora,
 * que nunca remove uma refeição simplesmente por não tê-la encontrado.
 */
const RU_IDS = new Set(['setorial-i', 'setorial-ii', 'saude', 'direito', 'ica']);
const MEAL_IDS = new Set(['almoco', 'jantar', 'cafe']);
const CATEGORIES = new Set(['acompanhamento', 'bebida', 'guarnicao', 'molho', 'proteina', 'salada', 'sobremesa', 'vegetariana']);
const normalizeDish = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ');

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function validTime(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function cleanRestaurant(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const meals = {};
  for (const [key, meal] of Object.entries(candidate.meals || {})) {
    if (!MEAL_IDS.has(key)) throw new Error(`Tipo de refeição desconhecido: ${key}`);
    if (!meal || !Array.isArray(meal.items) || !meal.items.length || !validTime(meal.fetchedAt)) {
      throw new Error(`Refeição inválida: ${key}`);
    }
    meals[key] = { items: meal.items, fetchedAt: meal.fetchedAt };
  }
  if (!Object.keys(meals).length) return null;
  const out = {meals, fetchedAt: candidate.fetchedAt || Object.values(meals).map(m => m.fetchedAt).sort().at(-1)};
  if (candidate.sourceRestaurantId != null) out.sourceRestaurantId = String(candidate.sourceRestaurantId);
  return out;
}

function rememberedCategories(previous) {
  const memory = new Map();
  const dates = Object.keys(previous?.days || {}).sort((a, b) => b.localeCompare(a));
  for (const date of dates) {
    for (const restaurant of Object.values(previous.days[date]?.restaurants || {})) {
      for (const meal of Object.values(restaurant?.meals || {})) {
        for (const item of meal?.items || []) {
          const name = normalizeDish(item?.name);
          const category = String(item?.category || '').trim();
          if (name && CATEGORIES.has(category) && !memory.has(name)) memory.set(name, category);
        }
      }
    }
  }
  return memory;
}

function restoreRememberedCategories(candidate, memory) {
  if (!candidate?.meals || !memory.size) return candidate;
  const meals = Object.fromEntries(Object.entries(candidate.meals).map(([key, meal]) => [key, {
    ...meal,
    items: (meal?.items || []).map(item => {
      if (!item || String(item.category || '').trim()) return item;
      const category = memory.get(normalizeDish(item.name));
      return category ? {...item, category} : item;
    }),
  }]));
  return {...candidate, meals};
}

export function mergeSnapshots(previous, incoming, now = new Date()) {
  if (incoming?.schemaVersion !== 1 || !validTime(incoming?.generatedAt) ||
      !incoming.days || typeof incoming.days !== 'object' || Array.isArray(incoming.days)) {
    throw new Error('Snapshot entrante ausente ou fora do esquema');
  }
  const old = previous?.schemaVersion === 1 && previous.days && typeof previous.days === 'object'
    ? previous : {days:{}};
  const verified = incoming.verifiedCompleteDates || [];
  if (!Array.isArray(verified) || verified.some(d => !validDate(d) || !Object.prototype.hasOwnProperty.call(incoming.days, d)) ||
      new Set(verified).size !== verified.length) {
    throw new Error('Lista de datas verificadas inválida');
  }
  const authoritative = new Set(verified);
  const categoryMemory = rememberedCategories(old);
  const merged = {schemaVersion:1, generatedAt:incoming.generatedAt, source:incoming.source, days:{}};
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(now).map(p=>[p.type,p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const shift = days => {const d=new Date(`${today}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  const earliest=shift(-7), latest=shift(10);

  for (const date of new Set([...Object.keys(old.days),...Object.keys(incoming.days)])) {
    if (!validDate(date) || date < earliest || date > latest) continue;
    const base=old.days[date]?.restaurants || {};
    const next=incoming.days[date]?.restaurants || {};
    const restaurants={};

    if (authoritative.has(date)) {
      // A fonte foi consultada completamente. A ausência é uma remoção real,
      // não uma falha de rede. Não reincorporar refeições obsoletas do banco.
      for (const [id, candidate] of Object.entries(next)) {
        if (!RU_IDS.has(id)) throw new Error(`RU desconhecido: ${id}`);
        const clean = cleanRestaurant(restoreRememberedCategories(candidate, categoryMemory));
        if (clean) restaurants[id] = clean;
      }
    } else {
      // Compatibilidade conservadora para snapshots não completos.
      for (const id of new Set([...Object.keys(base),...Object.keys(next)])) {
        if (!RU_IDS.has(id)) continue;
        const oldRu=base[id] || {}, newRu=next[id] || {};
        const meals={};
        for (const key of new Set([...Object.keys(oldRu.meals || {}),...Object.keys(newRu.meals || {})])) {
          if (!MEAL_IDS.has(key)) continue;
          const candidate=restoreRememberedCategories({meals:{[key]:newRu.meals?.[key]}}, categoryMemory).meals[key], oldMeal=oldRu.meals?.[key];
          const chosen=(candidate?.items?.length && (!oldMeal?.fetchedAt || !candidate.fetchedAt || Date.parse(candidate.fetchedAt)>=Date.parse(oldMeal.fetchedAt))) ? candidate : oldMeal;
          if (chosen?.items?.length) meals[key]=chosen;
        }
        if (Object.keys(meals).length) {
          const fetchedAt=Object.values(meals).map(m=>m.fetchedAt).filter(Boolean).sort().at(-1) || newRu.fetchedAt || oldRu.fetchedAt;
          restaurants[id]={meals, fetchedAt};
          if (newRu.sourceRestaurantId || oldRu.sourceRestaurantId) restaurants[id].sourceRestaurantId=String(newRu.sourceRestaurantId || oldRu.sourceRestaurantId);
        }
      }
    }
    // Uma data comprovadamente sem refeições deve desaparecer do JSON.
    if (Object.keys(restaurants).length) merged.days[date]={restaurants};
  }
  return merged;
}
