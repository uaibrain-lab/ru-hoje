import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,mkdir,writeFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {modeFromSearch,validExternoManifest,localServiceDay} from '../public/assets/onibus.js';
import {validateExternoPackage} from '../scripts/stage-externo.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'..');
const read=async p=>readFile(path.join(ROOT,p),'utf8');

test('a aba Ônibus substitui Interno sem acrescentar quinta aba no Hub',async()=>{
  const html=await read('public/index.html');
  assert.match(html,/id="tab-interno"[^>]*aria-controls="interno-page"/);
  assert.doesNotMatch(html,/id="onibus-filter-interno"/);
  assert.doesNotMatch(html,/id="onibus-filter-externo"/);
  assert.doesNotMatch(html,/id="onibus-back-interno"/);
  assert.doesNotMatch(html,/id="onibus-empty-title"/);
  const interno=await read('public/interno/index.html');
  assert.match(interno,/data-line-filter-mode/);
  assert.match(interno,/id="map-filter-toggle"/);
  assert.match(interno,/data-current-filter="all"/);
  assert.match(interno,/FILTER_MODES=\['all','internal','external'\]/);
  assert.match(interno,/external:'Municipais'/);
  assert.ok(interno.indexOf("Internos <small>")<interno.indexOf("Municipais <small>"));
  assert.doesNotMatch(interno,/data-map-mode="external"/);
  assert.doesNotMatch(interno,/>Externos|>Externas/);
  assert.match(interno,/hub:onibus:unified-selection/);
  assert.match(interno,/function municipalStopView\(/);
  assert.match(interno,/function municipalLineView\(/);
  assert.match(interno,/function openMunicipal\(/);
  assert.match(interno,/id="map-point-legend"/);
  assert.match(interno,/role="group" aria-label="Filtrar linhas por origem"/);
  assert.match(interno,/data-line-filter-mode/);
  assert.match(interno,/radius:7/);
  assert.match(interno,/radius:5.5,color:'#7556c9'/);
  assert.match(interno,/lines-filter-in-sheet/);
  assert.match(interno,/visibility:hidden;opacity:0;pointer-events:none/);
  assert.match(interno,/Municipais BH:/);
  assert.match(interno,/class="gps-bus-shape"/);
  assert.match(interno,/if\(mapMode==='internal'&&map\.hasLayer\(busPins\)\)map\.removeLayer\(busPins\)/);
  assert.match(interno,/Number\(v\.heading\)/);
  assert.doesNotMatch(interno,/function favRows\(/);
  assert.match(interno,/function starRow\(/);
  assert.match(interno,/hub_onibus_linhas_favoritas_v1/);
  assert.match(interno,/hub_onibus_pontos_bh_favoritos_v1/);
  assert.match(html,/<span>Ônibus<\/span>/);
  assert.equal((html.match(/id="tab-(menu|interno|festas|sobre)"/g)||[]).length,4);
  assert.match(html,/id="interno-frame"[^>]*src="\/interno"/);
  assert.doesNotMatch(html,/id="externo-frame"/);
  assert.equal((html.match(/id="interno-frame"/g)||[]).length,1);
  assert.match(html,/id="interno-frame"[^>]*title="Ônibus — pontos e linhas internas e municipais"/);
});

test('links canônicos e legados preservam filtro sem falsificar tipo',async()=>{
  assert.equal(modeFromSearch('?aba=onibus&tipo=externo'),'externo');
  assert.equal(modeFromSearch('?aba=interno'),'interno');
  assert.equal(modeFromSearch('?tipo=desconhecido'),'interno');
  const module=await read('public/assets/onibus.js');
  assert.ok(module.includes("type:FOCUS_STOP"));
  assert.ok(module.includes("type:FOCUS_LINE"));
  assert.ok(module.includes("hub:onibus:unified-selection"));
  assert.ok(module.includes("if(stop&&/^[0-9]{1,20}$/.test(stop))"));
  assert.ok(module.includes("if($('onibus-interno'))$('onibus-interno').hidden=false"));
  assert.ok(!module.includes("frame.loading='eager'"));
});

test('manifest GTFS municipal é validado antes de montar o catálogo local',()=>{
  const sample={gtfsVersion:'202611161919',routes:326,stops:9925,stopTimeRows:6691004,
    feedStartDate:'20261101',feedEndDate:'20261231'};
  assert.ok(validExternoManifest(sample,'20261122'));
  assert.ok(!validExternoManifest(sample,'20270101'));
  assert.ok(!validExternoManifest({...sample,routes:0},'20261122'));
  assert.ok(!validExternoManifest({...sample,feedEndDate:'invalid'},'20261122'));
  assert.ok(!validExternoManifest({...sample,stopTimeRows:0},'20261122'));
  assert.equal(localServiceDay(new Date('2026-11-23T01:00:00Z')),'20261122');
});

test('o SW do Hub não intercepta nem substitui /externo pelo RU',async()=>{
  const sw=await read('public/service-worker.js');
  assert.match(sw,/url\.pathname==='\/externo' \|\| url\.pathname\.startsWith\('\/externo\/'\)/);
  assert.ok(!sw.includes("'/externo', '/index.html'"));
  const js=await read('public/assets/festas.js');
  assert.match(js,/activateOnibus\(\)/);
  assert.match(js,/if\(name==='onibus'\)return 'interno'/);
  const app=await read('public/assets/app.js');
  assert.ok(app.includes("!['interno','onibus','festas','sobre'].includes(initialTab)"));
});

async function fixture(action){
  const dir=await mkdtemp(path.join(os.tmpdir(),'hub-externo-qa-'));
  try{
    const required=['index.html','app.js','style.css','hub-parity.css','static-bus.js',
     'static-arrivals.js','service-worker.js','gps-config.json',
     'catalog/manifest.json','catalog/routes.json','catalog/stops.json','catalog/patterns.json',
     'catalog/shapes.json','catalog/metro.json','catalog/arrivals/index.json','catalog/arrivals/calendar.json',
     'hub-v1-build.json','hub-v1-qa.json'];
    for(const relative of required){
      const f=path.join(dir,relative);
      await mkdir(path.dirname(f),{recursive:true});
      await writeFile(f,'{}');
    }
    await writeFile(path.join(dir,'index.html'),
      '<html data-app-mode="free-static"><button id="quick-rotas" hidden disabled>Rotas</button></html>');
    await writeFile(path.join(dir,'gps-config.json'),JSON.stringify({
      enabled:true,provider:'gtfs_rt',refreshSeconds:45,
      endpoint:'https://externo-bh-gps-free.hubufmg.workers.dev/api/gps'}));
    await writeFile(path.join(dir,'hub-v1-build.json'),JSON.stringify({
      gtfsVersion:'fixture',validThrough:'20261231',scheduledStops:2,shards:256,
      routingEnabled:false,metropolitanEnabled:false,gpsEnabled:true}));
    await writeFile(path.join(dir,'hub-v1-qa.json'),JSON.stringify({
      schema:1,status:'passed',scope:'municipal-bh-and-metro',
      sourceSha256:'a'.repeat(64),validatedServiceDate:'20261122',
      gtfsVersion:'fixture',validThrough:'20261231',routes:2,shards:256,scheduledStops:2,
      routingEnabled:false,metropolitanEnabled:false,gpsEnabled:true,
      gpsProvider:'gtfs_rt',gpsProbePassed:true,
      gpsProbeCheckedAtUtc:'2026-11-22T17:00:00Z',
      gpsRecentPositionsObserved:2}));
    await writeFile(path.join(dir,'catalog/manifest.json'),JSON.stringify({
      gtfsVersion:'fixture',routes:2,stops:2,stopTimeRows:4,
      feedStartDate:'20260101',feedEndDate:'20261231'}));
    const sizes={};
    for(let i=0;i<256;i++){
      const name=i.toString(16).padStart(2,'0')+'.json.gz';
      const data=Buffer.from([31,139,8,0,0,0,0,0,0,3]);
      await writeFile(path.join(dir,'catalog/arrivals',name),data);
      sizes[name]=data.byteLength;
    }
    await writeFile(path.join(dir,'catalog/arrivals/index.json'),JSON.stringify({
      schema:1,buckets:256,version:'fixture',validThrough:'20261231',
      stopCount:2,sizes}));
    return await action(dir);
  }finally{await rm(dir,{recursive:true,force:true});}
}

test('staging aceita apenas pacote completo de homologação municipal',async()=>{
  await fixture(async dir=>{
    const r=await validateExternoPackage(dir,'20261122');
    assert.equal(r.scheduledStops,2);
    assert.equal(r.gtfsVersion,'fixture');
  });
});

test('staging rejeita GPS desligado, arquivo ausente e GTFS vencido',async()=>{
  await fixture(async dir=>{
    await writeFile(path.join(dir,'gps-config.json'),'{"enabled":false}');
    await assert.rejects(validateExternoPackage(dir,'20261122'),/LIVE_GPS_REQUIRED/);
    await writeFile(path.join(dir,'gps-config.json'),JSON.stringify({
      enabled:true,provider:'gtfs_rt',refreshSeconds:45,
      endpoint:'https://externo-bh-gps-free.hubufmg.workers.dev/api/gps'}));
    await rm(path.join(dir,'catalog/arrivals/ff.json.gz'));
    await assert.rejects(validateExternoPackage(dir,'20261122'),/BUCKET_MISSING_OR_CORRUPT/);
    await assert.rejects(validateExternoPackage(dir,'20270101'),/GTFS_NOT_CURRENT/);
  });
});

test('staging rejeita versão incompatível do índice mesmo quando existem 256 arquivos',async()=>{
  await fixture(async dir=>{
    const location=path.join(dir,'catalog/arrivals/index.json');
    const data=JSON.parse(await readFile(location,'utf8'));
    data.version='stale';
    await writeFile(location,JSON.stringify(data));
    await assert.rejects(validateExternoPackage(dir,'20261122'),/ARRIVALS_INDEX_MISMATCH/);
  });
});

test('staging bloqueia pacote sem comprovação de QA oficial',async()=>{
  await fixture(async dir=>{
    const pathToQa=path.join(dir,'hub-v1-qa.json');
    await rm(pathToQa);
    await assert.rejects(validateExternoPackage(dir,'20261122'),/REQUIRED_FILE_INVALID/);
    await writeFile(pathToQa,JSON.stringify({schema:1,status:'blocked',scope:'municipal-bh-and-metro'}));
    await assert.rejects(validateExternoPackage(dir,'20261122'),/QA_NOT_APPROVED/);
  });
});

test('staging rejeita pacote sem prova recente do feed GPS SUMOB',async()=>{
  await fixture(async dir=>{
    const file=path.join(dir,'hub-v1-qa.json');
    const qa=JSON.parse(await readFile(file,'utf8'));
    qa.gpsRecentPositionsObserved=0;
    await writeFile(file,JSON.stringify(qa));
    await assert.rejects(validateExternoPackage(dir,'20261122'),/QA_NOT_APPROVED/);
  });
});
