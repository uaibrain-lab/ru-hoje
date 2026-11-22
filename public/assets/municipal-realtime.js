/**
 * ETA derived from PBH/SUMOB official GTFS-RT delay + EXACT static GTFS trip.
 * Never derive ETA from straight-line GPS distance or an unrelated line timetable.
 * A 256-way, per-stop compressed index is downloaded only on point selection.
 */
import {shardForStop,serviceActive} from './municipal-schedules.js';

const ROOT='/externo/catalog/';
const serviceDay=date=>String(date).slice(0,4)+'-'+String(date).slice(4,6)+'-'+String(date).slice(6,8);
const dateOK=value=>{
  const text=String(value);
  if(!/^\d{8}$/.test(text))return false;
  const date=new Date(text.slice(0,4)+'-'+text.slice(4,6)+'-'+text.slice(6)+'T12:00:00Z');
  return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10).replaceAll('-','')===text;
};
const startTimeSeconds=text=>{
  const m=String(text||'').match(/^(\d{1,3}):([0-5]\d):([0-5]\d)$/);
  if(!m)return null;
  const s=Number(m[1])*3600+Number(m[2])*60+Number(m[3]);
  return s<48*3600?s:null;
};
/**
 * SUMOB route_id is the public route short name, while the official
 * GTFS stop timetable uses numeric route_id. Only a UNIQUE alias can
 * be normalized; duplicates and unrelated municipal routes fail closed.
 */
export function normalizeTripDelayRoutes(updates,catalogRoutes,servingRouteIds){
  if(!Array.isArray(updates)||updates.length>250||
     !Array.isArray(catalogRoutes)||!servingRouteIds)return [];
  const allowed=new Set([...servingRouteIds].map(String));
  const aliases=new Map();
  for(const r of catalogRoutes){
    const id=String(r?.id||''),code=String(r?.code||'').trim();
    if(!allowed.has(id)||!/^[A-Za-z0-9_.:-]{1,70}$/.test(id)||
       !/^[A-Za-z0-9_.:-]{1,70}$/.test(code))continue;
    for(const alias of [id,code]){
      if(aliases.has(alias)&&aliases.get(alias)!==id)aliases.set(alias,null);
      else if(!aliases.has(alias))aliases.set(alias,id);
    }
  }
  return updates.flatMap(update=>{
    const id=aliases.get(String(update?.routeId||''));
    if(!id)return [];
    return [{...update,routeId:id}];
  });
}

