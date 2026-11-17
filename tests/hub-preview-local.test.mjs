import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewServer} from '../scripts/preview-local.mjs';
import {buildProxyMenuUrl} from '../public/assets/fump-live.js';

async function withPreview(fetchFn,action){
  const server=createPreviewServer({fetchFn});
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  try{
    return await action('http://127.0.0.1:'+server.address().port);
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
}

test('prévia serve a rota limpa /interno e recursos estáticos sem rede externa',async()=>{
  await withPreview(async()=>{throw new Error('Não deveria consultar rede');},async origin=>{
    const root=await fetch(origin+'/');
    assert.equal(root.status,200);
    assert.match(await root.text(),/Hub UFMG/);
    const interno=await fetch(origin+'/interno');
    assert.equal(interno.status,200);
    assert.match(await interno.text(),/id="sheet"/);
    const legacy=await fetch(origin+'/interno/index.html?legacy=1',{redirect:'manual'});
    assert.equal(legacy.status,302);
    assert.equal(legacy.headers.get('location'),'/interno?legacy=1');
    const config=await (await fetch(origin+'/config.js')).text();
    assert.match(config,/fumpProxyUrl: window\.location\.origin/);
    const script=await fetch(origin+'/assets/fump-live.js');
    assert.equal(script.status,200);
    assert.match(script.headers.get('content-type'),/javascript/);
  });
});

test('prévia encaminha somente FUMP em modo leitura e preserva carimbo original',async()=>{
  const calls=[];
  const stamp='2026-11-17T15:32:00.000Z';
  const fetchFn=async(url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify({id:6,cardapios:[]}),{
      status:200,
      headers:{'Content-Type':'application/json','X-Menu-Fetched-At':stamp}
    });
  };
  await withPreview(fetchFn,async origin=>{
    const valid=await fetch(origin+'/api/menu?id=6&data=2026-11-17');
    assert.equal(valid.status,200);
    assert.equal(valid.headers.get('x-menu-fetched-at'),stamp);
    assert.equal(valid.headers.get('cache-control'),'no-store');
    assert.deepEqual(await valid.json(),{id:6,cardapios:[]});
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://hub-fump-proxy.hubufmg.workers.dev/api/menu?id=6&data=2026-11-17');
    assert.equal(calls[0].options.method,'GET');
    assert.equal(calls[0].options.headers.Origin,undefined);
    for(const suffix of [
      '/api/menu?id=999&data=2026-11-17',
      '/api/menu?id=6&data=2026-02-30',
      '/api/menu?id=6&data=2026-11-17&extra=1',
      '/api/restaurants?foo=bar'
    ]){
      const rejected=await fetch(origin+suffix);
      assert.equal(rejected.status,400,suffix);
    }
    const blocked=await fetch(origin+'/api/menu?id=6&data=2026-11-17',{method:'POST'});
    assert.equal(blocked.status,405);
    assert.equal(calls.length,1,'Inválidos e escritas não chegam ao Worker');
  });
});

test('HTTP proxy é permitido apenas na própria origem local, nunca por terceiros',()=>{
  const old=globalThis.location;
  try{
    globalThis.location={hostname:'127.0.0.1',origin:'http://127.0.0.1:8080',protocol:'http:'};
    assert.equal(buildProxyMenuUrl('setorial-i','2026-11-17','http://127.0.0.1:8080'),
      'http://127.0.0.1:8080/api/menu?id=6&data=2026-11-17');
    assert.throws(()=>buildProxyMenuUrl('setorial-i','2026-11-17','http://127.0.0.1:9999'),/FUMP_PROXY_URL_INVALID/);
    assert.throws(()=>buildProxyMenuUrl('setorial-i','2026-11-17','http://example.com'),/FUMP_PROXY_URL_INVALID/);
    assert.throws(()=>buildProxyMenuUrl('setorial-i','2026-11-17','http://127.0.0.1:8080/path'),/FUMP_PROXY_URL_INVALID/);
    assert.throws(()=>buildProxyMenuUrl('setorial-i','2026-11-17','http://127.0.0.1:8080/?q=x'),/FUMP_PROXY_URL_INVALID/);
    globalThis.location={hostname:'hubufmg.web.app',origin:'https://hubufmg.web.app',protocol:'https:'};
    assert.throws(()=>buildProxyMenuUrl('setorial-i','2026-11-17','http://127.0.0.1:8080'),/FUMP_PROXY_URL_INVALID/);
    assert.match(buildProxyMenuUrl('setorial-i','2026-11-17','https://hub-fump-proxy.hubufmg.workers.dev'),/^https:/);
  }finally{
    if(old===undefined)delete globalThis.location;
    else globalThis.location=old;
  }
});
