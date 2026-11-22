/* Hub UFMG: Ônibus integra dois serviços sem misturar mapas nem inventar ETAs. */
const $=id=>document.getElementById(id);
const EXTERNO='/externo/';
const CHECK_AGE_MS=5*60*1000;
let verified=null,pending=null,frameReady=false;

export function modeFromSearch(search=''){
  return new URLSearchParams(search).get('tipo')==='externo'?'externo':'interno';
}
export function localServiceDay(date=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date).map(part=>[part.type,part.value]));
  return parts.year+parts.month+parts.day;
}
export function validExternoManifest(m,day=localServiceDay()){
  return Boolean(m&&typeof m==='object'&&!Array.isArray(m)&&
    typeof m.gtfsVersion==='string'&&m.gtfsVersion.trim()&&
    Number.isInteger(m.routes)&&m.routes>0&&
    Number.isInteger(m.stops)&&m.stops>0&&
    Number.isInteger(m.stopTimeRows)&&m.stopTimeRows>0&&
    typeof m.feedStartDate==='string'&&/^[0-9]{8}$/.test(m.feedStartDate)&&
    typeof m.feedEndDate==='string'&&/^[0-9]{8}$/.test(m.feedEndDate)&&
    m.feedStartDate<=day&&day<=m.feedEndDate);
}
function active(){return Boolean($('interno-page')&&!$('interno-page').hidden);}
function selected(){return $('onibus-externo')?.hidden===false?'externo':'interno';}
function showUnavailable(kind){
  const box=$('onibus-empty'),title=$('onibus-empty-title'),
    text=$('onibus-externo-status'),eyebrow=$('onibus-empty-overline'),
    retry=$('onibus-externo-retry'),frame=$('externo-frame');
  if(!box||!title||!text||!retry||!frame)return;
  const state={
    loading:['VERIFICANDO DADOS','Preparando o Externo BH',
      'Conferindo a disponibilidade dos pontos e horários municipais.'],
    unavailable:['EM BREVE','Externo BH ainda não disponível',
      'Os ônibus municipais e o metrô vão aparecer aqui quando a versão homologada estiver instalada no Hub.'],
    expired:['ATUALIZAÇÃO NECESSÁRIA','Horários precisam ser atualizados',
      'O período do GTFS municipal terminou. Não exibimos horários vencidos como atuais.'],
    offline:['SEM CONEXÃO','Não foi possível verificar os dados',
      'Conecte-se à internet e tente novamente para consultar os horários municipais.'],
    error:['NÃO FOI POSSÍVEL ABRIR','O Externo BH não carregou',
      'Os dados foram encontrados, mas a página não abriu corretamente. Tente novamente.']
  }[kind]||[];
  eyebrow.textContent=state[0]||'INDISPONÍVEL';
  title.textContent=state[1]||'Externo BH indisponível';
  text.textContent=state[2]||'';
  retry.hidden=kind==='loading';
  box.hidden=false;
  frame.hidden=true;
  $('onibus-externo').setAttribute('aria-busy',String(kind==='loading'));
}
function revealExterno(){
  const frame=$('externo-frame');
  if(!frame||!active()||selected()!=='externo')return;
  frame.hidden=false;
  $('onibus-empty').hidden=true;
  $('onibus-externo').setAttribute('aria-busy','false');
  notifyFrame(frame);
}
function notifyFrame(frame,interno=false){
  if(!frame?.contentWindow||!active())return;
  requestAnimationFrame(()=>{
    try{
      const w=frame.contentWindow;
      if(interno)w.postMessage({type:'bandeco:interno:shown'},window.location.origin);
      w.dispatchEvent(new w.Event('resize'));
    }catch{/* Frame may be navigating or have a different origin. */}
  });
}
async function checkSource(){
  const day=localServiceDay();
  if(verified?.day===day&&Date.now()-verified.at<CHECK_AGE_MS)return true;
  if(!pending){
    pending=(async()=>{
      const response=await fetch(EXTERNO+'catalog/manifest.json',{
        cache:'no-store',headers:{Accept:'application/json'}
      });
      if(!response.ok)throw Error('MISSING_CATALOG');
      const manifest=await response.json();
      if(!validExternoManifest(manifest,day))throw Error('GTFS_EXPIRED');
      verified={day,at:Date.now()};
      return true;
    })().finally(()=>{pending=null;});
  }
  return pending;
}
async function loadExterno({force=false}={}){
  if(!active()||selected()!=='externo')return;
  const frame=$('externo-frame');
  if(!frame)return;
  if(force)verified=null;
  // Reutilizar somente o pacote já aberto e conferido no mesmo dia de serviço.
  const today=localServiceDay();
  if(verified?.day===today&&frameReady&&!force){
    revealExterno();
    return;
  }
  showUnavailable('loading');
  try{
    await checkSource();
    if(!active()||selected()!=='externo')return;
    if(frameReady){revealExterno();return;}
    if(!frame.getAttribute('src')||force)
      frame.setAttribute('src',EXTERNO+(force?'?reload='+Date.now():''));
    // Mantém feedback visível até o iframe sinalizar o documento estático.
  }catch(error){
    if(!active()||selected()!=='externo')return;
    const kind=error.message==='GTFS_EXPIRED'?'expired':
      navigator.onLine===false?'offline':'unavailable';
    showUnavailable(kind);
  }
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
  const copy=$('onibus-description'),source=$('onibus-source-label');
  if(copy)copy.textContent=mode==='externo'
    ?'Linhas municipais e metrô · horários programados, não tempo real.'
    :'Linhas e pontos de circulação dentro do campus UFMG.';
  if(source)source.textContent=mode==='externo'?'Belo Horizonte':'Campus UFMG';
  if(push&&active()){
    const url=new URL(window.location.href);
    url.searchParams.set('aba','onibus');
    if(mode==='externo')url.searchParams.set('tipo','externo');
    else url.searchParams.delete('tipo');
    window.history.pushState({hubTab:'interno',busMode:mode},'',url);
  }
  if(!active())return;
  if(mode==='externo')void loadExterno();
  else notifyFrame($('interno-frame'),true);
}
export function activateOnibus(){
  if(active())selectMode(modeFromSearch(window.location.search));
}
export function initOnibus(){
  for(const mode of ['interno','externo']){
    $('onibus-filter-'+mode)?.addEventListener('click',()=>selectMode(mode,true));
  }
  const buttons=['interno','externo'].map(x=>$('onibus-filter-'+x));
  for(let i=0;i<buttons.length;i++){
    buttons[i]?.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const dest=event.key==='Home'?0:event.key==='End'?1:
        (i+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;
      buttons[dest]?.focus();
      selectMode(dest===0?'interno':'externo',true);
    });
  }
  $('onibus-back-interno')?.addEventListener('click',()=>{
    selectMode('interno',true);
    $('onibus-filter-interno')?.focus();
  });
  $('onibus-externo-retry')?.addEventListener('click',()=>void loadExterno({force:true}));
  $('externo-frame')?.addEventListener('load',()=>{
    const frame=$('externo-frame');
    try{
      // Fail closed: a Hosting 404/rewrite must not be mistaken for Externo.
      const document=frame.contentDocument;
      frameReady=document?.documentElement?.dataset?.appMode==='free-static';
    }catch{frameReady=false;}
    if(selected()!=='externo'||!active())return;
    if(frameReady)revealExterno();
    else showUnavailable('error');
  });
}
