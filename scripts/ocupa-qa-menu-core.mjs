/** OCUPA UFMG / P5-B. Funções puras. Sem rede e sem escrita remota. */
export const PROJECT = 'bandeco-homologacao';
export const DOCUMENT = 'publicMenus/current';
export const FUMP_SOURCE = 'https://fump.ufmg.br/cardapio-do-dia/';
const ID_BY_RU = Object.freeze({'setorial-i':'6','setorial-ii':'1',saude:'2',direito:'2',ica:'5'});
const ALLOWED = Object.freeze({'setorial-i':['cafe','almoco'],'setorial-ii':['almoco','jantar'],saude:['cafe','almoco','jantar'],direito:['cafe','almoco','jantar'],ica:['cafe','almoco','jantar']});
const fail = message => {throw new Error(message);};
export function isoDate(text) {
  if(typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text+'T12:00:00Z')) || new Date(text+'T12:00:00Z').toISOString().slice(0,10) !== text) fail('DATA_INVALIDA');
  return text;
}
export function addDays(date,n) { const d = new Date(isoDate(date)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); }
export function todayBR(now=new Date()) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function safeContext(env=process.env) {
  if(env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST) fail('EMULADOR_ATIVO');
  for(const k of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT','GCP_PROJECT','FIREBASE_PROJECT_ID']) if(env[k] && env[k]!==PROJECT) fail('PROJETO_DIVERGENTE_'+k);
  for(const k of ['FIREBASE_SERVICE_ACCOUNT_JSON','HOMOLOGATION_FIREBASE_SERVICE_ACCOUNT_JSON']) if(env[k]) fail('CREDENCIAL_JSON_NAO_PERMITIDA');
  return PROJECT;
}
export function assertWriteGate(args,env=process.env) {
  safeContext(env);
  if(!args.includes('--mode=apply') || !args.includes('--ack=PUBLICAR_SOMENTE_OCUPA_QA')) fail('ACK_QA_AUSENTE');
  if(env.OCUPA_QA_SYNC_ENABLED!=='true' || env.OCUPA_QA_PUBLISH_ENABLED!=='true') fail('FLAGS_QA_DESATIVADAS');
  if(env.GITHUB_ACTIONS==='true') {
    if(!env.OCUPA_QA_ALLOWED_REPO || !env.GITHUB_REPOSITORY || env.OCUPA_QA_ALLOWED_REPO!==env.GITHUB_REPOSITORY) fail('REPOSITORIO_GITHUB_NAO_AUTORIZADO');
  }
  return true;
}
export function sanitizeIncoming(snapshot,now=new Date(),maxDays=7) {
  if(!snapshot || snapshot.schemaVersion!==1 || snapshot.source!==FUMP_SOURCE || typeof snapshot.days!=='object' || Array.isArray(snapshot.days)||snapshot.days===null) fail('SCHEMA_INVALIDO');
  const created=Date.parse(snapshot.generatedAt);
  if(!Number.isFinite(created) || created < now.getTime()-60*60*1000 || created > now.getTime()+5*60*1000) fail('GERACAO_FORA_JANELA');
  const today=todayBR(now);let chosen=0, entries=0, lunchI=0,lunchII=0, exclusions=0;
  const days={};
  for(const [date,day] of Object.entries(snapshot.days)) {
    isoDate(date);
    if(date<today || date>addDays(today,maxDays-1)) fail('DATA_FORA_JANELA');
    if(!day || typeof day.restaurants!=='object' || !day.restaurants || Array.isArray(day.restaurants)) fail('RESTAURANTES_INVALIDOS');
    const restaurants={};
    for(const [ru,value] of Object.entries(day.restaurants)) {
      if(!Object.hasOwn(ID_BY_RU,ru) || !value || String(value.sourceRestaurantId)!==ID_BY_RU[ru] || typeof value.meals!=='object' || !value.meals || Array.isArray(value.meals)) fail('RU_FONTE_DIVERGENTE');
      const meals={};
      for(const [kind,meal] of Object.entries(value.meals)) {
        if(!['cafe','almoco','jantar'].includes(kind)) fail('REFEICAO_DESCONHECIDA');
        if(!ALLOWED[ru].includes(kind)) {exclusions++;continue;}
        if(!meal || !Array.isArray(meal.items) || meal.items.length>40) fail('PRATOS_INVALIDOS');
        const items=meal.items.map(item=>{
          if(!item || typeof item.name!=='string' || item.name.trim().length<2 || item.name.length>180 || /[\r\n<>\x00-\x1f]/.test(item.name)) fail('NOME_PRATO_INVALIDO');
          return {...item,name:item.name.trim()};
        });
        if(items.length) { meals[kind]={...meal,items};entries+=items.length; }
      }
      if(Object.keys(meals).length) {restaurants[ru]={...value,meals};chosen++;}
    }
    if(Object.keys(restaurants).length) days[date]={restaurants};
  }
  for(const day of Object.values(days)) {
    if(day.restaurants['setorial-i']?.meals.almoco?.items.length) lunchI++;
    if(day.restaurants['setorial-ii']?.meals.almoco?.items.length) lunchII++;
  }
  const paired=Object.values(days).some(day=>day.restaurants['setorial-i']?.meals.almoco?.items.length>0 && day.restaurants['setorial-ii']?.meals.almoco?.items.length>0);
  if(!paired || !entries) fail('ALMOCOS_ATUAIS_DOS_DOIS_SETORIAIS_AUSENTES');
  return {snapshot:{schemaVersion:1,generatedAt:snapshot.generatedAt,source:FUMP_SOURCE,days},summary:{days:Object.keys(days).length,restaurantDates:chosen,dishes:entries,lunchDatesI:lunchI,lunchDatesII:lunchII,excludedInvalidService:exclusions}};
}
export function checkOld(old) {
  if(!old || old.schemaVersion!==1 || typeof old.days!=='object'||!old.days||Array.isArray(old.days)) fail('DOCUMENTO_QA_INVALIDO');
  if(old.generatedAt && !Number.isFinite(Date.parse(old.generatedAt))) fail('DATA_REMOTA_INVALIDA');
  for(const [date,day] of Object.entries(old.days)) {
    isoDate(date);if(!day||typeof day.restaurants!=='object'||!day.restaurants||Array.isArray(day.restaurants)) fail('DIA_REMOTO_INVALIDO');
  }
  return old;
}
export function mergeSnapshots(old,fresh,now=new Date()) {
  checkOld(old);
  if(Date.parse(old.generatedAt||0) > Date.parse(fresh.generatedAt)) fail('FONTE_REMOTA_MAIS_NOVA');
  const min=addDays(todayBR(now),-7),max=addDays(todayBR(now),14);
  const days={};
  for(const [date,day] of Object.entries(old.days)) if(date>=min&&date<=max) days[date]=structuredClone(day);
  for(const [date,day] of Object.entries(fresh.days)) {
    const target=days[date] ||= {restaurants:{}};
    target.restaurants ||= {};
    for(const [ru,data] of Object.entries(day.restaurants)) {
      const previously=target.restaurants[ru];
      if(previously?.meals) {
        const mergedMeals={...previously.meals,...data.meals};
        for(const kind of Object.keys(mergedMeals)) if(!ALLOWED[ru].includes(kind)) delete mergedMeals[kind];
        target.restaurants[ru]={...previously,...data,meals:mergedMeals};
      } else target.restaurants[ru]=data;
    }
  }
  // Mantém metadados existentes, exceto o instante de atualização de coleta.
  const merged={...old,schemaVersion:1,source:FUMP_SOURCE,generatedAt:fresh.generatedAt,days};
  // A validade das datas completas não pode ser herdada de coleta anterior.
  delete merged.verifiedCompleteDates;
  return merged;
}
export function menuContentFingerprint(menu) {
  return JSON.stringify(Object.entries(menu.days||{}).sort(([a],[b])=>a.localeCompare(b)).map(([date,day])=>[date,Object.entries(day.restaurants||{}).sort(([a],[b])=>a.localeCompare(b)).map(([ru,value])=>[ru,Object.entries(value.meals||{}).sort(([a],[b])=>a.localeCompare(b)).map(([meal,v])=>[meal,(v.items||[]).map(i=>[i.name,i.category||'',i.sourceType||''])])])]));
}
export function decideWrite(old,merged,now=new Date()) {
  const changed=menuContentFingerprint(old)!==menuContentFingerprint(merged);
  const age=now.getTime()-Date.parse(old.generatedAt||0);
  return {write: changed || !Number.isFinite(age) || age >= 8*60*60*1000, reason:changed?'DADOS_ALTERADOS':'REFRESCAR_METADADOS',contentChanged:changed};
}
