import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditLive,isoBrasilia} from '../scripts/hub-live-readonly-probe.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const now=new Date('2026-11-17T13:00:00.000Z');
const mock=async(url,opts)=>{
  assert.equal(opts.method,'GET');
  assert.equal(opts.cache,'no-store');
  const parsed=new URL(url);
  if(parsed.pathname==='/api/menu'){
    const id=parsed.searchParams.get('id');
    return new Response(JSON.stringify({id:Number(id),cardapios:[]}),{
      status:200,headers:{'content-type':'application/json','x-menu-fetched-at':now.toISOString(),'cache-control':'public,max-age=15'}
    });
  }
  return new Response(parsed.pathname==='/service-worker.js'
    ? "const VERSION = 'hub-v277-20261117-batch3-5-r1';"
    : parsed.pathname==='/assets/app.js'
    ? 'function menuFor(date, ruId) { return liveMenuFor(date,ruId); }'
    : '<html>Hub</html>',{status:200});
};

test('Fase 7 (diagnostico): dados oficiais e Hosting podem ser auditados sem Firestore',async()=>{
  const report=await auditLive({fetchFn:mock,now});
  assert.equal(isoBrasilia(now),'2026-11-17');
  assert.equal(report.hostingOk,true);
  assert.equal(report.proxyOk,true);
  assert.equal(report.degraded,false);
  assert.equal(report.readOnly,true);
  assert.equal(report.menus.length,4);
  assert.ok(report.menus.every(x=>x.status==='NOT_PUBLISHED'));
  assert.equal(report.checks.pwa.version,'hub-v277-20261117-batch3-5-r1');
  assert.equal(report.checks.app.officialOnly,true);
  assert.doesNotMatch(read('scripts/hub-live-readonly-probe.mjs'),/firestore\.googleapis\.com|publicMenus\/current|firebase-admin|\.set\(|\.update\(/);
});

test('Fase 7: falha oficial isolada não vira prato fictício nem aciona escrita',async()=>{
  const f=async(url,opts)=>{
    if(String(url).includes('/api/menu?id=6'))
      return new Response('{"error":"UPSTREAM_CONNECT_FAILED"}',{status:503});
    return mock(url,opts);
  };
  const report=await auditLive({fetchFn:f,now});
  assert.equal(report.hostingOk,true);
  assert.equal(report.degraded,true);
  assert.ok(report.menus.some(x=>x.id==='6'&&x.status==='FETCH_ERROR'));
  assert.ok(report.menus.some(x=>x.id==='1'&&x.status==='NOT_PUBLISHED'));
});

test('Fase 8 (primeira camada): backup local verificável e sem segredos',()=>{
  const script=read('scripts/HUB-BACKUP-GIT-LOCAL.ps1');
  assert.match(script,/bundle create \$bundle --all/);
  assert.match(script,/bundle verify \$bundle/);
  assert.match(script,/Get-FileHash -LiteralPath \$bundle -Algorithm SHA256/);
  assert.match(read('scripts/HUB-BATCH-DEPLOY-VERIFICAR.ps1'),/HUB-BACKUP-GIT-LOCAL\.ps1/);
  assert.doesNotMatch(script,/firebase deploy|wrangler deploy|firestore:export/);
});
