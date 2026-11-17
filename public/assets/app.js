// OCUPA_RU_P3_CLIENT_FIX
import {currentOpening, weeklySummary} from './hours.js';
import {publishedCategory} from './dish-category.js';
import {isNonOperatingDay, dateChipLabel} from './date-availability.js';
import {readLiveMenu, sourceForRu, isValidLiveEntry, validISO} from './fump-live.js';
import {buildPrefetchPlan, canRunBackgroundFetch, recentlyChecked, PREFETCH_LIMIT_PER_DAY, PREFETCH_MIN_GAP_MS} from './fump-prefetch.js';
const SOURCE_URL = 'https://fump.ufmg.br/cardapio-do-dia/';
const STORAGE_RU = 'ruhoje:restaurant:v1';
const LEGACY_MENU_KEYS = ['ruhoje:menus:v1','ruhoje:live-menus:v1'];
const STORAGE_PREFETCH = 'ruhoje:prefetch-quota:v3';
const LEGACY_PREFETCH_META = 'ruhoje:prefetch-checks:v2';
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
const state = { selectedRu: null, selectedDate: null, ingredientCatalog: null, ingredientCatalogPromise: null, liveMenus: new Map(), liveStatus: new Map(), liveChecks: new Map(), livePending: new Map(), prefetchChecks: new Map(), prefetchQuota: {date:'',count:0}, prefetchGeneration: 0, prefetchActiveKey: null };

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
function stripDangerous(value) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240); }
function friendlyDate(iso, options) { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...options }).format(dayDate(iso)); }
function liveKey(date, ruId) {return date + '|' + (sourceForRu(ruId) || 'invalid');}
function liveMenuFor(date, ruId) {
  const entry = state.liveMenus.get(liveKey(date,ruId));
  return isValidLiveEntry(entry,date,ruId) ? entry : null;
}
function menuFor(date, ruId) { return liveMenuFor(date,ruId); }
/**
 * Indicador do calendário: aparece apenas em datas sem atendimento regular.
 * Nunca depende de cardápio, HTTP 503 ou resposta da FUMP.
 */
function nonOperatingDayForDate(iso,ruId) {
  return isNonOperatingDay(iso,ruId);
}
// Ao atualizar para o modelo FUMP-only, descartar cardápios de instalações antigas.
 // Nenhum dado desses índices volta a ser lido nem salvo.
