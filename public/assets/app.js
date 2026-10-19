const SOURCE_URL = 'https://fump.ufmg.br/cardapio-do-dia/';
const STORAGE_RU = 'ruhoje:restaurant:v1';
const STORAGE_PREFERS_CAFE = 'ruhoje:prefers-cafe:v1';
const STORAGE_DATA = 'ruhoje:menus:v1';
const TIMEZONE = 'America/Sao_Paulo';
const RU_LIST = [
  { id: 'setorial-i', name: 'RU Setorial I', region: 'Campus Pampulha', meals: ['almoco', 'jantar'], saturday:true },
  { id: 'setorial-ii', name: 'RU Setorial II', region: 'Campus Pampulha', meals: ['cafe', 'almoco'] },
  { id: 'saude', name: 'RU Saúde', region: 'Campus Saúde', meals: ['cafe', 'almoco', 'jantar'], saturday:true },
  { id: 'direito', name: 'RU Direito', region: 'Faculdade de Direito', meals: ['cafe', 'almoco', 'jantar'] },
  { id: 'ica', name: 'RU ICA', region: 'Montes Claros', meals: ['cafe', 'almoco', 'jantar'], saturday:true },
];
const MEAL_INFO = {
  almoco: { title: 'Almoço', icon: '<circle cx="12" cy="12" r="8"/><path d="M12 4v2m0 12v2m8-8h-2M6 12H4m13.7-5.7-1.4 1.4M7.7 16.3l-1.4 1.4m11.4 0-1.4-1.4M7.7 7.7 6.3 6.3"/>' },
  jantar: { title: 'Jantar', icon: '<path d="M20.5 14.4A8.4 8.4 0 0 1 9.6 3.5 8.4 8.4 0 1 0 20.5 14.4Z"/>' },
  cafe: { title: 'Café da manhã', icon: '<path d="M4 9h12v5a6 6 0 0 1-12 0V9Zm12 1h2a3 3 0 0 1 0 6h-3M3 21h15M7 3v3m5-3v3"/>' },
};
const GROUP_ORDER = ['Pratos principais', 'Opção vegetariana', 'Guarnições', 'Acompanhamentos', 'Saladas', 'Sobremesas', 'Bebidas', 'Outros'];
const $ = (id) => document.getElementById(id);
const state = { selectedRu: null, selectedDate: null, data: null, lastError: null, syncing: false, initialOpen: false };

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
function menuFor(date, ruId) { return state.data?.days?.[date]?.restaurants?.[ruId] || null; }
function el(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function iconSVG(paths) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`; }
function selectedRu() { return RU_LIST.find(ru => ru.id === state.selectedRu); }

function renderRestaurant() {
  const ru = selectedRu();
  $('current-restaurant').textContent = ru ? ru.name : 'Escolher restaurante';
  $('restaurant-subtitle').textContent = ru ? ru.region + ' · toque para trocar' : 'Toque para salvar seu RU favorito';
  const items = $('restaurant-options');
  items.replaceChildren();
  for (const item of RU_LIST) {
    const button = el('button', 'restaurant-option');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(item.id === state.selectedRu));
    const marker = el('span', 'option-icon');
    marker.innerHTML = iconSVG('<path d="m3 21 3-12 6-5 6 5 3 12M6 21V9h12v12M9 21v-7h6v7"/>');
    const copy = el('span', 'option-label');
    copy.append(el('strong', '', item.name), el('small', '', item.region));
    const check = el('span', 'option-check', item.id === state.selectedRu ? '✓' : '');
    check.setAttribute('aria-hidden', 'true');
    button.append(marker, copy, check);
    button.addEventListener('click', () => {
      state.selectedRu = item.id;
      writeStore(STORAGE_RU, item.id);
      renderRestaurant();
      renderMenus();
      $('restaurant-dialog').close();
      $('restaurant-trigger').focus();
    });
    items.append(button);
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
  for (let offset = -4; offset < 11; offset++) {
    const iso = addDays(today, offset);
    const date = dayDate(iso);
    const isWeekend = [0, 6].includes(date.getUTCDay());
    const card = el('button', 'date-card');
    card.type = 'button';
    card.dataset.iso = iso;
    card.dataset.weekend = String(isWeekend);
    card.setAttribute('aria-pressed', String(iso === state.selectedDate));
    card.setAttribute('aria-label', `${friendlyDate(iso, {weekday:'long',day:'numeric',month:'long'})}${iso === today ? ', hoje' : ''}`);
    card.append(el('span','weekday',friendlyDate(iso,{weekday:'short'}).replace('.','')),
      el('span','daynum',String(date.getUTCDate()).padStart(2,'0')),
      el('span','daylabel',iso === today ? 'hoje' : (isWeekend ? '·' : '')));
    card.addEventListener('click', (event) => {
      state.selectedDate = iso;
      renderDates();
      // Focus returns to the new node after re-render (keyboard accessibility).
      if (event?.detail === 0) dateStrip.querySelector(`[data-iso="${iso}"]`)?.focus({preventScroll:true});
      renderMenus();
    });
    dateStrip.append(card);
  }
  $('dates-heading').textContent = friendlyDate(state.selectedDate, {month:'long',year:'numeric'}).replace(/^./, c=>c.toUpperCase());
  $('today-button').hidden = state.selectedDate === today;
  if (scroll) requestAnimationFrame(() => {
    const active=dateStrip.querySelector('[aria-pressed="true"]');
    if (active) dateStrip.scrollLeft=Math.max(0,active.offsetLeft - dateStrip.offsetLeft - (dateStrip.clientWidth-active.offsetWidth)/2);
  });
  else dateStrip.scrollLeft = oldScrollLeft;
}
function categoryName(raw) {
  const t = String(raw || '').toLocaleLowerCase('pt-BR');
  if (/(veget|prote[ií]co\s*3|op[çc][aã]o\s*veg)/.test(t)) return 'Opção vegetariana';
  if (/(protei|prato principal|carne|principal)/.test(t)) return 'Pratos principais';
  if (/(guarni|acompanhamento quente)/.test(t)) return 'Guarnições';
  if (/(acompanhamento|arroz|feij[aã]o)/.test(t)) return 'Acompanhamentos';
  if (/(entrada|salada)/.test(t)) return 'Saladas';
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
  if (isFeatured) head.append(el('span','featured-badge','Em destaque'));
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
    const category = categoryName(typeof item === 'string' ? '' : item.category);
    if (!groups.has(category)) groups.set(category, []);
    if (!groups.get(category).includes(name)) groups.get(category).push(name);
  }
  const contents = el('div','meal-contents');
  for (const groupName of GROUP_ORDER) {
    const dishes = groups.get(groupName);
    if (!dishes?.length) continue;
    const group = el('section','menu-group');
    // Itens sem rótulo oficial são apresentados de forma neutra.
    group.append(el('h4','menu-group-title',groupName === 'Outros' ? 'No cardápio' : groupName));
    const list = el('ul','dish-list');
    for (const name of dishes) list.append(el('li','',name));
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
function renderMenus() {
  const today = sPauloParts();
  const ru = selectedRu();
  const day = state.selectedDate || today.iso;
  $('menu-heading').textContent = day === today.iso ? 'Cardápio de hoje' : `Cardápio de ${friendlyDate(day,{day:'numeric',month:'short'})}`;
  const list = $('meal-list'); list.replaceChildren();
  $('connection-notice').hidden = true;
  const data = menuFor(day,state.selectedRu);
  const fallbackUpdate = state.data?.generatedAt || null;
  if (!ru) {
    const msg = el('div','no-menu');
    msg.append(el('h3','', 'Primeiro, escolha seu RU'), el('p','', 'Salvaremos sua preferência para abrir direto no cardápio das próximas vezes.'));
    list.append(msg); $('update-line').textContent = ''; return;
  }
  if (state.lastError && state.data && day === today.iso) {
    $('connection-notice').textContent = 'Não foi possível atualizar agora. Exibindo os últimos dados disponíveis; confira a FUMP antes de sair.';
    $('connection-notice').hidden = false;
  } else if (!navigator.onLine) {
    $('connection-notice').textContent = 'Você está offline. Os dados disponíveis podem estar desatualizados.';
    $('connection-notice').hidden = false;
  }
  const supported = ru.meals;
  const entries = ['almoco','jantar','cafe'].filter(m => supported.includes(m) || data?.meals?.[m]);
  const hasItems = entries.some(m => Array.isArray(data?.meals?.[m]?.items) && data.meals[m].items.length);
  if (!hasItems) {
    list.append(renderNoMenu(ru,day));
    $('update-line').textContent = fallbackUpdate ? `Última coleta: ${formatUpdate(fallbackUpdate)} · Fonte: FUMP` : 'Aguardando primeira sincronização dos cardápios da FUMP.';
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
  $('update-line').textContent = updatedAt ? `Última consulta: ${formatUpdate(updatedAt)} · Fonte: FUMP` : 'Fonte: FUMP';
}
function replaceIfNewer(value) {
  if (!isDataValid(value)) return false;
  const current = Date.parse(state.data?.generatedAt || '') || 0;
  const incoming = Date.parse(value.generatedAt || '') || 0;
  if (state.data && incoming < current) return false;
  state.data = value;
  try { writeStore(STORAGE_DATA, JSON.stringify(value)); } catch {}
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
  $('refresh-button').classList.add('is-loading');
  $('refresh-button').disabled = true;
  try {
    const config = window.RU_CONFIG || {};
    let data;
    if (config.publicFeedUrl) {
      data = await getJSON(config.publicFeedUrl);
    } else if (config.firebaseProjectId) {
      const id = encodeURIComponent(config.firebaseProjectId);
      const doc = await getJSON(`https://firestore.googleapis.com/v1/projects/${id}/databases/(default)/documents/publicMenus/current`);
      data = JSON.parse(doc.fields?.payload?.stringValue || 'null');
    } else {
      data = await getJSON('/data/cardapios.json');
    }
    if (!isDataValid(data)) throw new Error('Dados fora do formato esperado');
    replaceIfNewer(data);
  } catch (error) {
    console.warn('Falha ao carregar cardápio:', error);
    state.lastError = error;
  } finally {
    state.syncing = false;
    $('refresh-button').classList.remove('is-loading');
    $('refresh-button').disabled = false;
    renderMenus();
  }
}
function boot() {
  const savedRu = readStore(STORAGE_RU);
  state.selectedRu = RU_LIST.some(ru => ru.id === savedRu) ? savedRu : null;
  state.selectedDate = sPauloParts().iso;
  try { const cached = JSON.parse(readStore(STORAGE_DATA) || 'null'); if (isDataValid(cached)) state.data = cached; } catch {}
  initDialog();
  renderRestaurant(); renderDates({scroll:true}); renderMenus();
  $('today-button').addEventListener('click',()=> {state.selectedDate=sPauloParts().iso;renderDates({scroll:true});renderMenus();});
  $('refresh-button').addEventListener('click', fetchMenus);
  window.addEventListener('online',fetchMenus);
  window.addEventListener('offline',renderMenus);
  document.addEventListener('visibilitychange',()=> { if(!document.hidden){maybeTick();fetchMenus();} });
  let previousToday = sPauloParts().iso;
  let previousMealPeriod = null;
  function maybeTick() {
    const clock = sPauloParts();
    const currentPeriod = clock.hours * 60 + clock.minutes >= 870 ? 'jantar' : 'almoco';
    if (clock.iso !== previousToday) {
      if (state.selectedDate === previousToday) state.selectedDate = clock.iso;
      previousToday = clock.iso; renderDates({scroll:true}); renderMenus();
    } else if (previousMealPeriod !== currentPeriod) renderMenus();
    previousMealPeriod = currentPeriod;
  }
  setInterval(maybeTick,60_000); maybeTick();
  fetchMenus();
  if (!state.selectedRu) {requestAnimationFrame(() => openDialog());}
  if ('serviceWorker' in navigator && window.isSecureContext) window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
}
boot();
