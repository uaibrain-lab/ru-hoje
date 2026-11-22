import test from 'node:test';
import assert from 'node:assert/strict';
import {shardForStop,serviceActive,scheduledForStop,resetSchedulesForTests} from '../public/assets/municipal-schedules.js';

test('shard do ponto municipal segue hash GTFS 256 partes',()=>{
  const id='14791950';let hash=0;
  for(const ch of id)hash=(hash*31+ch.charCodeAt(0))%256;
  assert.equal(shardForStop(id),hash.toString(16).padStart(2,'0'));
});
test('calendário GTFS respeita serviços ativos e exceções',()=>{
  const calendar={services:{week:{start_date:'20261101',end_date:'20261231',
    monday:'1',tuesday:'1',wednesday:'1',thursday:'1',friday:'1',saturday:'0',sunday:'0'}},
    exceptions:{'20261123':{week:2}}};
  assert.equal(serviceActive('week','2026-11-23',calendar),false);
  assert.equal(serviceActive('week','2026-11-24',calendar),true);
  assert.equal(serviceActive('week','2026-11-22',calendar),false);
  assert.equal(serviceActive('week','2027-01-01',calendar),false);
});
test('horários programados não são chamados de ETA ou GPS',async()=>{
  resetSchedulesForTests();
  const id='14791950',now=Date.parse('2026-11-23T14:00:00Z');
  const version='202611221922',validThrough='20261231';
  const manifest={gtfsVersion:version,feedEndDate:validThrough};
  const index={schema:1,buckets:256,version,validThrough};
  const calendar={services:{weekday:{start_date:'20261101',end_date:'20261231',
    monday:'1',tuesday:'1',wednesday:'1',thursday:'1',friday:'1',saturday:'0',sunday:'0'}},
    exceptions:{}};
  const entries={[id]:[['101','weekday','Centro',[11*3600+30*60,12*3600]],
                         ['901','weekday','Pampulha',[11*3600+45*60]]]};
  const fetched=[];
  const fetchFn=async url=>{
    fetched.push(url);
    const u=new URL(url,'https://example.test');
    if(u.pathname.endsWith('/manifest.json'))return Response.json(manifest);
    if(u.pathname.endsWith('/arrivals/index.json'))return Response.json(index);
    if(u.pathname.endsWith('/arrivals/calendar.json'))return Response.json(calendar);
    if(u.pathname.endsWith('/'+shardForStop(id)+'.json.gz'))
      return new Response(JSON.stringify(entries),{status:200});
    return new Response('missing',{status:404});
  };
  const data=await scheduledForStop(id,{now,fetchFn});
  assert.equal(data.expired,false);
  assert.deepEqual(data.items.slice(0,2).map(x=>[x.code,x.minutes]),[['101',30],['901',45]]);
  assert.ok(!('eta' in data.items[0])&&!('gps' in data.items[0]));
  assert.equal(fetched.filter(x=>x.includes('.json.gz')).length,1);
});
test('GTFS divergente não produz horários fictícios',async()=>{
  resetSchedulesForTests();
  const fetchFn=async url=>Response.json(url.endsWith('manifest.json')
    ?{gtfsVersion:'A',feedEndDate:'20261231'}:
     url.endsWith('index.json')?{schema:1,buckets:256,version:'B',validThrough:'20261231'}:
     {services:{},exceptions:{}});
  await assert.rejects(scheduledForStop('14791950',{fetchFn}),/CATALOGO_GTFS_INCONSISTENTE/);
});
