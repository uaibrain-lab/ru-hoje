// OCUPA_RU_P3_CLIENT_FIX
import {currentOpening, weeklySummary} from './hours.js';
import {publishedCategory} from './dish-category.js';
import {needsMenuDot, dateChipLabel} from './date-availability.js';
import {readLiveMenu, sourceForRu, isValidLiveEntry, validISO} from './fump-live.js';
import {buildPrefetchPlan, canRunBackgroundFetch, recentlyChecked, PREFETCH_LIMIT_PER_DAY, PREFETCH_MIN_GAP_MS} from './fump-prefetch.js';
const SOURCE_URL = 'https://fump.ufmg.br/cardapio-do-dia/';
const STORAGE_RU = 'ruhoje:restaurant:v1';
const STORAGE_PREFERS_CAFE = 'ruhoje:prefers-cafe:v1';
const STORAGE_DATA = 'ruhoje:menus:v1';
const STORAGE_LIVE = 'ruhoje:live-menus:v1';
const STORAGE_PREFETCH = 'ruhoje:prefetch-checks:v2';
const TIMEZONE = 'America/Sao_Paulo';
const INGREDIENT_CATALOG_URL = '/data/pratos-ingredientes.json';
const RU_LIST = [
  { id: 'setorial-i', photo: '/assets/restaurantes/setorial-i.webp', name: 'RU Setorial I', region: 'Campus Pampulha', meals: ['cafe', 'almoco'], saturday:true },
  { id: 'setorial-ii', photo: '/assets/restaurantes/setorial-ii.webp', name: 'RU Setorial II', region: 'Campus Pampulha', meals: ['almoco', 'jantar'] },
  { id: 'saude', photo: '/assets/restaurantes/saude.webp', name: 'RU Saúde', region: 'Campus Saúde', meals: ['cafe', 'almoco', 'jantar'], saturday:true },
  { id: 'direito', photo: '/assets/restaurantes/direito.webp', name: 'RU Direito', region: 'Faculdade de Direito', meals: ['cafe', 'almoco', 'jantar'] },
  { id: 'ica', photo: '/assets/restaurantes/ica.webp', name: 'RU ICA', region: 'Montes Claros', meals: ['cafe', 'almoco', 'jantar'], saturday:true },
];
const MEAL_INFO = {
  almoco: { title: 'Almoço', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>' },
  jantar: { title: 'Jantar', icon: '<path d="M20.5 14.4A8.4 8.4 0 0 1 9.6 3.5 8.4 8.4 0 1 0 20.5 14.4Z"/>' },
  cafe: { title: 'Café da manhã', icon: '<path d="M4 9h12v5a6 6 0 0 1-12 0V9Zm12 1h2a3 3 0 0 1 0 6h-3M3 21h15M7 3v3m5-3v3"/>' },
};
const GROUP_ORDER = ['Pratos principais','Opção vegetariana','Guarnições','Acompanhamentos','Saladas','Molhos','Sobremesas','Bebidas','Outros'];
const GROUP_ICONS = Object.freeze({
  'Pratos principais':'🍖','Opção vegetariana':'🌱','Guarnições':'🍲',
  'Acompanhamentos':'🍚','Saladas':'🥗','Molhos':'🥣','Sobremesas':'🍮','Bebidas':'🥤','Outros':'🍽️'
});
const $ = (id) => document.getElementById(id);
const state = { selectedRu: null, selectedDate: null, data: null, ingredientCatalog: null, ingredientCatalogPromise: null, lastError: null, fallbackUsed: false, syncing: false, initialOpen: false, snapshotSource:'cache', liveMenus: new Map(), liveStatus: new Map(), liveChecks: new Map(), livePending: new Map(), prefetchChecks: new Map(), prefetchQuota: {date:'',count:0}, prefetchGeneration: 0, prefetchActiveKey: null };

function readStore(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStore(key, value) { try { localStorage.setItem(key, value); } catch {} }
function sPauloParts(date = new Date()) {
  const out = {};
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)) out[part.type] = part.value;
  return { iso: `${out.year}-${out.month}-${out.day}`, hours: Number(out.hour), minutes: Number(out.minute) };
}
function addDays(iso, delta) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function dayDate(iso) { return new Date(`${iso}T12:00:00Z`); }
function isDataValid(data) {
  return !!(data && data.schemaVersion === 1 && data.days && typeof data.days === 'object' && !Array.isArray(data.days));
}
function stripDangerous(value) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240); }
function friendlyDate(iso, options) { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...options }).format(dayDate(iso)); }
function liveKey(date, ruId) {return date + '|' + (sourceForRu(ruId) || 'invalid');}
function liveMenuFor(date, ruId) {
  const entry = state.liveMenus.get(liveKey(date,ruId));
  return isValidLiveEntry(entry,date,ruId) ? entry : null;
}
function menuFor(date, ruId) { return liveMenuFor(date,ruId) || state.data?.days?.[date]?.restaurants?.[ruId] || null; }
/**
 * O marcador sinaliza data com serviço regular, porém sem cardápio carregado.
 * Uma falha de rede não o oculta; ele some quando os pratos são validados.
 */
