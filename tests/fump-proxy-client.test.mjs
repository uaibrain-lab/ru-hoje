import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProxyMenuUrl,readLiveMenu} from '../public/assets/fump-live.js';
import {getJsonViaPublicProxy} from '../scripts/fump-api.mjs';

const iso='2026-11-16';
const base='https://hub-fump-proxy.example.workers.dev';
const fump='https://fump.ufmg.br:3003/cardapios/cardapio?id=6&dataInicio=2026-11-16&dataFim=2026-11-16';
const fixtures={id:6,cardapios:[{
  data:iso,refeicoes:[{
    tipoRefeicao:'Almoço',
    pratos:[{tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz'}]
  }]
}]};
function fakeResponse(data=fixtures,status=200) {
  return {ok:status>=200 && status<300,status,
    headers:{get:()=> 'application/json'},
    text:async()=>JSON.stringify(data)};
}

test('browser resolve id e data da origem confiável do proxy',()=>{
  const url=new URL(buildProxyMenuUrl('setorial-i',iso,base));
  assert.equal(url.origin,base);
  assert.equal(url.pathname,'/api/menu');
  assert.equal(url.searchParams.get('id'),'6');
  assert.equal(url.searchParams.get('data'),iso);
  assert.equal(new URL(buildProxyMenuUrl('direito',iso,base)).searchParams.get('id'),'2');
});

test('browser recusa proxy com credencial, HTTP ou query estranha',()=>{
  for(const url of [
    'http://localhost:8787',
    'https://user:password@example.workers.dev',
    'https://example.workers.dev/?redirect=https://evil.example',
    'https://example.workers.dev/some-path'
  ]) {
    assert.throws(()=>buildProxyMenuUrl('setorial-i',iso,url),/FUMP_PROXY_URL_INVALID/);
  }
});

test('browser usa endpoint CORS do proxy e mesmo parser da FUMP',async()=>{
  let actual='';
  const result=await readLiveMenu('setorial-i',iso,{
    proxyUrl:base,
    fetchFn:async(url,opts)=>{
      actual=url;
      assert.equal(opts.mode,'cors');
      assert.equal(opts.credentials,'omit');
      assert.equal(opts.cache,'default');
      return fakeResponse();
    }
  });
  assert.equal(new URL(actual).pathname,'/api/menu');
  assert.equal(result.status,'VALID_MENU');
  assert.equal(result.meals.almoco.items[0].name,'Arroz');
});

test('node read-only resolve URLs oficiais apenas em paths do Worker',async()=>{
  let called='';
  const result=await getJsonViaPublicProxy(fump,{
    publicProxyUrl:base,
    fetchFn:async(url)=>{called=url;return fakeResponse();}
  });
  assert.deepEqual(result,fixtures);
  const u=new URL(called);
  assert.equal(u.origin,base);
  assert.equal(u.pathname,'/api/menu');
  assert.equal(u.searchParams.get('id'),'6');
  assert.equal(u.searchParams.get('data'),iso);
});

test('node /restaurantes usa path allowlisted sem aceitar redirect',async()=>{
  let called='';
  const result=await getJsonViaPublicProxy('https://fump.ufmg.br:3003/cardapios/restaurantes',{
    publicProxyUrl:base,
    fetchFn:async(url,opts)=>{
      called=url;
      assert.equal(opts.redirect,'error');
      return fakeResponse([{id:6,nome:'RU Setorial I'}]);
    }
  });
  assert.deepEqual(result,[{id:6,nome:'RU Setorial I'}]);
  assert.equal(new URL(called).pathname,'/api/restaurants');
});

test('node proíbe open proxy, URL de destino arbitrário e protocolo inseguro',async()=>{
  for(const source of [
    'https://evil.example/cardapios/cardapio?id=6&dataInicio=2026-11-16&dataFim=2026-11-16',
    'https://fump.ufmg.br:3003/evil'
  ]) await assert.rejects(getJsonViaPublicProxy(source,{publicProxyUrl:base}),/NOT_ALLOWED/);
  await assert.rejects(getJsonViaPublicProxy(fump,{publicProxyUrl:'http://example.workers.dev'}),/URL_INVALID/);
});

test('node transforma 502 do Worker em erro; não publica dados vazios por falha',async()=>{
  await assert.rejects(getJsonViaPublicProxy(fump,{
    publicProxyUrl:base,
    fetchFn:async()=>fakeResponse({error:'UPSTREAM_HTTP',status:500},502)
  }),/FUMP_PUBLIC_PROXY_HTTP_502/);
});

test('menu servido como stale no cache compartilhado conserva data de coleta e rotulo',async()=>{
  const collectedAt='2026-11-16T15:00:00.000Z';
  const result=await readLiveMenu('setorial-i',iso,{
    proxyUrl:base,
    nowFn:()=>new Date('2026-11-16T16:00:00.000Z'),
    fetchFn:async()=>({
      ok:true,status:200,
      headers:{get:name=>({
        'content-type':'application/json',
        'x-menu-fetched-at':collectedAt,
        'cf-cache-status':'STALE'
      }[name.toLowerCase()]||null)},
      text:async()=>JSON.stringify(fixtures)
    })
  });
  assert.equal(result.status,'VALID_MENU');
  assert.equal(result.cacheStatus,'STALE');
  assert.equal(result.fetchedAt,collectedAt);
  assert.equal(result.meals.almoco.items[0].name,'Arroz');
});
