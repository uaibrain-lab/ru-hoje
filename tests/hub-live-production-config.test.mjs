import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildProxyMenuUrl,sourceForRu} from '../public/assets/fump-live.js';
import {getJsonViaPublicProxy,menuUrl} from '../scripts/fump-api.mjs';

const base='https://hub-fump-proxy.hubufmg.workers.dev';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('Hub de produção aponta para Worker verificado e possui módulo de consulta via proxy',()=>{
  const config=read('../public/config.js');
  assert.match(config,/firebaseProjectId:\s*"hubufmg"/);
  assert.ok(config.includes('fumpProxyUrl: "'+base+'"'));
  const app=read('../public/assets/app.js');
  assert.match(app,/proxyUrl=window\.RU_CONFIG\?\.fumpProxyUrl/);
  assert.match(app,/readLiveMenu\(ruId,iso, background/);
  assert.match(app,/startPrefetch\(ruId,iso\)/);
  assert.equal(sourceForRu('setorial-i'),'6');
  assert.equal(new URL(buildProxyMenuUrl('setorial-i','2026-11-16',base)).hostname,'hub-fump-proxy.hubufmg.workers.dev');
});

test('GitHub scheduled sync uses same verified proxy without requiring manually created variable',()=>{
  const yaml=read('../.github/workflows/hub-production-cardapios.yml');
  assert.ok(yaml.includes('vars.FUMP_PUBLIC_PROXY_URL || \''+base+'\''));
  assert.ok(read('../scripts/fump-api.mjs').includes('process.env.FUMP_PUBLIC_PROXY_URL'));
});

test('service worker changes version and HTML app URL to avoid stale code',()=>{
  const sw=read('../public/service-worker.js');
  const html=read('../public/index.html');
  assert.match(sw,/hub-v274-20261117-fump-only-r1/);
  assert.match(html,/app\.js\?v=hub-20261117-fump-only-r1/);
  assert.ok(sw.includes("path==='/config.js'"));
  assert.match(sw,/cache:'no-store'/);
  assert.match(sw,/path\.endsWith\('\.js'\)/);
  assert.match(sw,/fump-prefetch\.js/);
  const app=read('../public/assets/app.js');
  assert.ok(!app.includes('Abrir resposta oficial deste RU/data'));
  assert.ok(!app.includes("const direct = el('a','source-link'"));
  
  assert.match(app,/register\('\/service-worker\.js',\{updateViaCache:'none'\}\)/);
  assert.match(app,/addEventListener\('controllerchange'/);
  const hosting=JSON.parse(read('../firebase.json'));
  assert.ok(hosting.hosting.headers.some(x=>x.source==='**/*.js' && x.headers.some(h=>h.key==='Cache-Control' && /no-cache/.test(h.value))));
});

test('atualizacao FUMP por acesso nao requer cron GitHub nem exibe ausencia sem verificacao',()=>{
  const core=read('../public/assets/app.js');
  assert.match(core,/function missingMenuForDate\(iso,ruId\)/);
  assert.match(core,/return needsMenuDot\(null,iso,ruId,!!liveMenuFor\(iso,ruId\)\)/);
  assert.ok(!core.includes('A consulta à FUMP não retornou pratos nesta data. Isso não confirma que o RU esteja fechado.'));
  assert.match(core,/if \(!force && now-\(state\.liveChecks\.get\(key\) \|\| 0\) < 4\*60_000\) return \{status:'SKIPPED'\}/);
  assert.match(core,/refreshLive\(\{force:true\}\)/);
  const wf=[
    'hub-production-cardapios.yml',
    'hub-production-request-processor.yml',
    'hub-production-watchdog.yml',
    'sync-cardapios.yml'
  ];
  for(const filename of wf){
    const yaml=read('../.github/workflows/'+filename);
    assert.ok(!/^  schedule:/m.test(yaml),'Cron de cardápios inesperado: '+filename);
    assert.ok(yaml.includes('workflow_dispatch:'),'Diagnóstico manual indisponível: '+filename);
  }
  assert.match(read('../.github/workflows/hub-production-cardapios.yml'),/HUB_HOSTING_AUTO_DEPLOY_ENABLED/);
  const workerCfg=read('../worker/wrangler.toml');
  assert.match(workerCfg,/\[placement\]\s*region = "gcp:southamerica-east1"/);
  assert.match(workerCfg,/\[cache\]\s*enabled = true/);
  // Vary: Origin precisa continuar presente para evitar cache CORS incorreto.
  const worker=read('../worker/fump-proxy.mjs');
  assert.ok(worker.includes("'Vary':'Origin'"));
  assert.ok(worker.includes("'Cache-Control',cacheSeconds ?"));

});
