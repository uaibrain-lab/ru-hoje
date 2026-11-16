import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFumpRelayRequest,getJsonViaRelay} from '../scripts/fump-api.mjs';

const date='2026-11-16';
const relayUrl='https://script.google.com/macros/s/AKfycbxExample/exec';
const relayToken='a'.repeat(64);

test('maps only the official restaurant-list endpoint to a relay resource',()=>{
  assert.deepEqual(buildFumpRelayRequest('https://fump.ufmg.br:3003/cardapios/restaurantes'),{resource:'restaurants'});
});

test('maps allowed RU/date menu requests to a constrained relay resource',()=>{
  assert.deepEqual(
    buildFumpRelayRequest(`https://fump.ufmg.br:3003/cardapios/cardapio?id=6&dataInicio=${date}&dataFim=${date}`),
    {resource:'menu',id:'6',date}
  );
});

test('rejects arbitrary hosts, paths, ids and multi-date ranges',()=>{
  assert.throws(()=>buildFumpRelayRequest('https://evil.example:3003/cardapios/restaurantes'),/TARGET_NOT_ALLOWED/);
  assert.throws(()=>buildFumpRelayRequest('https://fump.ufmg.br:3003/admin'),/PATH_NOT_ALLOWED/);
  assert.throws(()=>buildFumpRelayRequest(`https://fump.ufmg.br:3003/cardapios/cardapio?id=9&dataInicio=${date}&dataFim=${date}`),/RU_NOT_ALLOWED/);
  assert.throws(()=>buildFumpRelayRequest('https://fump.ufmg.br:3003/cardapios/cardapio?id=6&dataInicio=2026-11-16&dataFim=2026-11-17'),/DATE_RANGE_NOT_ALLOWED/);
});

test('relay client POSTs token in the body and returns only the upstream JSON payload',async()=>{
  let received;
  const payload={id:6,nome:'RU Setorial I',cardapios:[]};
  const data=await getJsonViaRelay(
    `https://fump.ufmg.br:3003/cardapios/cardapio?id=6&dataInicio=${date}&dataFim=${date}`,
    {
      relayUrl,relayToken,timeoutMs:5000,
      fetchFn:async(url,options)=>{
        received={url,options};
        return new Response(JSON.stringify({ok:true,version:1,data:payload}),{
          status:200,headers:{'Content-Type':'application/json'}
        });
      }
    }
  );
  assert.equal(received.url,relayUrl);
  assert.equal(received.options.method,'POST');
  assert.equal(JSON.parse(received.options.body).token,relayToken);
  assert.deepEqual(data,payload);
});

test('relay client refuses redirects to an unapproved relay host before making a request',async()=>{
  let called=false;
  await assert.rejects(
    getJsonViaRelay('https://fump.ufmg.br:3003/cardapios/restaurantes',{
      relayUrl:'https://evil.example/macros/s/abc/exec',relayToken,
      fetchFn:async()=>{called=true;return new Response('{}');}
    }),
    /URL_NOT_ALLOWED/
  );
  assert.equal(called,false);
});

test('relay client rejects invalid or non-success envelopes',async()=>{
  await assert.rejects(
    getJsonViaRelay('https://fump.ufmg.br:3003/cardapios/restaurantes',{
      relayUrl,relayToken,fetchFn:async()=>new Response(JSON.stringify({ok:false,version:1,code:'UPSTREAM_HTTP_403'}),{status:200})
    }),
    /FUMP_RELAY_UPSTREAM_HTTP_403/
  );
  await assert.rejects(
    getJsonViaRelay('https://fump.ufmg.br:3003/cardapios/restaurantes',{
      relayUrl,relayToken,fetchFn:async()=>new Response('not json',{status:200})
    }),
    /FUMP_RELAY_INVALID_JSON/
  );
});

test('relay requires a 64-character hexadecimal token',async()=>{
  await assert.rejects(
    getJsonViaRelay('https://fump.ufmg.br:3003/cardapios/restaurantes',{
      relayUrl,relayToken:'too-short',fetchFn:async()=>new Response('{}')
    }),
    /TOKEN_INVALID/
  );
});
