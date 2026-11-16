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
  assert.match(app,/readLiveMenu\(ruId,iso,\{/);
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
  assert.match(sw,/hub-v266-20261116-fump-proxy-active-r1/);
  assert.match(html,/app\.js\?v=hub-20261116-proxy-active-r1/);
  assert.match(sw,/url\.pathname === '\/config\.js'/);
});
