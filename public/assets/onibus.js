/* Hub UFMG — linhas Internas/Externas ficam filtradas em /interno > Linhas.
 * O Externo é aberto no mapa municipal após selecionar uma linha da lista.
 */
const $=id=>document.getElementById(id);
const EXTERNO='/externo/';
let verified=null,pending=null,frameReady=false,selectedCode='';
export function modeFromSearch(query=''){return new URLSearchParams(query).get('tipo')==='externo'?'externo':'interno'}
export function localServiceDay(date=new Date()){
  const x=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date).map(p=>[p.type,p.value]));
  return x.year+x.month+x.day;
}
export function validExternoManifest(m,day=localServiceDay()){
  return Boolean(m&&typeof m==='object'&&!Array.isArray(m)&&
    typeof m.gtfsVersion==='string'&&m.gtfsVersion.trim()&&
    Number.isInteger(m.routes)&&m.routes>0&&Number.isInteger(m.stops)&&m.stops>0&&
    Number.isInteger(m.stopTimeRows)&&m.stopTimeRows>0&&
    typeof m.feedStartDate==='string'&&/^[0-9]{8}$/.test(m.feedStartDate)&&
    typeof m.feedEndDate==='string'&&/^[0-9]{8}$/.test(m.feedEndDate)&&
    m.feedStartDate<=day&&day<=m.feedEndDate);
}
function active(){return !$('interno-page')?.hidden}
function showingExternal(){return !$('onibus-externo')?.hidden}
function changeView(external){
  $('onibus-interno').hidden=external;
  $('onibus-externo').hidden=!external;
  if(!external&&active()){
    const frame=$('interno-frame')?.contentWindow;
    try{frame?.postMessage({type:'hub:onibus:resume-lines'},location.origin);
      frame?.postMessage({type:'bandeco:interno:shown'},location.origin);
      frame?.dispatchEvent(new frame.Event('resize'));
    }catch{/* iframe may be navigating */}
  }
}
function changeUrl(external,code,push){
  if(!push)return;
  const u=new URL(location.href);u.searchParams.set('aba','onibus');
  if(external){u.searchParams.set('tipo','externo');if(code)u.searchParams.set('linha',code);}
  else{u.searchParams.delete('tipo');u.searchParams.delete('linha');}
  history.pushState({hubTab:'interno',external},'',u);
}
function showEmpty(kind){
  const state={
    loading:['VERIFICANDO DADOS','Preparando o Externo BH','Conferindo os horários municipais.'],
    missing:['EM BREVE','Externo BH indisponível','O pacote municipal homologado ainda não foi instalado no Hub.'],
    expired:['ATUALIZAÇÃO NECESSÁRIA','Horários municipais vencidos','O período válido do GTFS municipal terminou.'],
    offline:['SEM CONEXÃO','Não foi possível verificar os horários','Confira sua conexão e tente novamente.'],
    error:['NÃO FOI POSSÍVEL ABRIR','O mapa externo não carregou','Não foi possível abrir a página municipal.']
  }[kind]||[];
  $('onibus-empty-overline').textContent=state[0];
  $('onibus-empty-title').textContent=state[1];
  $('onibus-externo-status').textContent=state[2];
  $('onibus-externo-retry').hidden=kind==='loading';
  $('onibus-empty').hidden=false;$('externo-frame').hidden=true;
  $('onibus-externo').setAttribute('aria-busy',String(kind==='loading'));
}
function focusRoute(code){
  if(!code||!frameReady)return;
  const doc=$('externo-frame')?.contentDocument;
  if(!doc)return;
  const options=doc.getElementById('routeList'),input=doc.getElementById('lineInput'),
    action=doc.getElementById('goLine');
  if(!options||!input||!action)return;
  const select=()=>{
    if(!Array.from(options.options).some(o=>o.value===code))return false;
    if(input.value===code&&doc.getElementById('lineExit')?.hidden===false)return true;
    input.value=code;action.click();return true;
  };
  if(select())return;
  const observer=new MutationObserver(()=>{if(select())observer.disconnect()});
  observer.observe(options,{childList:true});
  setTimeout(()=>observer.disconnect(),12000);
}
function showMap(){
  if(!active()||!showingExternal())return;
  $('onibus-empty').hidden=true;$('externo-frame').hidden=false;
  $('onibus-externo').setAttribute('aria-busy','false');
  focusRoute(selectedCode);
}
async function checkCatalog(){
  const today=localServiceDay();
  if(verified?.day===today&&Date.now()-verified.at<300000)return;
  if(!pending)pending=(async()=>{
    const r=await fetch(EXTERNO+'catalog/manifest.json',{
      cache:'no-store',headers:{Accept:'application/json'}});
    if(!r.ok)throw Error('MISSING_CATALOG');
    if(!validExternoManifest(await r.json(),today))throw Error('GTFS_EXPIRED');
    verified={day:today,at:Date.now()};
  })().finally(()=>{pending=null});
  return pending;
}
async function loadExternal(force=false){
  if(!active()||!showingExternal())return;
  if(force){verified=null;frameReady=false}
  showEmpty('loading');
  try{
    await checkCatalog();
    if(!active()||!showingExternal())return;
    if(frameReady&&!force){showMap();return}
    const frame=$('externo-frame');
    if(!frame.getAttribute('src')||force)
      frame.setAttribute('src',EXTERNO+(force?'?reload='+Date.now():''));
  }catch(e){
    if(active()&&showingExternal())showEmpty(e.message==='GTFS_EXPIRED'?'expired':
      navigator.onLine===false?'offline':'missing');
  }
}
function openExternal(code='',push=true){
  selectedCode=String(code||'').slice(0,30);
  $('onibus-external-line').textContent=selectedCode?'· '+selectedCode:'';
  changeView(true);changeUrl(true,selectedCode,push);
  void loadExternal();
}
function returnToLines(push=true){
  changeView(false);selectedCode='';changeUrl(false,'',push);
}
export function activateOnibus(){
  if(!active())return;
  if(modeFromSearch(location.search)==='externo')
    openExternal(new URLSearchParams(location.search).get('linha')||'',false);
  else changeView(false);
}
export function initOnibus(){
  $('onibus-back-interno')?.addEventListener('click',()=>returnToLines(true));
  $('onibus-back-interno-secondary')?.addEventListener('click',()=>returnToLines(true));
  $('onibus-externo-retry')?.addEventListener('click',()=>void loadExternal(true));
  window.addEventListener('message',e=>{
    if(e.origin!==location.origin||e.source!==$('interno-frame')?.contentWindow)return;
    if(e.data?.type==='hub:onibus:external-line'&&typeof e.data.code==='string'&&e.data.code.length<=30)
      openExternal(e.data.code,true);
  });
  $('externo-frame')?.addEventListener('load',()=>{
    try{frameReady=$('externo-frame')?.contentDocument?.documentElement?.dataset?.appMode==='free-static'}
    catch{frameReady=false}
    if(!showingExternal()||!active())return;
    if(frameReady)showMap();else showEmpty('error');
  });
}