export function projectOfficialDelays(relativeUpdates,rows,{stopId,calendar,now=Date.now()}={}){
  if(!Array.isArray(relativeUpdates)||!Array.isArray(rows)||
     !/^[0-9]{1,20}$/.test(String(stopId||''))||!calendar||
     !Number.isFinite(now))return [];
  // Keep the farthest confirmed observation along each exact GTFS trip.
  const latest=new Map();
  for(const u of relativeUpdates.slice(0,250)){
    if(!u||!dateOK(u.startDate)||
       !/^[A-Za-z0-9_.:-]{1,90}$/.test(String(u.tripId||''))||
       !/^[A-Za-z0-9_.:-]{1,70}$/.test(String(u.routeId||''))||
       !Number.isSafeInteger(u.observedStopSequence)||u.observedStopSequence<0||
       !/^[0-9]{1,20}$/.test(String(u.observedStopId||''))||
       !Number.isSafeInteger(u.delaySeconds)||Math.abs(u.delaySeconds)>7200)
       continue;
    const stamp=Date.parse(String(u.lastFeedUpdateAt||''));
    if(!Number.isFinite(stamp)||stamp<now-120000||stamp>now+60000)continue;
    const start=startTimeSeconds(u.startTime);
    if(start===null)continue;
    const key=u.tripId+'|'+u.startDate+'|'+u.startTime;
    const prev=latest.get(key);
    if(!prev||u.observedStopSequence>prev.observedStopSequence)
      latest.set(key,u);
  }
  const found=[],seen=new Set();
  for(const row of rows){
    if(!Array.isArray(row)||row.length!==6)continue;
    const [tid,rid,service,sequence,scheduled,start]=row;
    if(!Number.isSafeInteger(sequence)||sequence<0||
       !Number.isSafeInteger(scheduled)||scheduled<0||scheduled>=48*3600||
       !Number.isSafeInteger(start)||start<0||start>=48*3600)
       continue;
    // Index never trusts a user-supplied trip identifier alone.
    for(const u of latest.values()){
      if(u.tripId!==String(tid)||u.routeId!==String(rid)||
         startTimeSeconds(u.startTime)!==start||
         sequence<u.observedStopSequence||
         (sequence===u.observedStopSequence&&String(u.observedStopId)!==String(stopId)))
         continue;
      const day=serviceDay(u.startDate);
      if(!serviceActive(service,day,calendar))continue;
      const serviceMidnight=Date.parse(day+'T00:00:00-03:00');
      if(!Number.isFinite(serviceMidnight))continue;
      const at=serviceMidnight+(scheduled+u.delaySeconds)*1000;
      if(at<now-30000||at>now+2*3600000)continue;
      const key=u.tripId+'|'+u.startDate+'|'+sequence;
      if(seen.has(key))continue;
      seen.add(key);
      found.push({tripId:u.tripId,routeId:String(rid),stopId:String(stopId),
        stopSequence:sequence,at,delaySeconds:u.delaySeconds,
        source:'SUMOB_GTFS_RT_DELAY_JOIN',
        lastFeedUpdateAt:u.lastFeedUpdateAt});
    }
  }
  found.sort((a,b)=>a.at-b.at||a.routeId.localeCompare(b.routeId));
  return found.slice(0,24);
}
async function loadJSON(url,fetchFn){
  const response=await fetchFn(url,{cache:'force-cache'});
  if(!response.ok)throw Error('TRIP_INDEX_HTTP_'+response.status);
  return response.json();
}
export async function tripDelaysForStop(stopId,updates,{fetchFn=fetch,now=Date.now()}={}){
  if(!/^[0-9]{1,20}$/.test(String(stopId))||!Array.isArray(updates)||
     updates.length>250)throw Error('TRIP_INDEX_BAD_INPUT');
  if(!updates.length)return [];
  const [manifest,index,calendar]=await Promise.all([
    loadJSON(ROOT+'manifest.json',fetchFn),
    loadJSON(ROOT+'rt-trips/index.json',fetchFn),
    loadJSON(ROOT+'arrivals/calendar.json',fetchFn)
  ]);
  if(index.schema!==1||index.buckets!==256||
     index.version!==manifest.gtfsVersion||index.validThrough!==manifest.feedEndDate||
     !calendar.services||!calendar.exceptions)throw Error('TRIP_INDEX_VERSION_MISMATCH');
  const filename=shardForStop(stopId)+'.json.gz';
  const size=index.sizes?.[filename];
  if(!Number.isSafeInteger(size)||size<10||size>4000000)
    throw Error('TRIP_INDEX_BAD_SHARD');
  const response=await fetchFn(ROOT+'rt-trips/'+filename+
    '?v='+encodeURIComponent(index.version),{cache:'force-cache'});
  if(!response.ok)throw Error('TRIP_INDEX_SHARD_HTTP_'+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.byteLength!==size)throw Error('TRIP_INDEX_CORRUPT_SHARD');
  if(bytes[0]!==31||bytes[1]!==139||typeof DecompressionStream==='undefined')
    throw Error('TRIP_INDEX_COMPRESSION_UNSUPPORTED');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const decoded=JSON.parse(await new Response(stream).text());
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))
    throw Error('TRIP_INDEX_BAD_FORMAT');
  const rows=decoded[String(stopId)]||[];
  if(!Array.isArray(rows)||rows.length>8000)throw Error('TRIP_INDEX_BAD_ROWS');
  return projectOfficialDelays(updates,rows,{stopId,calendar,now});
}
