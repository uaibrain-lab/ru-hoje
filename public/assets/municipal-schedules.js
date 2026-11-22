/* Grade de horários da SUMOB/BHTRANS no próprio painel unificado.
 * Dados GTFS programados: nunca inferir GPS, velocidade ou ETA a partir deles.
 * Só baixa 1 dos 256 shards por ponto, preservando uso móvel e plano gratuito.
 */
const root='/externo/catalog/';
const cache=new Map(),HOUR=3600000,DAY=86400000;
const week=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function bhDay(epoch){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(epoch));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
const plusDay=(day,delta)=>new Date(Date.parse(day+'T12:00:00Z')+
  delta*DAY).toISOString().slice(0,10);
export function shardForStop(id){
  let n=0;for(const c of String(id))n=(n*31+c.charCodeAt(0))%256;
  return n.toString(16).padStart(2,'0');
}
async function json(url,fetchFn){
  const r=await fetchFn(url,{cache:'force-cache'});
  if(!r.ok)throw Error('GTFS_HTTP_'+r.status);
  return r.json();
}
async function catalog(path,fetchFn=fetch){
  if(!cache.has(path)){
    const p=json(root+path,fetchFn).catch(e=>{cache.delete(path);throw e});
    cache.set(path,p);
  }
  return cache.get(path);
}
async function bucket(id,version,fetchFn){
  const file=shardForStop(id)+'.json.gz';
  const response=await fetchFn(root+'arrivals/'+file+'?v='+encodeURIComponent(version),
    {cache:'force-cache'});
  if(!response.ok)throw Error('HORARIOS_HTTP_'+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<2)throw Error('HORARIOS_VAZIOS');
  if(bytes[0]===31&&bytes[1]===139){
    if(typeof DecompressionStream==='undefined')throw Error('COMPACTACAO_NAO_SUPORTADA');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function serviceActive(service,day,calendar){
  const date=day.replaceAll('-',''),id=String(service);
  const override=calendar.exceptions?.[date]?.[id];
  if(override!==undefined)return Number(override)===1;
  const c=calendar.services?.[id];
  if(!c||date<c.start_date||date>c.end_date)return false;
  return String(c[week[new Date(day+'T12:00:00Z').getUTCDay()]])==='1';
}
function firstIndex(times,n){
  let lo=0,hi=times.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(times[mid]<n)lo=mid+1;else hi=mid;}
  return lo;
}
export async function scheduledForStop(stopId,{now=Date.now(),fetchFn=fetch}={}){
  const [manifest,index,calendar]=await Promise.all([
    json(root+'manifest.json',fetchFn),
    catalog('arrivals/index.json',fetchFn),
    catalog('arrivals/calendar.json',fetchFn)
  ]);
  if(index.schema!==1||index.buckets!==256||index.version!==manifest.gtfsVersion||
     index.validThrough!==manifest.feedEndDate||!calendar.services||!calendar.exceptions)
    throw Error('CATALOGO_GTFS_INCONSISTENTE');
  if(bhDay(now).replaceAll('-','')>index.validThrough)
    return {expired:true,items:[],version:index.version};
  const data=await bucket(String(stopId),index.version,fetchFn);
  const entries=data[String(stopId)]||[];
  const found=new Map();
  for(const [code,service,destination,times] of entries){
    if(!Array.isArray(times)||!times.length)continue;
    const id=String(code)+'\u0000'+String(destination||'').trim();
    for(const delta of [-1,0,1]){
      const day=plusDay(bhDay(now),delta);
      if(!serviceActive(service,day,calendar))continue;
      const midnight=Date.parse(day+'T00:00:00-03:00');
      const start=firstIndex(times,Math.ceil((now-midnight)/1000));
      for(const second of times.slice(start,start+3)){
        const at=midnight+second*1000;
        if(at<now||at-now>5*HOUR)continue;
        if(!found.has(id))found.set(id,[]);
        found.get(id).push(at);
      }
    }
  }
  const items=[...found].map(([key,times])=>{
    const [code,destination]=key.split('\u0000');
    const at=Math.min(...times);
    return {code,destination,at,minutes:Math.max(0,Math.floor((at-now)/60000))};
  }).sort((a,b)=>a.at-b.at||a.code.localeCompare(b.code,'pt-BR',{numeric:true}));
  return {expired:false,items:items.slice(0,24),version:index.version};
}
export function resetSchedulesForTests(){cache.clear()}
