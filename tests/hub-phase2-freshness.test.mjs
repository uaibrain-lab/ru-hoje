import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isNonOperatingDay} from '../public/assets/date-availability.js';
import {freshMenuTimestamp,MAX_MENU_FRESHNESS_MS} from '../public/assets/fump-live.js';

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Fase 2: relógio da consulta impõe limite de 60s com margem mínima de 10s',()=>{
  const now=Date.parse('2026-11-17T12:00:00.000Z');
  assert.equal(MAX_MENU_FRESHNESS_MS,70_000);
  assert.equal(freshMenuTimestamp(new Date(now-60_000).toISOString(),now),true);
  assert.equal(freshMenuTimestamp(new Date(now-70_001).toISOString(),now),false);
  assert.equal(freshMenuTimestamp(new Date(now+11_000).toISOString(),now),false);
  assert.equal(freshMenuTimestamp(null,now),false);
});

test('Fase 2: Worker não estende o TTL nem habilita contingência stale-if-error',()=>{
  const worker=source('worker/fump-proxy.mjs');
  assert.match(worker,/const seconds=isRestaurants \? 1800 : \(raw\.cardapios\.length \? 60 : 15\);/);
  assert.match(worker,/ageMs<cacheSeconds\*1000/);
  assert.match(worker,/Math\.floor\(\(cacheSeconds\*1000-ageMs\)\/1000\)/);
  assert.ok(!worker.includes('stale-if-error'));
  assert.match(worker,/await cache\.delete\?\.\(cacheKey\)/);
  assert.match(worker,/if \(request\.method!=='GET'\)/);
});

test('Fase 2: navegador evita cache HTTP e revalida por RU e data de forma limitada',()=>{
  const app=source('public/assets/app.js');
  const client=source('public/assets/fump-live.js');
  assert.match(app,/const minimumGapMs=force && !background \? 30_000 : 60_000/);
  assert.match(app,/now-\(state\.liveChecks\.get\(key\) \|\| 0\) < minimumGapMs/);
  assert.match(client,/const incoming=await fetchOnce\(url,fetchFn,timeoutMs,'no-store'\)/);
  assert.match(client,/FUMP_RESPONSE_STALE_OR_UNVERIFIED/);
  assert.match(client,/freshMenuTimestamp\(value\.fetchedAt\)/);
  assert.match(app,/PREFETCH_LIMIT_PER_DAY/);
  assert.match(app,/const LEGACY_MENU_KEYS = \[/);
});

test('Bolinhas indicam apenas dias de RU sem atendimento regular, independente do cardápio',()=>{
  const app=source('public/assets/app.js');
  const date=source('public/assets/date-availability.js');
  assert.ok(!app.includes('data-missing-menu'));
  assert.match(app,/card\.dataset\.noRegularService = String\(withoutService\)/);
  assert.match(app,/nonOperatingDayForDate\(iso,state\.selectedRu\)/);
  assert.match(date,/return hoursFor\(restaurantId,iso\)\.length===0/);
  for(const ru of ['setorial-i','setorial-ii','saude','direito','ica']) {
    assert.equal(isNonOperatingDay('2026-11-17',ru),false,ru);
    assert.equal(isNonOperatingDay('2026-11-22',ru),true,ru);
  }
  assert.equal(isNonOperatingDay('2026-11-21','setorial-i'),false);
  assert.equal(isNonOperatingDay('2026-11-21','setorial-ii'),true);
});


test('Fase 2: cache automático da Cloudflare desligado para evitar dupla camada de HIT',()=>{
  const config=source('worker/wrangler.toml');
  const worker=source('worker/fump-proxy.mjs');
  assert.match(config,/\[cache\]\s*enabled = false/);
  assert.match(worker,/cache=globalThis\.caches\?\.default/);
  assert.match(worker,/await cache\.match\(cacheKey\)/);
  assert.match(worker,/X-Menu-Fetched-At/);
});