function clearLegacyMenuCaches() {
  for (const key of LEGACY_MENU_KEYS) {
    try { localStorage.removeItem(key); } catch { /* armazenamento bloqueado */ }
  }
}
function prefetchAllowed() {
  return canRunBackgroundFetch({
    online:navigator.onLine,
    visible:!document.hidden,
    connection:navigator.connection || null
  });
}
// Persistir apenas o contador diário necessário à proteção da cota gratuita.
// Status de consultas são temporários e nunca sobrevivem ao fechamento da aba.
function persistPrefetchMeta() {
  writeStore(STORAGE_PREFETCH,JSON.stringify(state.prefetchQuota));
}
function hydratePrefetchMeta() {
  // Migração conservadora: preservar contagem antiga para não zerar o orçamento
  // do mesmo dia; descartar registros de consultas antigas armazenados no cliente.
  // IMPORTANTE: o storage event chama esta função entre abas; nunca regravar
  // a cada evento, senão duas abas entram em loop de mensagens.
  let migrated=false;
  for(const key of [LEGACY_PREFETCH_META,STORAGE_PREFETCH]) {
    try {
      const raw=JSON.parse(readStore(key)||'null');
      const quota=key===LEGACY_PREFETCH_META ? raw?.quota : raw;
      if(quota?.date!==sPauloParts().iso || !Number.isInteger(quota?.count)) continue;
      state.prefetchQuota={
        date:quota.date,
        count:Math.min(PREFETCH_LIMIT_PER_DAY,Math.max(state.prefetchQuota.count,0,quota.count))
      };
    }catch { /* metadados adulterados ou bloqueados nunca viram dados oficiais */ }
  }
  try {
    if(localStorage.getItem(LEGACY_PREFETCH_META)!==null) {
      localStorage.removeItem(LEGACY_PREFETCH_META);
      migrated=true;
    }
  }catch{}
  if(migrated) persistPrefetchMeta();
}
function recordPrefetchCheck(key,status) {
  state.prefetchChecks.set(key,{status,at:Date.now()});
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
    // Somente as próximas datas do RU escolhido, sem buscar todos os RUs.
    futureDays:5,
    otherFutureDays:0,
    limit:5
  }).filter(task=>sourceForRu(task.ruId)===sourceForRu(ruId)
    && !isNonOperatingDay(task.iso,ruId)).slice(0,3);
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
  // Fase 2: atualizar automaticamente no máximo uma vez por minuto por
  // RU/data. Cliques que pedem dados ainda ausentes têm janela mínima de 30s,
  // evitando que repetidos cliques disparem consultas ilimitadas à FUMP.
  const minimumGapMs=force && !background ? 30_000 : 60_000;
  if (now-(state.liveChecks.get(key) || 0) < minimumGapMs) return {status:'SKIPPED'};
  state.liveChecks.set(key,now);
  const proxyUrl=window.RU_CONFIG?.fumpProxyUrl || '';
  const task = readLiveMenu(ruId,iso, background
    ? {maxAttempts:1,timeoutMs:12000,proxyUrl}
    : {maxAttempts:proxyUrl ? 2 : 1,proxyUrl}).then(result => {
    // Uma nova resposta oficial (inclusive vazia) invalida o cardápio anterior.
    // Não recuperar histórico de Firestore, JSON estático ou localStorage.
    // CF-Cache-Status: STALE não atende a exigência de consulta atual.
    const status=result.status==='VALID_MENU' && result.cacheStatus==='STALE'
      ? 'FETCH_ERROR' : result.status;
    recordPrefetchCheck(key,status);
    state.liveStatus.set(key,{status,at:new Date().toISOString(),cacheStatus:result.cacheStatus||'',error:result.error||null});
    if (status === 'VALID_MENU') {
      const payload={iso,ruId,meals:result.meals,sourceRestaurantId:result.sourceId,fetchedAt:result.fetchedAt};
      state.liveMenus.set(key,payload);
    } else {
      state.liveMenus.delete(key);
      if (status==='PARSE_ERROR') console.warn('Cardápio oficial em formato inesperado',result.error);
    }
    if (sourceForRu(state.selectedRu)===sourceForRu(ruId)) renderDates();
    if (key === liveKey(state.selectedDate || sPauloParts().iso,state.selectedRu)) renderMenus();
    if (!background && ['VALID_MENU','NOT_PUBLISHED'].includes(status)
        && state.selectedRu===ruId && state.selectedDate===iso) {
      startPrefetch(ruId,iso);
    }
    return status===result.status ? result : {...result,status,error:'WORKER_STALE_RESPONSE'};
  }).catch(error => {
    state.liveStatus.set(key,{status:'FETCH_ERROR',at:new Date().toISOString()});
    state.liveMenus.delete(key);
    if (sourceForRu(state.selectedRu)===sourceForRu(ruId)) renderDates();
    recordPrefetchCheck(key,'FETCH_ERROR');
    if (key===liveKey(state.selectedDate||sPauloParts().iso,state.selectedRu)) renderMenus();
    console.warn('Falha na consulta oficial FUMP',error?.name || 'ERROR');
    return {status:'FETCH_ERROR'};
  }).finally(() => state.livePending.delete(key));
  state.livePending.set(key,task);
  // Ao repetir uma consulta com dado ausente/expirado, não manter o estado de
  // erro ou ausência anterior enquanto a FUMP ainda está respondendo.
  if(key===liveKey(state.selectedDate||sPauloParts().iso,state.selectedRu) && !liveMenuFor(iso,ruId)){
    state.liveStatus.delete(key);
    renderMenus();
  }
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
  const approachingClose=status.state==='open' && status.minutesRemaining<=20;
  const closingTime=status.message.match(/fecha às (.+)$/)?.[1];
  $('hours-status').textContent=(approachingClose && closingTime ? `Fecha em ${status.minutesRemaining} min · até ${closingTime}` : status.message) + (status.details?.toLowerCase().includes('café da manhã') ? ' · Exclusivo pra FUMP I, II e III' : '');
  $('hours-dot').className='hours-dot '+(status.state==='open'?'is-open':'is-closed');
  const list=$('hours-list');list.replaceChildren();
  for(const block of weeklySummary(ru.id)) {
    const row=el('div','hours-row');
    row.append(el('strong','',block.day),el('span','',block.services.map(service => service.startsWith('Café da manhã') ? `${service} (Exclusivo pra FUMP I, II e III)` : service).join(' · ')||'Não atende'));
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
    const withoutService = nonOperatingDayForDate(iso,state.selectedRu);
    const card = el('button', 'date-card');
    card.type = 'button';
    card.dataset.iso = iso;
    card.dataset.weekend = String(isWeekend);
    card.dataset.noRegularService = String(withoutService);
    card.setAttribute('aria-pressed', String(iso === state.selectedDate));
    card.setAttribute('aria-label', `${friendlyDate(iso, {weekday:'long',day:'numeric',month:'long'})}${iso === today ? ', hoje' : ''}${withoutService ? ', sem atendimento regular previsto' : ''}`);
    card.append(el('span','weekday',friendlyDate(iso,{weekday:'short'}).replace('.','')),
      el('span','daynum',String(date.getUTCDate()).padStart(2,'0')),
      el('span','daylabel',dateChipLabel(iso === today, withoutService)));
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
  title.append(el('h3', '', info.title), el('div','meal-subtitle',mealId === 'cafe' ? 'Exclusivo pra FUMP I, II e III' : ru.region));
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
    const group = el('section','menu-group' + (groupName === 'Pratos principais' ? ' menu-group--main' : groupName === 'Opção vegetariana' ? ' menu-group--vegetarian' : ''));
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
function renderNoMenu(ru, date, status = 'NOT_PUBLISHED') {
  const root = el('div','no-menu');
  const picture = el('div','empty-illustration');
  picture.innerHTML = iconSVG('<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>');
  const noService=nonOperatingDayForDate(date,ru.id);
  const error=status==='FETCH_ERROR' || status==='PARSE_ERROR';
  root.append(picture,el('h3','',error?'Consulta indisponível':noService?'Sem atendimento regular previsto':'Cardápio ainda não divulgado'));
  root.append(el('p','',error
    ? 'Não foi possível confirmar os pratos diretamente na FUMP. Tente novamente quando a conexão estiver disponível.'
    : noService
      ? `${ru.name} não tem atendimento regular previsto nessa data. Consulte a FUMP para possíveis exceções.`
      : `A FUMP ainda não confirmou pratos para ${ru.name} em ${friendlyDate(date,{day:'numeric',month:'long'})}.`));
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
  const selectedKey=liveKey(day,state.selectedRu);
  const liveStatus=state.liveStatus.get(selectedKey);
  const waitingForLive=navigator.onLine && !live && !liveStatus &&
    (state.livePending.has(selectedKey) || !nonOperatingDayForDate(day,state.selectedRu));
  if (!ru) {
    const msg=el('div','no-menu');
    msg.append(el('h3','','Primeiro, escolha seu RU'),
      el('p','','Salvaremos sua preferência para abrir direto no cardápio das próximas vezes.'));
    list.append(msg); renderLastUpdateLine(null); return;
  }
  if (!navigator.onLine) {
    $('connection-notice').textContent='Você está offline. Não foi possível confirmar o cardápio atual da FUMP.';
    $('connection-notice').hidden=false;
  }
  // Exibir somente refeições efetivamente publicadas pela FUMP. Não criar cartões vazios.
  // Café da manhã é restrito e não possui cardápio público nesta interface.
  const entries = ['almoco','jantar'].filter(m => ru.meals.includes(m) && Array.isArray(data?.meals?.[m]?.items) && data.meals[m].items.length > 0);
  const hasItems = entries.length > 0;
  if (!hasItems) {
    if (waitingForLive) {
      $('connection-notice').textContent='Consultando o cardápio atualizado da FUMP…';
      $('connection-notice').hidden=false;
      const skeleton=el('div','meal-skeleton');
      skeleton.setAttribute('role','status');
      skeleton.setAttribute('aria-label','Carregando cardápio oficial');
      skeleton.append(el('div','loading-shimmer'),el('div','loading-shimmer'),el('div','loading-shimmer'));
      list.append(skeleton);
      renderLastUpdateLine(null);
      return;
    } else if (liveStatus?.status==='FETCH_ERROR' && navigator.onLine) {
      $('connection-notice').textContent='Não foi possível consultar a FUMP agora. Nenhum cardápio anterior será exibido.';
      $('connection-notice').hidden=false;
    }
    list.append(renderNoMenu(ru,day,!navigator.onLine?'FETCH_ERROR':liveStatus?.status));
    renderLastUpdateLine(null);
    return;
  }
  const hasRealMeal = id => !!data?.meals?.[id]?.items?.length;
  const after1430 = (today.hours*60+today.minutes)>=870;
  // À tarde não reapresentar o almoço como refeição em destaque.
  const featured = day === today.iso
    ? (after1430 ? (hasRealMeal('jantar') ? 'jantar' : null) : (hasRealMeal('almoco') ? 'almoco' : null))
    : null;
  const order = entries.slice().sort((a,b) => Number(b === featured)-Number(a === featured));
  for (const meal of order) list.append(renderMealCard(meal,data?.meals?.[meal],meal === featured,ru));
  const latestMealFetch=Object.values(data?.meals || {}).map(m=>m?.fetchedAt).filter(Boolean).sort().at(-1);
  const updatedAt = latestMealFetch || data?.fetchedAt;
  const ageHours = updatedAt ? (Date.now() - Date.parse(updatedAt))/(1000*60*60) : null;
  if (day === today.iso && ageHours !== null && ageHours > 18) {
    $('connection-notice').textContent = 'A última atualização tem mais de 18 horas. Este cardápio pode estar desatualizado; confirme na FUMP.';
    $('connection-notice').hidden = false;
  }
  renderLastUpdateLine(updatedAt,'FUMP oficial');
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
  const releaseKey='ruhoje:sw-refresh:hub-v285-20261117-menu-compact';
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

function isMenuActive(){
  const initialTab=new URLSearchParams(window.location.search).get('aba');
  return !$('bandeco-main')?.hidden && !['interno','festas','sobre'].includes(initialTab);
}
function boot() {
  initTheme();
  const savedRu = readStore(STORAGE_RU);
  state.selectedRu = RU_LIST.some(ru => ru.id === savedRu) ? savedRu : null;
  state.selectedDate = sPauloParts().iso;
  clearLegacyMenuCaches();
  hydratePrefetchMeta();
  initDialog();
  renderRestaurant(); renderDates({scroll:true}); renderMenus();
  const prepareMenu=()=>{
    if(!isMenuActive())return;
    loadIngredientCatalog().then(()=>{if(isMenuActive())renderMenus();});
    renderMenus();
    refreshLive({force:!liveMenuFor(state.selectedDate,state.selectedRu)});
    startPrefetch(state.selectedRu,state.selectedDate);
  };
  if(isMenuActive())loadIngredientCatalog().then(()=>{if(isMenuActive())renderMenus();});
  window.addEventListener('hub:menu:activated',prepareMenu);
  window.addEventListener('hub:menu:deactivated',cancelPrefetch);
  $('today-button').addEventListener('click',()=> {cancelPrefetch();state.selectedDate=sPauloParts().iso;renderDates({scroll:true});renderMenus();refreshLive({force:!liveMenuFor(state.selectedDate,state.selectedRu)});startPrefetch(state.selectedRu,state.selectedDate);});
  window.addEventListener('online',()=>{if(isMenuActive()){refreshLive({force:true});startPrefetch(state.selectedRu,state.selectedDate);}});
  window.addEventListener('offline',()=>{cancelPrefetch();if(isMenuActive())renderMenus();});
  window.addEventListener('storage',event=>{
    if (event.key===STORAGE_PREFETCH) hydratePrefetchMeta();
  });
  document.addEventListener('visibilitychange',()=> {
    if (document.hidden) cancelPrefetch();
    else {maybeTick();if(isMenuActive()){refreshLive();startPrefetch(state.selectedRu,state.selectedDate);}}
  });
  let previousToday = sPauloParts().iso;
  let previousMealPeriod = null;
  function maybeTick() {
    const clock = sPauloParts();
    const currentPeriod = clock.hours * 60 + clock.minutes >= 870 ? 'jantar' : 'almoco';
    if (clock.iso !== previousToday) {
      if (state.selectedDate === previousToday) state.selectedDate = clock.iso;
      cancelPrefetch();
      previousToday = clock.iso; renderDates({scroll:true}); if(isMenuActive()){renderMenus();refreshLive({force:true});startPrefetch(state.selectedRu,state.selectedDate);}
    } else if (previousMealPeriod !== currentPeriod && isMenuActive()) renderMenus();
    renderHours();
    if (!document.hidden && isMenuActive()) refreshLive();
    previousMealPeriod = currentPeriod;
  }
  setInterval(maybeTick,60_000); maybeTick();
  if(isMenuActive()){
    refreshLive();
    // Dias futuros podem estar publicados mesmo que o dia atual esteja vazio.
    startPrefetch(state.selectedRu,state.selectedDate);
  }
  // Links diretos para Festas/Interno/Sobre não exigem selecionar RU.
  if (!state.selectedRu && isMenuActive()) {requestAnimationFrame(() => {
    if(isMenuActive() && !state.selectedRu)openDialog();
  });}
  setupPwaUpdates();
}
boot();
