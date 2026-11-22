/* Hub UFMG — uma única experiência para internos e municipais.
 * O GTFS externo continua em /externo/catalog, mas o usuário permanece
 * no mapa e nas listas unificadas de /interno, sem segundo buscador/iframe.
 */
const $=id=>document.getElementById(id);
const FOCUS_STOP='hub:onibus:focus-municipal-stop';
const FOCUS_LINE='hub:onibus:focus-municipal-line';
let ready=false,initialized=false;
export function modeFromSearch(query=''){
  return new URLSearchParams(query).get('tipo')==='externo'?'externo':'interno';
}
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
function visible(){return !$('interno-page')?.hidden}
function postToUnified(message){
  if(!ready||!visible())return;
  $('interno-frame')?.contentWindow?.postMessage(message,location.origin);
}
function focusDirectLink(){
  if(!ready||!visible())return;
  const p=new URLSearchParams(location.search);
  if(p.get('tipo')!=='externo')return;
  const stop=p.get('ponto'),code=p.get('linha');
  if(stop&&/^[0-9]{1,20}$/.test(stop))
    postToUnified({type:FOCUS_STOP,id:stop});
  else if(code&&/^[A-Za-z0-9_.:-]{1,30}$/.test(code))
    postToUnified({type:FOCUS_LINE,code});
  else postToUnified({type:'hub:onibus:resume-lines'});
}
function recordSelection(data){
  if(!visible())return;
  const u=new URL(location.href);
  const old=u.search;
  if(data.kind==='stop'&&typeof data.id==='string'&&/^[0-9]{1,20}$/.test(data.id)){
    u.searchParams.set('aba','onibus');
    u.searchParams.set('tipo','externo');u.searchParams.set('ponto',data.id);
    u.searchParams.delete('linha');
  }else if(data.kind==='line'&&typeof data.code==='string'&&
           /^[A-Za-z0-9_.:-]{1,30}$/.test(data.code)){
    u.searchParams.set('aba','onibus');
    u.searchParams.set('tipo','externo');u.searchParams.set('linha',data.code);
    u.searchParams.delete('ponto');
  }else if(data.kind==='home'){
    u.searchParams.delete('tipo');u.searchParams.delete('ponto');u.searchParams.delete('linha');
  }else return;
  if(u.search!==old)history.pushState({hubTab:'interno',municipal:data.kind},'',u);
}
export function activateOnibus(){
  // Mesmo em links antigos ?tipo=externo, o painel interno continua visível
  // com o filtro Todos/Internos/Municipais, a busca única e o GPS no mapa.
  if($('onibus-interno'))$('onibus-interno').hidden=false;
  postToUnified({type:'bandeco:interno:shown'});
  focusDirectLink();
}
export function initOnibus(){
  if(initialized)return;initialized=true;
  const frame=$('interno-frame');
  frame?.addEventListener('load',()=>{
    ready=true;
    if(visible())activateOnibus();
  });
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;
    if(event.data?.type==='hub:onibus:unified-selection')recordSelection(event.data);
  });
  window.addEventListener('popstate',()=>{if(visible())focusDirectLink()});
  if(frame?.contentDocument?.readyState==='complete'){ready=true;activateOnibus()}
}
