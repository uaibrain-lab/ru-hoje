/** Verificador independente do GitHub. Sem banco, credencial ou escrita. */
const HUB_SW='https://hubufmg.web.app/service-worker.js';
const FUMP_API='https://fump.ufmg.br:3003/cardapios/cardapio';
const TIMEOUT_MS=8500;

export function dateBrasilia(now=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
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
    // Limitar leitura em caso de erro de servidor, sem registrar dados.
    const limit=500_000;
    const length=Number(response.headers?.get?.('content-length')||0);
    if(length>limit)return {ok:false};
    const body=await response.text();
    if(!body || body.length>limit)return {ok:false};
    return {ok:true,body};
  }catch{return {ok:false};}
  finally{clearTimeout(timer);}
}

export async function inspectIndependentHealth({fetchFn=fetch,now=new Date(),timeoutMs=TIMEOUT_MS}={}) {
  // Sem verificar/menu fictício: API oficial pode retornar [] legitimamente.
  const day=dateBrasilia(now);
  const url=new URL(FUMP_API);
  url.searchParams.set('id','6');
  url.searchParams.set('dataInicio',day);
  url.searchParams.set('dataFim',day);
  const [site,official]=await Promise.all([
    readWithTimeout(HUB_SW,{fetchFn,timeoutMs}),
    readWithTimeout(url.href,{fetchFn,timeoutMs})
  ]);
  let hosting=site.ok && /const VERSION\s*=\s*['"]hub-v/.test(site.body)?'OK':'ERROR';
  let fump='ERROR';
  if(official.ok) {
    try{
      const payload=JSON.parse(official.body);
      if((payload.id==null || String(payload.id)==='6') &&
         Array.isArray(payload.cardapios) &&
         payload.cardapios.every(row=>row && Array.isArray(row.refeicoes)))
        fump='OK';
    }catch{ /* FUMP JSON inválido -> erro e nenhuma contingência */ }
  }
  return {hosting,fump,date:day,readOnly:true};
}

export async function runIndependentScheduled({fetchFn=fetch,now=new Date(),logger=console}={}) {
  const report=await inspectIndependentHealth({fetchFn,now});
  // Apenas estados e a data: sem nomes de pratos, endereços, visitantes ou PII.
  if(report.hosting==='OK' && report.fump==='OK'){
    logger.log('HUB_INDEPENDENT_HEALTH_OK',JSON.stringify(report));
    return report;
  }
  logger.error('HUB_INDEPENDENT_HEALTH_DEGRADED',JSON.stringify(report));
  throw new Error('HUB_INDEPENDENT_HEALTH_DEGRADED');
}
