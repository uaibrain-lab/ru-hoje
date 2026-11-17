import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Service Worker mantém Leaflet no CORE: mapa offline não depende de carregamento opcional',()=>{
  const sw=read('public/service-worker.js');
  const core=sw.match(/const CORE = \[([\s\S]*?)\];/)?.[1];
  assert.ok(core,'CORE precisa existir');
  assert.match(core,/\/assets\/vendor\/leaflet-1\.9\.4\.js/);
  assert.match(core,/\/assets\/vendor\/leaflet-1\.9\.4\.css/);
  assert.match(sw,/await cache\.addAll\(CORE\)/);
  assert.match(sw,/const VERSION = 'hub-v\d+-\d{8}-[a-z0-9-]+'/);
});

test('Hosting não publica snapshot estático obsoleto da FUMP',()=>{
  const config=JSON.parse(read('firebase.json'));
  assert.ok(config.hosting.ignore.includes('data/cardapios.json'));
  assert.ok(!read('public/service-worker.js').includes("'/data/cardapios.json'"));
  const app=read('public/assets/app.js');
  assert.ok(!app.includes('/data/cardapios.json'));
  assert.ok(!app.includes('publicMenus/current'));
  // Ingredientes auxiliares não determinam o cardápio oficial e permanecem.
  assert.ok(!config.hosting.ignore.includes('data/pratos-ingredientes.json'));
});

test('Backup secundário opcional usa destino absoluto e verifica hash + restauração',()=>{
  const backup=read('scripts/HUB-BACKUP-GIT-LOCAL.ps1');
  assert.match(backup,/\[string\]\$DestinoSecundario = ""/);
  assert.match(backup,/IsPathRooted\(\$DestinoSecundario\)/);
  assert.match(backup,/DESTINO_SECUNDARIO_IGUAL_AO_PRIMARIO/);
  assert.match(backup,/BACKUP_SECUNDARIO_JA_EXISTE/);
  assert.match(backup,/Copy-Item -LiteralPath \$bundle -Destination \$copy/);
  assert.match(backup,/Copy-Item -LiteralPath \$manifest -Destination \$copyManifest/);
  assert.match(backup,/BACKUP_SECUNDARIO_SHA256_DIVERGENTE/);
  assert.match(backup,/verify-hub-bundle\.mjs" --bundle \$copy/);
  assert.doesNotMatch(backup,/firebase-admin|\.collection\(|firestore:export/);
});

test('Deploy único republica Worker+Cron, só então Hosting+Rules, sem tocar sorteios',()=>{
  const script=read('scripts/HUB-BATCH-DEPLOY-VERIFICAR.ps1');
  const a=script.indexOf('wrangler deploy --config worker/wrangler.toml');
  const b=script.indexOf('WORKER_ALLOWLIST_NAO_VALIDADO');
  const c=script.indexOf('firebase-tools@15.22.1 deploy --only');
  assert.ok(a>=0 && b>a && c>b);
  assert.match(script,/HUB_BACKUP_SECONDARY_PATH/);
  assert.match(script,/WORKER_RESPOSTA_INESPERADA/);
  assert.match(script,/WORKER_CORS_NAO_VALIDADO/);
  assert.match(script,/HUB_BATCH_FASES_3_4_5_PUBLICADO_E_VERIFICADO/);
  assert.doesNotMatch(script,/run-raffles-production|PRIVATE_KEY_JWK|--only functions/);
  const wf=read('.github/workflows/hub-production-raffles.yml');
  assert.match(wf,/cron: '10 21 \* \* 3-5'/);
  assert.match(wf,/vars.HUB_PROD_RAFFLES_ENABLED == 'true'/);
});