function missingMenuForDate(iso,ruId) {
  return needsMenuDot(state.data,iso,ruId,!!liveMenuFor(iso,ruId));
}
function hydrateLiveMenus() {
  try {
    const stored = JSON.parse(readStore(STORAGE_LIVE) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
    const first = addDays(sPauloParts().iso,-1);
    const last = addDays(sPauloParts().iso,14);
    for (const [key,value] of Object.entries(stored).slice(0,50)) {
      const [iso,sourceId] = key.split('|');
      if (!iso || iso < first || iso > last) continue;
      const ru = RU_LIST.find(r => sourceForRu(r.id) === sourceId);
      if (ru && isValidLiveEntry(value,iso,ru.id)) state.liveMenus.set(key,value);
    }
  } catch { /* armazenamento local pode estar bloqueado ou conter dados legados */ }
}
function persistLiveMenus() {
  const today = sPauloParts().iso;
  const earliest = addDays(today,-1), latest = addDays(today,14);
  const entries = [...state.liveMenus.entries()]
    .filter(([key,value]) => {
      const [iso,sourceId] = key.split('|');
      const ru = RU_LIST.find(r => sourceForRu(r.id) === sourceId);
      return iso >= earliest && iso <= latest && ru && isValidLiveEntry(value,iso,ru.id);
    }).slice(-36);
  writeStore(STORAGE_LIVE,JSON.stringify(Object.fromEntries(entries)));
}
function prefetchAllowed() {
  return canRunBackgroundFetch({
    online:navigator.onLine,
    visible:!document.hidden,
    connection:navigator.connection || null
  });
}
function persistPrefetchMeta() {
  const first = addDays(sPauloParts().iso,-1);
  const last = addDays(sPauloParts().iso,14);
  const checks = [...state.prefetchChecks.entries()]
    .filter(([key,value]) => {
      const day = key.split('|')[0];
      return day>=first && day<=last && Number.isFinite(value?.at);
    }).slice(-72);
  writeStore(STORAGE_PREFETCH, JSON.stringify({
    checks:Object.fromEntries(checks),
    quota:state.prefetchQuota
  }));
}
function hydratePrefetchMeta() {
  try {
    const raw = JSON.parse(readStore(STORAGE_PREFETCH) || 'null');
    if (!raw || typeof raw!=='object' || !raw.checks || typeof raw.checks!=='object') return;
    for (const [key,value] of Object.entries(raw.checks).slice(-72)) {
      if (key.length===12 && key[10]==='|' && validISO(key.slice(0,10)) && ['1','2','5','6'].includes(key.slice(11)) &&
          typeof value?.status === 'string' && Number.isFinite(value.at)) {
        state.prefetchChecks.set(key,{at:value.at,status:value.status});
      }
    }
    if (raw.quota?.date===sPauloParts().iso && Number.isInteger(raw.quota.count)) {
      const localCount=state.prefetchQuota.date===raw.quota.date ? state.prefetchQuota.count : 0;
      state.prefetchQuota={date:raw.quota.date,count:Math.max(0,localCount,raw.quota.count)};
    }
  } catch { /* cache opcional e sem permissões especiais */ }
}
function recordPrefetchCheck(key,status) {
  state.prefetchChecks.set(key,{status,at:Date.now()});
  persistPrefetchMeta();
}
function cancelPrefetch() {
  state.prefetchGeneration++;
  state.prefetchActiveKey=null;
}
function startPrefetch(ruId,iso) {
  if (!ruId || !prefetchAllowed()) return;
  const activeKey=liveKey(iso,ruId);
  // A consulta de hoje pode terminar enquanto a varredura já está em curso.
  // Não reiniciar a fila: isso cancelava o primeiro dia futuro antes da busca.
  if (state.prefetchActiveKey===activeKey) return;
  const plan=buildPrefetchPlan(ruId,iso,{
    maxDate:addDays(sPauloParts().iso,14),
    limit:PREFETCH_LIMIT_PER_DAY
  });
  if (!plan.length) return;
  const generation=++state.prefetchGeneration;
  state.prefetchActiveKey=activeKey;
  const stillActive=()=>generation===state.prefetchGeneration && prefetchAllowed()
    && state.selectedRu===ruId && state.selectedDate===iso;
  // Começa independentemente do sucesso da consulta da data selecionada.
  // Uma data futura indisponível não impede consultar as seguintes.
  void (async()=>{
    let consecutiveFailures=0;
    for (const task of plan) {
      if (!stillActive()) break;
      const previous=state.prefetchChecks.get(task.key);
      if (recentlyChecked(previous) &&
          (previous.status!=='VALID_MENU' || liveMenuFor(task.iso,task.ruId))) continue;
      if (state.livePending.has(task.key)) continue;
      const today=sPauloParts().iso;
      if (state.prefetchQuota.date!==today) state.prefetchQuota={date:today,count:0};
      if (state.prefetchQuota.count>=PREFETCH_LIMIT_PER_DAY) break;
      await new Promise(resolve=>setTimeout(resolve,PREFETCH_MIN_GAP_MS));
      if (!stillActive()) break;
      if (state.livePending.has(task.key)) continue;
      // Apenas background consome orçamento; o usuário pode consultar manualmente.
      state.prefetchQuota.count++;
      persistPrefetchMeta();
      const result=await refreshLive({
        ruId:task.ruId,iso:task.iso,force:true,background:true
      });
      if (!result || result.status==='FETCH_ERROR') {
        consecutiveFailures++;
        // Evitar bombardear a origem quando toda a região está indisponível.
        if (consecutiveFailures>=3) break;
        continue;
      }
      if (result.status==='PARSE_ERROR') break;
      consecutiveFailures=0;
    }
  })().catch(error=>console.warn('Pré-carregamento FUMP pausado:',error?.name || 'ERROR'))
    .finally(()=>{
      if (generation===state.prefetchGeneration) state.prefetchActiveKey=null;
    });
}
async function refreshLive({force = false, ruId = state.selectedRu, iso = state.selectedDate || sPauloParts().iso, background = false} = {}) {
  if (!ruId || !navigator.onLine || (background && !prefetchAllowed())) return null;
  const key = liveKey(iso,ruId);
  const now = Date.now();
  if (state.livePending.has(key)) return state.livePending.get(key);
  // Tentativas de background e o clock a cada minuto respeitam cooldown,
  // inclusive HTTP 503. Interação explícita passa force:true.
  if (!force && now-(state.liveChecks.get(key) || 0) < 4*60_000) return {status:'SKIPPED'};
  state.liveChecks.set(key,now);
  const proxyUrl=window.RU_CONFIG?.fumpProxyUrl || '';
  const task = readLiveMenu(ruId,iso, background
    ? {maxAttempts:1,timeoutMs:12000,proxyUrl}
    : {maxAttempts:proxyUrl ? 2 : 1,proxyUrl}).then(result => {
    recordPrefetchCheck(key,result.status);
    state.liveStatus.set(key,{status:result.status,at:new Date().toISOString(),cacheStatus:result.cacheStatus||'',error:result.error || null});
    if (result.status === 'VALID_MENU') {
      // Apenas dados positivos e validados podem alterar o que aparece.
      const payload = {iso,ruId,meals:result.meals,sourceRestaurantId:result.sourceId,fetchedAt:result.fetchedAt};
      state.liveMenus.set(key,payload);
      persistLiveMenus();
    } else if (result.status === 'PARSE_ERROR') {
      console.warn('Cardápio FUMP não reconhecido; preservando contingência', result.error);
    }
    if (sourceForRu(state.selectedRu)===sourceForRu(ruId)) renderDates();
    if (key === liveKey(state.selectedDate || sPauloParts().iso,state.selectedRu)) renderMenus();
    if (!background && ['VALID_MENU','NOT_PUBLISHED'].includes(result.status)
        && state.selectedRu===ruId && state.selectedDate===iso) {
      startPrefetch(ruId,iso);
    }
    return result;
  }).catch(error => {
    state.liveStatus.set(key,{status:'FETCH_ERROR',at:new Date().toISOString()});
    recordPrefetchCheck(key,'FETCH_ERROR');
    console.warn('Falha na consulta direta FUMP; mantendo contingência',error?.name || 'ERROR');
    return {status:'FETCH_ERROR'};
  }).finally(() => state.livePending.delete(key));
  state.livePending.set(key,task);
  return task;
}
function el(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function iconSVG(paths) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`; }
function selectedRu() { return RU_LIST.find(ru => ru.id === state.selectedRu); }
function ingredientKey(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').trim().replace(/[\u2010-\u2015-]/g, ' ').replace(/\s+/g, ' ');
}
async function loadIngredientCatalog() {
  if (state.ingredientCatalog) return state.ingredientCatalog;
  if (state.ingredientCatalogPromise) return state.ingredientCatalogPromise;
  state.ingredientCatalogPromise = getJSON(INGREDIENT_CATALOG_URL).then(payload => {
    const map = new Map();
    if (payload?.schemaVersion === 1 && Array.isArray(payload.dishes)) {
      for (const dish of payload.dishes) {
        const ingredients = Array.isArray(dish?.ingredients)
          ? dish.ingredients.map(item => stripDangerous(item)).filter(Boolean)
          : [];
        if (dish?.name && ingredients.length) map.set(ingredientKey(dish.name), ingredients);
      }
    }
    state.ingredientCatalog = map;
    return map;
  }).catch(error => {
    console.warn('Catálogo de ingredientes indisponível:', error);
    state.ingredientCatalog = new Map();
    return state.ingredientCatalog;
  });
  return state.ingredientCatalogPromise;
}
function ingredientsForDish(name) {
  return state.ingredientCatalog?.get(ingredientKey(name)) || [];
}
function formatIngredientLabel(value) {
  const text = String(value || '').trim().toLocaleLowerCase('pt-BR');
  return text ? text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1) : text;
}
function formatIngredients(ingredients) {
  return ingredients.map(formatIngredientLabel).filter(Boolean).join(' · ');
}

// Guardar as duas referências: o SVG de fallback é retirado fisicamente do DOM
// quando há foto, impedindo que o grid o desenhe em uma segunda linha.
const restaurantThumbHost = document.querySelector('#restaurant-trigger .picker-icon');
const restaurantThumbPhoto = document.getElementById('restaurant-photo');
const restaurantThumbFallback = document.getElementById('restaurant-fallback');

function renderRestaurant() {
  const ru = selectedRu();
  $('current-restaurant').textContent = ru ? ru.name : 'Escolher restaurante';
  $('restaurant-subtitle').textContent = ru ? ru.region : 'Toque para escolher';
  if (ru) {
    restaurantThumbPhoto.src = ru.photo;
    restaurantThumbPhoto.alt = '';
    restaurantThumbPhoto.hidden = false;
    restaurantThumbHost.replaceChildren(restaurantThumbPhoto);
  } else {
    restaurantThumbPhoto.hidden = true;
    restaurantThumbHost.replaceChildren(restaurantThumbFallback);
  }
  renderHours();
  const items = $('restaurant-options');
  items.replaceChildren();
  for (const item of RU_LIST) {
    const button = el('button', 'restaurant-option');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(item.id === state.selectedRu));
    const marker = el('span', 'option-icon restaurant-thumb');
    const photo = el('img', 'restaurant-thumb-img');
    photo.src = item.photo;
    photo.alt = '';
    photo.width = 52;
    photo.height = 52;
    photo.loading = 'lazy';
    photo.decoding = 'async';
    marker.append(photo);
    const copy = el('span', 'option-label');
    copy.append(el('strong', '', item.name), el('small', '', item.region));
    const check = el('span', 'option-check', item.id === state.selectedRu ? '✓' : '');
    check.setAttribute('aria-hidden', 'true');
    button.append(marker, copy, check);
    button.addEventListener('click', () => {
      cancelPrefetch();
      state.selectedRu = item.id;
      writeStore(STORAGE_RU, item.id);
      renderRestaurant();
      renderDates();
      renderMenus();
      refreshLive({force:!liveMenuFor(state.selectedDate || sPauloParts().iso,item.id)});
      startPrefetch(item.id,state.selectedDate || sPauloParts().iso);
      $('restaurant-dialog').close();
      $('restaurant-trigger').focus();
    });
    items.append(button);
  }
}
function renderHours() {
  const root=$('hours-wrap');
  const ru=selectedRu();
  root.hidden=!ru;
  if (!ru) return;
  const status=currentOpening(ru.id);
  $('hours-status').textContent=status.message;
  $('hours-dot').className='hours-dot '+(status.state==='open'?'is-open':'is-closed');
  const list=$('hours-list');list.replaceChildren();
  for(const block of weeklySummary(ru.id)) {
    const row=el('div','hours-row');
    row.append(el('strong','',block.day),el('span','',block.services.join(' · ')||'Não atende'));
    list.append(row);
  }
}
function openDialog() {
  const dialog = $('restaurant-dialog');
  if (!dialog.open) dialog.showModal();
}
function initDialog() {
  const dialog = $('restaurant-dialog');
  $('restaurant-trigger').addEventListener('click', openDialog);
  $('close-dialog').addEventListener('click', () => dialog.close());
  // O primeiro acesso sugere um RU, mas nunca aprisiona a pessoa na janela.
  dialog.addEventListener('cancel', () => {});
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}
function renderDates({ scroll = false } = {}) {
  const today = sPauloParts().iso;
  const dateStrip = $('date-strip');
  const oldScrollLeft = dateStrip.scrollLeft;
  dateStrip.replaceChildren();
  for (let offset = 0; offset < 15; offset++) {
    const iso = addDays(today, offset);
    const date = dayDate(iso);
    const isWeekend = [0, 6].includes(date.getUTCDay());
    const withoutMenu = missingMenuForDate(iso,state.selectedRu);
    const card = el('button', 'date-card');
    card.type = 'button';
    card.dataset.iso = iso;
    card.dataset.weekend = String(isWeekend);
    card.dataset.missingMenu = String(withoutMenu);
    card.setAttribute('aria-pressed', String(iso === state.selectedDate));
    card.setAttribute('aria-label', `${friendlyDate(iso, {weekday:'long',day:'numeric',month:'long'})}${iso === today ? ', hoje' : ''}${withoutMenu ? ', sem cardápio carregado' : ''}`);
    card.append(el('span','weekday',friendlyDate(iso,{weekday:'short'}).replace('.','')),
      el('span','daynum',String(date.getUTCDate()).padStart(2,'0')),
      el('span','daylabel',dateChipLabel(iso === today, withoutMenu)));
    card.addEventListener('click', (event) => {
      cancelPrefetch();
      state.selectedDate = iso;
      renderDates();
      // Focus returns to the new node after re-render (keyboard accessibility).
      if (event?.detail === 0) dateStrip.querySelector(`[data-iso="${iso}"]`)?.focus({preventScroll:true});
      renderMenus();
      refreshLive({force:!liveMenuFor(iso,state.selectedRu)});
      startPrefetch(state.selectedRu,iso);
    });
    dateStrip.append(card);
  }
  $('dates-heading').textContent = friendlyDate(state.selectedDate, {month:'long',year:'numeric'}).replace(/^./, c=>c.toUpperCase());
  $('today-button').hidden = state.selectedDate === today;
  if (scroll) requestAnimationFrame(() => {
    // Hoje deve ser o primeiro cartão visível, não centralizado entre dias anteriores.
    dateStrip.scrollLeft = 0;
  });
  else dateStrip.scrollLeft = oldScrollLeft;
}
function categoryName(raw, name = '') {
  // A FUMP pode enviar itens sem tipo oficial. Nesses casos, usar o nome
  // apenas como fallback evita que molhos conhecidos caiam em “Outros”.
  const t = String(raw || name || '').toLocaleLowerCase('pt-BR');
  if (/(veget|prote[ií]co\s*3|op[çc][aã]o\s*veg)/.test(t)) return 'Opção vegetariana';
  if (/(protei|prato principal|carne|principal)/.test(t)) return 'Pratos principais';
  if (/(guarni|acompanhamento quente)/.test(t)) return 'Guarnições';
  if (/(acompanhamento|arroz|feij[aã]o)/.test(t)) return 'Acompanhamentos';
  if (/(entrada|salada)/.test(t)) return 'Saladas';
  if (/(molho|condimento)/.test(t)) return 'Molhos';
  if (/(sobremesa|fruta)/.test(t)) return 'Sobremesas';
  if (/(refresco|suco|bebida)/.test(t)) return 'Bebidas';
  return 'Outros';
}
function renderMealCard(mealId, payload, isFeatured, ru) {
  const info = MEAL_INFO[mealId];
  const card = el('article', 'meal-card' + (isFeatured ? ' is-featured' : ''));
  const head = el('div','meal-top');
  const titleWrap = el('div','meal-name');
  const ic = el('span','meal-icon');
  ic.innerHTML = iconSVG(info.icon);
  const title = el('div');
  title.append(el('h3', '', info.title), el('div','meal-subtitle',mealId === 'cafe' ? 'Para estudantes com benefício elegível' : ru.region));
  titleWrap.append(ic,title);
  head.append(titleWrap);
  card.append(head);
  const items = Array.isArray(payload?.items) ? payload.items.filter(x => x && (x.name || typeof x === 'string')).slice(0, 36) : [];
  if (!items.length) {
    card.append(el('p','empty-meal','A FUMP ainda não informou os pratos desta refeição.'));
    return card;
  }
  const groups = new Map();
  for (const item of items) {
    const name = stripDangerous(typeof item === 'string' ? item : item.name);
    if (!name || name.length < 2) continue;
    const category = categoryName(typeof item === 'string' ? publishedCategory('', name) : publishedCategory(item.category, name, item.sourceType), name);
    if (!groups.has(category)) groups.set(category, []);
    if (!groups.get(category).includes(name)) groups.get(category).push(name);
  }
  const contents = el('div','meal-contents');
  for (const groupName of GROUP_ORDER) {
    const dishes = groups.get(groupName);
    if (!dishes?.length) continue;
    const group = el('section','menu-group');
    const heading = el('h4','menu-group-title');
    const symbol = el('span','category-emoji',GROUP_ICONS[groupName]);
    symbol.setAttribute('aria-hidden','true');
    heading.append(symbol,document.createTextNode(groupName === 'Outros' ? 'No cardápio' : groupName));
    group.append(heading);
    const list = el('ul','dish-list');
    for (const name of dishes) {
      const ingredients = ingredientsForDish(name);
      const row = el('li','dish-row');
      if (!ingredients.length) {
        row.append(el('span','dish-title',name));
        list.append(row);
        continue;
      }
      const trigger = el('button','dish-trigger');
      trigger.type = 'button';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', `Ver ingredientes de ${name}`);
      const titleNode = el('span','dish-title',name);
      const chevron = el('span','dish-chevron','⌄');
      chevron.setAttribute('aria-hidden','true');
      trigger.append(titleNode, chevron);
      const expansion = el('div','dish-expansion');
      expansion.hidden = true;
      expansion.append(el('h5','miniheading','Ingredientes'), el('p','',formatIngredients(ingredients)));
      trigger.addEventListener('click', () => {
        const willOpen = expansion.hidden;
        expansion.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
        chevron.textContent = willOpen ? '⌃' : '⌄';
      });
      row.append(trigger, expansion);
      list.append(row);
    }
    group.append(list); contents.append(group);
  }
  card.append(contents);
  return card;
}
function renderNoMenu(ru, date) {
  const root = el('div','no-menu');
  const picture = el('div','empty-illustration');
  picture.innerHTML = iconSVG('<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>');
  root.append(picture, el('h3', '', 'Ainda sem cardápio por aqui'));
  const weekDay=dayDate(date).getUTCDay();
  const notUsuallyOpen=weekDay===0 || (weekDay===6 && !ru.saturday);
  root.append(el('p','', notUsuallyOpen
    ? `${ru.name} não tem atendimento regular previsto nessa data. Consulte a FUMP para possíveis exceções.`
    : `Não encontramos pratos confirmados para ${ru.name} em ${friendlyDate(date,{day:'numeric',month:'long'})}. Pode ser que a FUMP ainda não tenha divulgado os dados ou que a atualização tenha falhado.`));
  const link = el('a','source-link','Consultar na FUMP ↗');
  link.href = SOURCE_URL; link.target = '_blank'; link.rel = 'noopener noreferrer';
  root.append(link);
  return root;
}
function formatUpdate(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, dateStyle:'short', timeStyle:'short' }).format(new Date(iso));
}
function renderLastUpdateLine(iso, source = '') {
  const line = $('update-line');
  if (!line) return;
  const formatted = formatUpdate(iso);
  line.textContent = formatted ? `Cardápio consultado: ${formatted}${source ? ' · ' + source : ''}` : '';
}
function renderMenus() {
  const today = sPauloParts();
  const ru = selectedRu();
  const day = state.selectedDate || today.iso;
  $('menu-heading').textContent = day === today.iso ? 'Cardápio de hoje' : `Cardápio de ${friendlyDate(day,{day:'numeric',month:'short'})}`;
  const list = $('meal-list'); list.replaceChildren();
  $('connection-notice').hidden = true;
  const live = liveMenuFor(day,state.selectedRu);
  const data = menuFor(day,state.selectedRu);
  const fallbackUpdate = state.data?.generatedAt || null;
  const selectedKey=liveKey(day,state.selectedRu);
  const liveStatus = state.liveStatus.get(selectedKey);
  // A consulta ao Worker em andamento não deve parecer um erro definitivo.
  const waitingForLive=state.livePending.has(selectedKey) && !liveStatus;
  const sourceLabel = live
    ? (liveStatus?.cacheStatus === 'STALE' ? 'Última resposta oficial em contingência'
      : liveStatus?.status === 'VALID_MENU' ? 'FUMP ao vivo' : 'Última consulta direta válida')
    : state.snapshotSource === 'firestore' ? 'Cópia sincronizada (Firestore)'
    : state.snapshotSource === 'static' ? 'Cópia estática'
    : 'Cópia local';
  if (!ru) {
    const msg = el('div','no-menu');
    msg.append(el('h3','', 'Primeiro, escolha seu RU'), el('p','', 'Salvaremos sua preferência para abrir direto no cardápio das próximas vezes.'));
    list.append(msg); renderLastUpdateLine(null); return;
  }
  if (state.lastError && !live && !waitingForLive && day === today.iso) {
    $('connection-notice').textContent = state.data
      ? 'Não foi possível atualizar agora. Exibindo os últimos dados disponíveis; confira a FUMP antes de sair.'
      : 'Não foi possível consultar o cardápio neste momento. Confira os dados diretamente na FUMP.';
    $('connection-notice').hidden = false;
  } else if (state.fallbackUsed && !live && day === today.iso) {
    $('connection-notice').textContent = 'Dados carregados da cópia estática de contingência; confirme na FUMP antes de sair.';
    $('connection-notice').hidden = false;
  } else if (!navigator.onLine) {
    $('connection-notice').textContent = 'Você está offline. Os dados disponíveis podem estar desatualizados.';
    $('connection-notice').hidden = false;
  }
  if (live && liveStatus?.cacheStatus === 'STALE') {
    $('connection-notice').textContent='A consulta atual está indisponível. Exibindo uma resposta anterior validada da FUMP.';
    $('connection-notice').hidden=false;
  }
  if (day === today.iso && liveStatus && liveStatus.status !== 'VALID_MENU' && !live && data &&
      !state.lastError && !state.fallbackUsed && navigator.onLine) {
    $('connection-notice').textContent = 'Consulta direta indisponível; exibindo a última versão sincronizada.';
    $('connection-notice').hidden = false;
  }
  // Exibir somente refeições efetivamente publicadas pela FUMP. Não criar cartões vazios.
  const entries = ['almoco','jantar','cafe'].filter(m => ru.meals.includes(m) && Array.isArray(data?.meals?.[m]?.items) && data.meals[m].items.length > 0);
  const hasItems = entries.some(m => Array.isArray(data?.meals?.[m]?.items) && data.meals[m].items.length);
  if (!hasItems) {
    // Aguardar resultado ao vivo antes de anunciar erro de atualização.
    if (waitingForLive && navigator.onLine) {
      $('connection-notice').textContent = 'Consultando o cardápio atualizado da FUMP…';
      $('connection-notice').hidden = false;
    } else if (liveStatus?.status === 'FETCH_ERROR') {
      $('connection-notice').textContent = 'Não foi possível ler a API da FUMP neste navegador (rede ou bloqueio CORS). O sincronizador também não forneceu um cardápio válido para este RU/data.';
      $('connection-notice').hidden = false;
    } else if (liveStatus?.status === 'PARSE_ERROR') {
      $('connection-notice').textContent = 'A FUMP respondeu em formato inesperado. Os pratos não foram publicados para evitar informação incorreta.';
      $('connection-notice').hidden = false;
    } else if (liveStatus?.status !== 'NOT_PUBLISHED' &&
               !state.data?.days?.[day]?.restaurants?.[state.selectedRu]) {
      $('connection-notice').textContent = 'Ainda não há cardápio validado neste aplicativo para a data escolhida.';
      $('connection-notice').hidden = false;
    }
    list.append(renderNoMenu(ru,day));
    // Uma atualização antiga do arquivo geral não é a data da consulta deste RU.
    renderLastUpdateLine(data?.fetchedAt || null,data?.fetchedAt ? sourceLabel : '');
    return;
  }
  const hasRealMeal = id => !!data?.meals?.[id]?.items?.length;
  const after1430 = (today.hours*60+today.minutes)>=870;
  const featured = day === today.iso
    ? (after1430 && hasRealMeal('jantar') ? 'jantar' : hasRealMeal('almoco') ? 'almoco' : entries.find(hasRealMeal))
    : null;
  const order = entries.slice().sort((a,b) => Number(b === featured)-Number(a === featured));
  for (const meal of order) list.append(renderMealCard(meal,data?.meals?.[meal],meal === featured,ru));
  const latestMealFetch=Object.values(data?.meals || {}).map(m=>m?.fetchedAt).filter(Boolean).sort().at(-1);
  const updatedAt = latestMealFetch || data?.fetchedAt || fallbackUpdate;
  const ageHours = updatedAt ? (Date.now() - Date.parse(updatedAt))/(1000*60*60) : null;
  if (day === today.iso && ageHours !== null && ageHours > 18) {
    $('connection-notice').textContent = 'A última atualização tem mais de 18 horas. Este cardápio pode estar desatualizado; confirme na FUMP.';
    $('connection-notice').hidden = false;
  }
  renderLastUpdateLine(updatedAt,sourceLabel);
}
function replaceIfNewer(value) {
  if (!isDataValid(value)) return false;
  const current = Date.parse(state.data?.generatedAt || '') || 0;
  const incoming = Date.parse(value.generatedAt || '') || 0;
  if (state.data && incoming < current) return false;
  state.data = value;
  try { writeStore(STORAGE_DATA, JSON.stringify(value)); } catch {}
  // Os pontos dependem do cardápio efetivo: atualizar quando a coleta chegar.
  renderDates();
  renderMenus();
  return true;
}
async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {cache: 'no-store', signal: controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function fetchMenus() {
  if (state.syncing) return;
  state.syncing = true;
  state.lastError = null;
  state.fallbackUsed = false;
  try {
    const config = window.RU_CONFIG || {};
    let data;
    let snapshotSource = 'static';
    if (config.publicFeedUrl) {
      snapshotSource = 'firestore';
      data = await getJSON(config.publicFeedUrl);
    } else if (config.firebaseProjectId) {
      const id = encodeURIComponent(config.firebaseProjectId);
      try {
        const doc = await getJSON(`https://firestore.googleapis.com/v1/projects/${id}/databases/(default)/documents/publicMenus/current`);
        data = JSON.parse(doc.fields?.payload?.stringValue || 'null');
        snapshotSource = 'firestore';
      } catch (feedError) {
        // Contingência exclusivamente com dados reais e recentes já publicados no próprio Hosting.
        // O fallback vazio/desatualizado NÃO mascara a indisponibilidade do Firestore.
        let staticData = null;
        try { staticData = await getJSON('/data/cardapios.json'); } catch { /* conservar erro original */ }
        const ageMs = Date.now() - Date.parse(staticData?.generatedAt || '');
        const validAge = Number.isFinite(ageMs) && ageMs >= -600000 && ageMs <= 72 * 3600000;
        const today = sPauloParts().iso;
        const hasConfirmedLunch = Array.from({length: 5}, (_, n) => addDays(today, n)).some(date =>
          ['setorial-i', 'setorial-ii'].some(ru =>
            Array.isArray(staticData?.days?.[date]?.restaurants?.[ru]?.meals?.almoco?.items) &&
            staticData.days[date].restaurants[ru].meals.almoco.items.length > 0));
        if (!isDataValid(staticData) || !validAge || !hasConfirmedLunch) throw feedError;
        data = staticData;
        state.fallbackUsed = true;
        snapshotSource = 'static';
      }
    } else {
      data = await getJSON('/data/cardapios.json');
    }
    if (!isDataValid(data)) throw new Error('Dados fora do formato esperado');
    await loadIngredientCatalog();
    if (replaceIfNewer(data)) state.snapshotSource = snapshotSource;
  } catch (error) {
    console.warn('Falha ao carregar cardápio:', error);
    state.lastError = error;
  } finally {
    state.syncing = false;
    renderMenus();
  }
}
function initTheme() {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const active = media.matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = active;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',active === 'dark' ? '#12121b' : '#f7f7fc');
  };
  const onChange = () => apply();
  if(media.addEventListener) media.addEventListener('change',onChange);
  else if(media.addListener) media.addListener(onChange);
  apply();
}

