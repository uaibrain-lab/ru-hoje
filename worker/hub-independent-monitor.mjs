/** Monitor do Worker: nenhuma credencial, gravação ou execução de sorteio. */
const HUB_SW='https://hubufmg.web.app/service-worker.js';
const FUMP_API='https://fump.ufmg.br:3003/cardapios/cardapio';
const TIMEOUT_MS=8500;
export const RU_IDS=Object.freeze(['6','1','2','5']);

export function dateBrasilia(now=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).map(p=>[p.type,p.value]));
  return [parts.year,parts.month,parts.day].join('-');
}

async function readWithTimeout(url,{fetchFn=fetch,timeoutMs=TIMEOUT_MS}={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchFn(url,{
      method:'GET',headers:{Accept:'application/json, text/javascript'},
      cache:'no-store',redirect:'manual',signal:controller.signal
    });
    if(!response.ok || response.status>=300)return {ok:false};
    const limit=500_000;
    const length=Number(response.headers?.get?.('content-length')||0);
    if(length>limit)return {ok:false};
    const body=await response.text();
    if(!body || body.length>limit)return {ok:false};
    return {ok:true,body};
  }catch{return {ok:false};}
  finally{clearTimeout(timer);}
}

function correctDate(value,date) {
  if(value==null)return false;
  const raw=String(value);
  const iso=/^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/.exec(raw)?.[1];
  const br=/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/.exec(raw);
  return (iso||(br?[br[3],br[2],br[1]].join('-'):null))===date;
}

export function validOfficialResponse(payload,id,date) {
  if(!payload || typeof payload!=='object' || !Array.isArray(payload.cardapios))
    return false;
  if(payload.id!=null && String(payload.id)!==id)return false;
  return payload.cardapios.every(day=>{
    if(!day || typeof day!=='object' || !Array.isArray(day.refeicoes))return false;
    const dateValues=['data','dataCardapio','dataReferencia']
      .filter(key=>day[key]!=null);
    if(!dateValues.length || dateValues.some(key=>!correctDate(day[key],date)))return false;
    return day.refeicoes.every(meal=>meal && Array.isArray(meal.pratos));
  });
}

export async function inspectIndependentHealth({fetchFn=fetch,now=new Date(),timeoutMs=TIMEOUT_MS}={}) {
  const date=dateBrasilia(now);
  const urls=RU_IDS.map(id=>{
    const url=new URL(FUMP_API);
    url.searchParams.set('id',id);
    url.searchParams.set('dataInicio',date);
    url.searchParams.set('dataFim',date);
    return url.href;
  });
  // Exatamente cinco GETs, em paralelo: Hosting + quatro RUs.
  const [site,...menus]=await Promise.all([HUB_SW,...urls].map(url=>
    readWithTimeout(url,{fetchFn,timeoutMs})
  ));
  const hosting=site.ok && /const VERSION\s*=\s*['"]hub-v/.test(site.body)?'OK':'ERROR';
  const restaurants=Object.fromEntries(RU_IDS.map((id,index)=>{
    let valid=false;
    if(menus[index].ok){
      try {valid=validOfficialResponse(JSON.parse(menus[index].body),id,date);}
      catch{ /* JSON inválido não equivale a cardápio vazio */ }
    }
    return [id,valid?'OK':'ERROR'];
  }));
  const failures=Object.values(restaurants).filter(value=>value==='ERROR').length;
  const fump=failures===0?'OK':failures===RU_IDS.length?'ERROR':'PARTIAL';
  return {hosting,fump,restaurants,date,readOnly:true};
}

export async function runIndependentScheduled({fetchFn=fetch,now=new Date(),logger=console}={}) {
  const report=await inspectIndependentHealth({fetchFn,now});
  // Log estritamente limitado a status público; nenhum prato nem PII.
  if(report.hosting==='OK' && report.fump==='OK'){
    logger.log('HUB_INDEPENDENT_HEALTH_OK',JSON.stringify(report));
    return report;
  }
  logger.error('HUB_INDEPENDENT_HEALTH_DEGRADED',JSON.stringify(report));
  throw new Error('HUB_INDEPENDENT_HEALTH_DEGRADED');
}
