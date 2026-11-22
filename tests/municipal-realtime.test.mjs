import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {projectOfficialDelays,tripDelaysForStop} from '../public/assets/municipal-realtime.js';
import {shardForStop} from '../public/assets/municipal-schedules.js';

const stop='14791950';
const now=Date.parse('2026-11-23T18:58:00-03:00');
const minutes=h=>h*60*1000;
const cal={exceptions:{},services:{
  '307679':{start_date:'20240101',end_date:'20261231',
    monday:'1',tuesday:'1',wednesday:'1',thursday:'1',friday:'1',
    saturday:'0',sunday:'0'}
}};
const row=['T-51','562134','307679',16,19*3600+7*60,19*3600];
const upstream=(override={})=>({
  routeId:'562134',tripId:'T-51',startDate:'20261123',startTime:'19:00:00',
  observedStopId:'14780000',observedStopSequence:12,
  delaySeconds:120,lastFeedUpdateAt:new Date(now-8000).toISOString(),
  ...override
});

test('atraso oficial é somado à viagem e ponto exatos, jamais à linha genérica',()=>{
  const out=projectOfficialDelays([upstream()],[row],{stopId:stop,calendar:cal,now});
  assert.equal(out.length,1);
  assert.equal(out[0].at,Date.parse('2026-11-23T19:09:00-03:00'));
  assert.equal(out[0].source,'SUMOB_GTFS_RT_DELAY_JOIN');
  assert.equal(out[0].delaySeconds,120);
  assert.equal(projectOfficialDelays([upstream({delaySeconds:-60})],[row],
    {stopId:stop,calendar:cal,now})[0].at,
    Date.parse('2026-11-23T19:06:00-03:00'));
});
test('percurso errado, serviço inativo, data antiga e trip_id diferente não geram chegada',()=>{
  const scenarios=[
    upstream({routeId:'562165'}),upstream({tripId:'another'}),
    upstream({startTime:'18:00:00'}),upstream({startDate:'20261122'}),
    upstream({observedStopSequence:17}),
    upstream({lastFeedUpdateAt:new Date(now-minutes(4)).toISOString()}),
    upstream({delaySeconds:99999}),upstream({observedStopId:'../../bad'})
  ];
  for(const item of scenarios){
    assert.deepEqual(projectOfficialDelays([item],[row],{stopId:stop,calendar:cal,now}),[]);
  }
  assert.deepEqual(projectOfficialDelays([upstream()],[['T-51','562134','307680',16,68820,68400]],
    {stopId:stop,calendar:cal,now}),[]);
});
test('duas passagens pelo ponto permanecem distintas por stop_sequence',()=>{
  const times=[
    ['T-51','562134','307679',16,19*3600+7*60,19*3600],
    ['T-51','562134','307679',29,19*3600+25*60,19*3600]
  ];
  const result=projectOfficialDelays([upstream()],times,{stopId:stop,calendar:cal,now});
  assert.equal(result.length,2);
  assert.notEqual(result[0].stopSequence,result[1].stopSequence);
  const current=projectOfficialDelays([upstream({observedStopId:stop,observedStopSequence:29})],times,
    {stopId:stop,calendar:cal,now});
  assert.equal(current.length,1);
  assert.equal(current[0].stopSequence,29);
});
test('carrega apenas 1 shard GTFS da parada e rejeita versão inconsistente',async()=>{
  const data=JSON.stringify({[stop]:[row]});
  const packed=gzipSync(Buffer.from(data));
  const manifest={gtfsVersion:'202611221922',feedEndDate:'20261231'};
  const index={schema:1,buckets:256,version:manifest.gtfsVersion,
    validThrough:manifest.feedEndDate,sizes:{[shardForStop(stop)+'.json.gz']:packed.byteLength}};
  const files={
    '/externo/catalog/manifest.json':manifest,
    '/externo/catalog/rt-trips/index.json':index,
    '/externo/catalog/arrivals/calendar.json':cal
  };
  const paths=[];
  const fetchFn=async url=>{
    const path=String(url).split('?')[0];paths.push(path);
    if(path.endsWith('.json.gz'))return new Response(packed,{status:200});
    if(!(path in files))return new Response('missing',{status:404});
    return new Response(JSON.stringify(files[path]),{status:200,
      headers:{'Content-Type':'application/json'}});
  };
  const got=await tripDelaysForStop(stop,[upstream()],{now,fetchFn});
  assert.equal(got.length,1);
  assert.equal(paths.length,4);
  assert.ok(paths[3].endsWith(shardForStop(stop)+'.json.gz'));
  index.version='outdated';
  await assert.rejects(()=>tripDelaysForStop(stop,[upstream()],{now,fetchFn}),
    /VERSION_MISMATCH/);
});
