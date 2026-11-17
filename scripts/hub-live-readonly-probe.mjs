/**
 * Auditoria on-demand read-only: Firebase Hosting + API oficial FUMP via Worker.
 * Nao consulta Firestore, nao guarda pratos e nao altera estado do site.
 * Sem dados pessoais, cookies, credenciais, Admin SDK ou escrita.
 */
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const ORIGIN='https://hubufmg.web.app';
const PROXY='https://hub-fump-proxy.hubufmg.workers.dev';
const IDS=['6','1','2','5'];

export function isoBrasilia(now=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).map(x=>[x.type,x.value]));
  return [parts.year,parts.month,parts.day].join('-');
}

async function check(url,{fetchFn=fetch,origin=false,timeoutMs=10000}={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchFn(url,{
      method:'GET',credentials:'omit',cache:'no-store',
      signal:controller.signal,
      headers:origin?{Accept:'application/json',Origin:ORIGIN}:{Accept:'*/*'}
    });
    const body=await response.text();
    const header=name=>response.headers?.get?.(name)||'';
    return {
      http:response.status,ok:response.ok,bytes:body.length,
      cacheControl:header('cache-control'),fetchedAt:header('x-menu-fetched-at'),
      body
    };
  }finally{clearTimeout(timer);}
}

export async function auditLive({fetchFn=fetch,now=new Date(),origin=ORIGIN,proxy=PROXY}={}) {
  const iso=isoBrasilia(now);
  const report={checkedAt:now.toISOString(),dateBrasilia:iso,readOnly:true,checks:{},menus:[]};
  for(const [name,path] of [['site','/'],['app','/assets/app.js'],['pwa','/service-worker.js'],['interno','/interno']]){
    try{
      const r=await check(origin+path,{fetchFn});
      report.checks[name]={status:r.ok?'ok':'error',http:r.http,bytes:r.bytes};
      if(name==='pwa' && r.ok) report.checks[name].version=r.body.match(/const VERSION\s*=\s*'([^']+)'/)?.[1]||null;
      if(name==='app' && r.ok) report.checks[name].officialOnly=
        r.body.includes('function menuFor(date, ruId) { return liveMenuFor(date,ruId); }');
    }catch(e){report.checks[name]={status:'error',code:String(e?.name||'NETWORK_ERROR').slice(0,50)};}
  }
  for(const id of IDS){
    const url=new URL('/api/menu',proxy);
    url.searchParams.set('id',id);url.searchParams.set('data',iso);
    try{
      const r=await check(url.href,{fetchFn,origin:true});
      if(!r.ok) {report.menus.push({id,status:'FETCH_ERROR',http:r.http});continue;}
      const payload=JSON.parse(r.body);
      if(String(payload?.id)!==id || !Array.isArray(payload?.cardapios))
        throw new Error('INVALID_SCHEMA');
      const collected=Date.parse(r.fetchedAt);
      const age=(now.getTime()-collected)/1000;
      const headersValid=Number.isFinite(age) && age>=-10 && age<=75 &&
        !/stale-if-error/i.test(r.cacheControl);
      // Disponibilidade e formato, sem nomes ou listas de pratos privados.
      report.menus.push({
        id,status:headersValid?(payload.cardapios.length?'VALID_RESPONSE':'NOT_PUBLISHED'):'INVALID_CACHE_TIMESTAMP',
        http:r.http,ageSeconds:Number.isFinite(age)?Math.round(age):null
      });
    }catch(e){report.menus.push({id,status:'FETCH_ERROR',code:String(e?.message||e?.name||'UNKNOWN').slice(0,50)});}
  }
  report.hostingOk=Object.values(report.checks).every(x=>x.status==='ok');
  report.proxyOk=report.menus.some(x=>['VALID_RESPONSE','NOT_PUBLISHED'].includes(x.status));
  report.degraded=!report.hostingOk || !report.proxyOk || report.menus.some(x=>x.status==='FETCH_ERROR');
  return report;
}

/**
 * Avaliação operacional do health check, sem permitir que uma indisponibilidade
 * isolada se transforme em incidente de hospedagem ou em cardápio antigo.
 */
export function classifyLiveHealth(report) {
  if(!report?.hostingOk)return 'HOSTING_DOWN';
  const valid=(report.menus||[]).filter(x=>['VALID_RESPONSE','NOT_PUBLISHED'].includes(x.status)).length;
  const errors=(report.menus||[]).filter(x=>!['VALID_RESPONSE','NOT_PUBLISHED'].includes(x.status)).length;
  if(valid===0 || errors>=3)return 'PROXY_OUTAGE';
  if(errors>0)return 'PARTIAL_UPSTREAM';
  return 'OK';
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const result=await auditLive();
  console.log('HUB_LIVE_READONLY_AUDIT='+JSON.stringify(result));
  // O site estático inoperante é problema do Hub. Falha de dados da FUMP
  // apenas sinaliza degradação externa; não justifica gravar pratos antigos.
  const health=classifyLiveHealth(result);
  console.log('HUB_HEALTH_STATUS='+health);
  if(!result.hostingOk)process.exitCode=2;
  else if(process.env.HUB_HEALTH_STRICT==='true' && health==='PROXY_OUTAGE')
    process.exitCode=3;
}