/**
 * Troca uma versão antiga da aplicação automaticamente quando um Service
 * Worker novo assume. Não interrompe diálogos/formulários em andamento.
 * O ID é por release: novos deploys poderão atualizar normalmente.
 */
function setupPwaUpdates() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const releaseKey='ruhoje:sw-refresh:hub-v272-20261117-interno-markers-menu-dots-r1';
  const hadController=!!navigator.serviceWorker.controller;
  let reloadRequested=false;
  let reloading=false;
  const safeToReload=()=>!document.hidden &&
    !document.querySelector('dialog[open]') &&
    !document.activeElement?.matches('input, textarea, [contenteditable="true"]');
  const refreshIfSafe=()=>{
    if (!reloadRequested || reloading || !safeToReload()) return;
    try {
      if (sessionStorage.getItem(releaseKey)==='done') return;
      sessionStorage.setItem(releaseKey,'done');
    } catch { /* navegação sem armazenamento continua possível */ }
    reloading=true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if (!hadController) return; // Primeiro controle: app atual já é a versão correta.
    reloadRequested=true;
    refreshIfSafe();
  });
  window.addEventListener('focus',refreshIfSafe);
  document.addEventListener('visibilitychange',refreshIfSafe);
  document.addEventListener('click',()=>queueMicrotask(refreshIfSafe));
  const update=()=>navigator.serviceWorker.getRegistration()
    .then(registration=>registration?.update()).catch(()=>{});
  const register=()=>navigator.serviceWorker.register('/service-worker.js',{updateViaCache:'none'})
    .then(registration=>registration.update()).catch(()=>{});
  if(document.readyState==='complete') register();
  else window.addEventListener('load',register,{once:true});
  window.addEventListener('online',update);
  window.addEventListener('pageshow',event=>{if(event.persisted) update();});
}

