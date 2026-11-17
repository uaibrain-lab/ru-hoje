import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Fase 3: somente contador de prefetch persiste; pratos e histórico de consultas não são armazenados',()=>{
  const app=read('public/assets/app.js');
  assert.match(app,/const STORAGE_PREFETCH = 'ruhoje:prefetch-quota:v3'/);
  assert.match(app,/const LEGACY_PREFETCH_META = 'ruhoje:prefetch-checks:v2'/);
  assert.match(app,/writeStore\(STORAGE_PREFETCH,JSON\.stringify\(state\.prefetchQuota\)\)/);
  assert.doesNotMatch(app,/Object\.fromEntries\(checks\)|checks:Object\.fromEntries|JSON\.stringify\(state\.liveMenus\)/);
  assert.match(app,/state\.prefetchChecks\.set\(key,\{status,at:Date\.now\(\)\}\)/);
  assert.match(app,/if\(migrated\) persistPrefetchMeta\(\)/);
  assert.match(app,/localStorage\.removeItem\(LEGACY_PREFETCH_META\)/);
  assert.match(app,/Math\.min\(PREFETCH_LIMIT_PER_DAY,Math\.max\(/);
  assert.match(app,/clearLegacyMenuCaches\(\)/);
});

test('Fase 3: só RU selecionado + até três datas abertas para prefetch',()=>{
  const app=read('public/assets/app.js');
  assert.match(app,/futureDays:3,\s*otherFutureDays:0,\s*limit:3/);
  assert.match(app,/\.filter\(task=>sourceForRu\(task\.ruId\)===sourceForRu\(ruId\)/);
  assert.match(app,/!isNonOperatingDay\(task\.iso,ruId\)/);
  assert.match(app,/state\.prefetchQuota\.count>=PREFETCH_LIMIT_PER_DAY/);
  assert.match(app,/prefetchAllowed\(\)/);
  assert.match(app,/if\(consecutiveFailures>=3\) break/);
});

test('Fase 4: negar leitura/escrita legada de cardápio e sync sem alterar autorizações de eventos',()=>{
  const rules=read('firestore.rules');
  for (const path of ['publicMenus/current','menuSyncState/current','menuSyncRequests/current']) {
    const escaped=path.replaceAll('/','\\/');
    assert.match(rules,new RegExp('match /'+escaped+'\\s*\\{\\s*allow read, write: if false;'));
  }
  assert.match(rules,/match \/events\/\{eventId\}/);
  assert.match(rules,/function canJoinCount\(eventId\)/);
  assert.match(rules,/match \/entries\/\{uid\}/);
  assert.match(rules,/match \/resultPrivate\/\{resultId\}/);
  assert.match(rules,/match \/eventProfiles\/\{uid\}/);
  assert.match(rules,/match \/\{document=\*\*\} \{allow read, write: if false;\}/);
  assert.match(read('worker/fump-proxy.mjs'),/if \(request\.method!=='GET'\)/);
});

test('Fase 5: Interno usa Leaflet local, fonte do sistema e URL de tiles OSM conforme política',()=>{
  const interno=read('public/interno/index.html');
  const sw=read('public/service-worker.js');
  const js=read('public/assets/vendor/leaflet-1.9.4.js');
  const css=read('public/assets/vendor/leaflet-1.9.4.css');
  const license=read('public/assets/vendor/LICENSE-LEAFLET');
  assert.match(interno,/href="\/assets\/vendor\/leaflet-1\.9\.4\.css"/);
  assert.match(interno,/src="\/assets\/vendor\/leaflet-1\.9\.4\.js"/);
  assert.doesNotMatch(interno,/cdnjs\.cloudflare\.com|fonts\.googleapis\.com|\{s\}\.tile\.openstreetmap\.org/);
  assert.match(interno,/https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(interno,/tileerror/);
  assert.match(interno,/tileload/);
  assert.match(interno,/id="map-basemap-notice"/);
  assert.match(interno,/OpenStreetMap contributors/);
  assert.match(interno,/route=L\.layerGroup\(\)\.addTo\(map\)/);
  assert.match(interno,/radius:7,/);
  assert.match(sw,/hub-v277-20261117-batch3-5-r1/);
  assert.match(sw,/\/assets\/vendor\/leaflet-1\.9\.4\.js/);
  assert.match(sw,/\/assets\/vendor\/leaflet-1\.9\.4\.css/);
  assert.match(js,/Leaflet 1\.9\.4/);
  assert.match(css,/data:image\/png;base64/);
  assert.doesNotMatch(css,/url\(images\//);
  assert.match(license,/BSD 2-Clause License/);
  assert.match(license,/Copyright \(c\) 2010-2023, Volodymyr Agafonkin/);
});
