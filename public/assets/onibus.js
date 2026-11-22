/* Hub UFMG: tab Ônibus, two independent feeds. No ETA invented or GPS calls. */
const $ = id => document.getElementById(id);
const EXTERNO='/externo/';
let verified=false, pending=null;

export function modeFromSearch(search='') {
  return new URLSearchParams(search).get('tipo')==='externo'?'externo':'interno';
}
export function localServiceDay(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date).map(p=>[p.type,p.value]));
  return parts.year+parts.month+parts.day;
}
export function validExternoManifest(m,day=localServiceDay()){
  return Boolean(m && typeof m==='object' && !Array.isArray(m) &&
    typeof m.gtfsVersion==='string' && m.gtfsVersion.trim() &&
    Number.isInteger(m.routes) && m.routes>0 &&
    Number.isInteger(m.stops) && m.stops>0 &&
    Number.isInteger(m.stopTimeRows) && m.stopTimeRows>0 &&
    typeof m.feedStartDate==='string' && /^[0-9]{8}$/.test(m.feedStartDate) &&
    typeof m.feedEndDate==='string' && /^[0-9]{8}$/.test(m.feedEndDate) &&
    m.feedStartDate<=day && day<=m.feedEndDate);
}
function active(){return Boolean($('interno-page')&&!$('interno-page').hidden);}
function selected(){return $('onibus-externo')?.hidden===false?'externo':'interno';}
function status(message){
  const box=$('onibus-externo-status');
  if(box){box.textContent=message;box.hidden=false;}
}
function shown(frame,interno=false){
  if(!frame?.contentWindow||!active())return;
  requestAnimationFrame(()=>{
    try{
      const inner=frame.contentWindow;
      if(interno)inner.postMessage({type:'bandeco:interno:shown'},window.location.origin);
      inner.dispatchEvent(new inner.Event('resize'));
    }catch{/* Same-origin only; frame may still be navigating. */}
  });
}
async function loadExterno(){
  if(!active()||selected()!=='externo')return;
  const frame=$('externo-frame');
  if(!frame)return;
  if(verified){
    if(!frame.getAttribute('src'))frame.setAttribute('src',EXTERNO);
    frame.hidden=false;
    $('onibus-externo-status').hidden=true;
    shown(frame);
    return;
  }
  if(pending)return;
  status('Verificando dados municipais de Belo Horizonte…');
  pending=(async()=>{
    try{
      const response=await fetch(EXTERNO+'catalog/manifest.json',{
        method:'GET',cache:'no-store',headers:{Accept:'application/json'}
      });
      if(!response.ok)throw new Error('MISSING_CATALOG');
      const manifest=await response.json();
      if(!validExternoManifest(manifest))throw new Error('GTFS_EXPIRED');
      verified=true;
      if(!active()||selected()!=='externo')return;
      frame.setAttribute('src',EXTERNO);
      frame.hidden=false;
      $('onibus-externo-status').hidden=true;
      shown(frame);
    }catch(error){
      verified=false;
      if(!active()||selected()!=='externo')return;
      status(error.message==='GTFS_EXPIRED'
        ? 'Dados municipais fora da validade. O Externo BH precisa de atualização.'
        : 'Externo BH ainda não está disponível nesta prévia. É necessário instalar o pacote homologado em /externo/.');
      frame.hidden=true;
    }finally{pending=null;}
  })();
  await pending;
}
function selectMode(mode,push=false){
  if(mode!=='interno'&&mode!=='externo')return;
  for(const option of ['interno','externo']){
    const chosen=option===mode;
    const panel=$('onibus-'+option),button=$('onibus-filter-'+option);
    if(panel)panel.hidden=!chosen;
    if(button){
      button.classList.toggle('is-selected',chosen);
      button.setAttribute('aria-pressed',String(chosen));
    }
  }
  if(push&&active()){
    const url=new URL(window.location.href);
    url.searchParams.set('aba','onibus');
    if(mode==='externo')url.searchParams.set('tipo','externo');
    else url.searchParams.delete('tipo');
    window.history.pushState({hubTab:'interno',busMode:mode},'',url);
  }
  if(!active())return;
  if(mode==='externo')void loadExterno();
  else shown($('interno-frame'),true);
}
export function activateOnibus(){
  if(active())selectMode(modeFromSearch(window.location.search));
}
export function initOnibus(){
  for(const mode of ['interno','externo']){
    $('onibus-filter-'+mode)?.addEventListener('click',()=>selectMode(mode,true));
  }
  $('externo-frame')?.addEventListener('load',()=>{
    if(selected()==='externo')shown($('externo-frame'));
  });
}