function boot() {
  initTheme();
  const savedRu = readStore(STORAGE_RU);
  state.selectedRu = RU_LIST.some(ru => ru.id === savedRu) ? savedRu : null;
  state.selectedDate = sPauloParts().iso;
  try { const cached = JSON.parse(readStore(STORAGE_DATA) || 'null'); if (isDataValid(cached)) state.data = cached; } catch {}
  hydrateLiveMenus();
  hydratePrefetchMeta();
  initDialog();
  renderRestaurant(); renderDates({scroll:true}); renderMenus();
  loadIngredientCatalog().then(() => renderMenus());
  $('today-button').addEventListener('click',()=> {cancelPrefetch();state.selectedDate=sPauloParts().iso;renderDates({scroll:true});renderMenus();refreshLive({force:!liveMenuFor(state.selectedDate,state.selectedRu)});startPrefetch(state.selectedRu,state.selectedDate);});
  window.addEventListener('online',()=>{fetchMenus();refreshLive({force:true});startPrefetch(state.selectedRu,state.selectedDate);});
  window.addEventListener('offline',()=>{cancelPrefetch();renderMenus();});
  window.addEventListener('storage',event=>{
    if (event.key===STORAGE_LIVE) {
      hydrateLiveMenus();
      renderDates();
      renderMenus();
    } else if (event.key===STORAGE_PREFETCH) hydratePrefetchMeta();
  });
  document.addEventListener('visibilitychange',()=> {
    if (document.hidden) cancelPrefetch();
    else {maybeTick();fetchMenus();refreshLive();startPrefetch(state.selectedRu,state.selectedDate);}
  });
  let previousToday = sPauloParts().iso;
  let previousMealPeriod = null;
  function maybeTick() {
    const clock = sPauloParts();
    const currentPeriod = clock.hours * 60 + clock.minutes >= 870 ? 'jantar' : 'almoco';
    if (clock.iso !== previousToday) {
      if (state.selectedDate === previousToday) state.selectedDate = clock.iso;
      cancelPrefetch();
      previousToday = clock.iso; renderDates({scroll:true}); renderMenus(); refreshLive({force:true}); startPrefetch(state.selectedRu,state.selectedDate);
    } else if (previousMealPeriod !== currentPeriod) renderMenus();
    renderHours();
    if (!document.hidden) refreshLive();
    previousMealPeriod = currentPeriod;
  }
  setInterval(maybeTick,60_000); maybeTick();
  fetchMenus();
  refreshLive();
  // Não aguardar resultado de hoje: os dias futuros podem estar publicados
  // mesmo quando o RU/data atual responde 503 ou não contém pratos.
  startPrefetch(state.selectedRu,state.selectedDate);
  if (!state.selectedRu) {requestAnimationFrame(() => openDialog());}
  setupPwaUpdates();
}
boot();
