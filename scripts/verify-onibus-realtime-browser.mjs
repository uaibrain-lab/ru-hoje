/**
 * End-to-end integration of the ACTUAL SUMOB delay payload with a real
 * GTFS trip from the staged municipal catalog.
 *
 * Only the public Worker response is simulated. GTFS files, stop/route/trip
 * and timetable data are those shipped in the complete Hub preview bundle.
 * The test chooses a Monday service from the real catalog to remain
 * deterministic even when CI runs at night or on a Sunday.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {serviceActive,shardForStop} from '../public/assets/municipal-schedules.js';

const origin=process.env.HUB_QA_URL||'http://127.0.0.1:8765/';
const stopId='14791950';
const date='2026-11-23',startDate='20261123';
const root=new URL('../public/externo/catalog/',import.meta.url);
const file=async name=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const [routes,calendar,patterns,index]=await Promise.all([
  file('routes.json'),file('arrivals/calendar.json'),
  file('patterns.json'),file('rt-trips/index.json')
]);
assert.equal(index.schema,1);
const serving=new Set(patterns.filter(p=>p.stops?.includes(stopId)).map(p=>String(p.route)));
const name=shardForStop(stopId)+'.json.gz';
assert.ok(Number.isInteger(index.sizes[name]));
const bytes=await readFile(new URL('rt-trips/'+name,root));
assert.equal(bytes.length,index.sizes[name]);
const rows=JSON.parse(gunzipSync(bytes).toString('utf8'))[stopId];
assert.ok(Array.isArray(rows)&&rows.length>0);
const routeMap=new Map(routes.map(r=>[String(r.id),r]));
const matching=rows.find(([tripId,routeId,service,sequence,scheduled,start])=>
  routeMap.has(String(routeId))&&serving.has(String(routeId))&&
  serviceActive(service,date,calendar)&&sequence>=1&&
  scheduled>=9*3600&&scheduled<17*3600&&start>=0&&start<48*3600
);
assert.ok(matching,'Nenhuma viagem válida da parada disponível para o ensaio E2E');
const [tripId,routeId,service,sequence,scheduled,start]=matching;
const routeCode=String(routeMap.get(String(routeId)).code);
const clock=seconds=>[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60]
  .map(v=>String(v).padStart(2,'0')).join(':');
const serviceMidnight=Date.parse(date+'T00:00:00-03:00');
// ETA = scheduled +120s; test "now" is scheduled -120s => four minutes.
const fakeNow=serviceMidnight+(scheduled-120)*1000;
const expectedAt=serviceMidnight+(scheduled+120)*1000;
const etaClock=new Date(expectedAt).toLocaleTimeString('pt-BR',{
  timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'
});
const relative={
  tripId:String(tripId),routeId:routeCode,startDate,
  startTime:clock(start),observedStopId:stopId,
  observedStopSequence:sequence,delaySeconds:120,
  lastFeedUpdateAt:new Date(fakeNow-10000).toISOString()
};
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:860},
    serviceWorkers:'block'});
  await page.clock.install({time:new Date(fakeNow)});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let workerCalls=0;
  const api='https://externo-bh-gps-free.hubufmg.workers.dev';
  await page.route(api+'/api/arrivals?stop=*',route=>{
    workerCalls++;
    const url=new URL(route.request().url());
    assert.equal(url.searchParams.get('stop'),stopId);
    assert.ok((url.searchParams.get('routes')||'').split(',').includes(routeCode),
      'O Hub deve pedir o código público da linha, e não route_id numérico');
    return route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*'},
      body:JSON.stringify({
        available:true,source:'SUMOB_GTFS_RT_TRIP_UPDATES',stopId,
        fetchedAt:new Date(fakeNow).toISOString(),
        feedTimestamp:new Date(fakeNow).toISOString(),
        items:[],relativeUpdates:[relative]
      })});
  });
  await page.route(api+'/api/alerts?*',route=>route.fulfill({
    status:503,contentType:'application/json',
    headers:{'Access-Control-Allow-Origin':'*'},
    body:JSON.stringify({available:false,error:'ALERTS_UNAVAILABLE'})
  }));
  await page.goto(new URL('?aba=onibus&tipo=externo&ponto='+stopId,origin),{
    waitUntil:'domcontentloaded',timeout:30000});
  const frame=page.frameLocator('#interno-frame');
  const live=frame.locator('#municipal-stop-realtime:not([hidden])');
  await live.waitFor({timeout:25000});
  const rendered=await frame.locator('#municipal-realtime-rows').innerText();
  assert.match(rendered,new RegExp(routeCode.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(rendered,/GTFS \+ atraso informado pela SUMOB/);
  assert.ok(rendered.includes(etaClock),'Hora GTFS + atraso incorreta: '+rendered);
  assert.ok(workerCalls>=1);
  assert.deepEqual(errors,[],'Erros JavaScript durante junção SUMOB-GTFS');

  // Next real-time response contains no usable delay; stale ETA disappears.
  await page.unroute(api+'/api/arrivals?stop=*');
  await page.route(api+'/api/arrivals?stop=*',route=>route.fulfill({
    status:200,contentType:'application/json',
    headers:{'Access-Control-Allow-Origin':'*'},
    body:JSON.stringify({available:true,source:'SUMOB_GTFS_RT_TRIP_UPDATES',
      stopId,fetchedAt:new Date(fakeNow).toISOString(),
      feedTimestamp:new Date(fakeNow).toISOString(),
      items:[],relativeUpdates:[]})
  }));
  await frame.locator('body').evaluate(()=>document.dispatchEvent(
    new Event('visibilitychange')));
  await live.waitFor({state:'hidden',timeout:15000});
  assert.equal(await frame.locator('#municipal-stop-schedules').isVisible(),true,
    'Horários programados desapareceram ao perder o ETA');
  assert.deepEqual(errors,[],'Falha ao voltar ao horário de tabela');
  console.log('HUB_SUMOB_REAL_GTFS_JOIN_BROWSER_OK',JSON.stringify({
    stopId,routeCode,routeId,service,serviceDate:startDate,
    expectedETA:etaClock,workerCalls
  }));
}finally{
  await browser.close();
}
