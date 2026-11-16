import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../worker/fump-proxy.mjs';

const now=new Date('2026-11-16T18:30:00-03:00');
const base='https://hub-fump-proxy.example.workers.dev';
const goodOrigin='https://hubufmg.web.app';
const otherOrigin='https://hubufmg.firebaseapp.com';
const menuUrl=`${base}/api/menu?id=6&data=2026-11-16`;
const food={id:6,cardapios:[{data:'2026-11-16',
  refeicoes:[{tipoRefeicao:'Almoço',pratos:[{tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz'}]}]}]};
const fakeResponse=(data=food,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json'}
});
const makeRequest=(url=menuUrl,method='GET',origin=goodOrigin)=>
  new Request(url,{method,headers:origin?{Origin:origin}:{}});
function fakeCache() {
  const map=new Map();
  return {
    map,
    match:async req=>map.has(req.url)?map.get(req.url).clone():undefined,
    put:async(req,response)=>{map.set(req.url,response.clone());}
  };
}

test('proxy entrega JSON validado e permite leitura CORS só para domínio Hub',async()=>{
  let called=0;
  const response=await handleRequest(makeRequest(),{
    now,fetchFn:async(url,init)=>{
      called++;
      const parsed=new URL(url);
      assert.equal(parsed.hostname,'fump.ufmg.br');
      assert.equal(parsed.port,'3003');
      assert.equal(parsed.pathname,'/cardapios/cardapio');
      assert.equal(parsed.searchParams.get('id'),'6');
      assert.equal(parsed.searchParams.get('dataInicio'),'2026-11-16');
      assert.equal(parsed.searchParams.get('dataFim'),'2026-11-16');
      assert.equal(init.redirect,'manual');
      return fakeResponse();
    }
  });
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),goodOrigin);
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.deepEqual(await response.json(),food);
  assert.equal(called,1);
});

test('Cloudflare cache evita novo acesso à FUMP e preserva CORS para cada origem',async()=>{
  const cache=fakeCache();
  let called=0;
  const opts={now,cache,fetchFn:async()=>{called++;return fakeResponse();}};
  const first=await handleRequest(makeRequest(),opts);
  assert.equal(first.headers.get('X-Menu-Cache'),'MISS');
  const second=await handleRequest(makeRequest(menuUrl,'GET',otherOrigin),opts);
  assert.equal(second.headers.get('X-Menu-Cache'),'HIT');
  assert.equal(second.headers.get('Access-Control-Allow-Origin'),otherOrigin);
  assert.equal(called,1);
});

test('o proxy fornece preflight CORS sem consultar a FUMP',async()=>{
  const response=await handleRequest(makeRequest(menuUrl,'OPTIONS'),{
    now,fetchFn:async()=>{throw new Error('upstream must not be called');}
  });
  assert.equal(response.status,204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),goodOrigin);
  assert.match(response.headers.get('Access-Control-Allow-Methods'),/GET/);
});

test('origin de outro domínio é rejeitada sem acesso upstream',async()=>{
  const response=await handleRequest(makeRequest(menuUrl,'GET','https://evil.example'),{
    now,fetchFn:async()=>{throw new Error('upstream must not be called');}
  });
  assert.equal(response.status,403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
});

test('nega open proxy, URL e métodos arbitrários antes de conectar à FUMP',async()=>{
  const failUpstream=async()=>{throw new Error('forbidden upstream');};
  for(const [url,method,status] of [
    [base+'/api/arbitrary?id=6', 'GET',404],
    [base+'/api/menu?id=9&data=2026-11-16','GET',400],
    [base+'/api/menu?id=6&data=2026-10-01','GET',400],
    [base+'/api/menu?id=6&data=2026-12-05','GET',400],
    [base+'/api/menu?id=6&data=2026-02-31','GET',400],
    [base+'/api/menu?id=6&data=2026-11-16&url=https://evil.example','GET',400],
    [menuUrl,'POST',405],
  ]) {
    const res=await handleRequest(makeRequest(url,method),{now,fetchFn:failUpstream});
    assert.equal(res.status,status,url);
  }
});

test('HTTP 500 da FUMP não vira cardápio vazio nem resposta 200',async()=>{
  const response=await handleRequest(makeRequest(),{
    now,fetchFn:async()=>fakeResponse({error:'internal'},500)
  });
  assert.equal(response.status,502);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),goodOrigin);
  assert.equal((await response.json()).status,500);
});

test('timeout e bloqueio de IP do proxy preservam erro e não geram pratos',async()=>{
  const response=await handleRequest(makeRequest(),{
    now,fetchFn:async()=>{throw new TypeError('network error');}
  });
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.error,'UPSTREAM_CONNECT_FAILED');
  assert.equal(body.diagnostic.name,'TypeError');
  assert.match(body.diagnostic.message,/network error/);
});

test('diagnostico de rede preserva codigo TLS e oculta URLs e linhas sensiveis',async()=>{
  const response=await handleRequest(makeRequest(),{
    now,fetchFn:async()=>{
      const error=new Error('TLS handshake failed https://fump.ufmg.br:3003/secret?token=private\\ntrace');
      error.cause={code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'};
      throw error;
    }
  });
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.diagnostic.code,'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  assert.ok(!JSON.stringify(body).includes('token=private'));
  assert.ok(!JSON.stringify(body).includes('/secret'));
});

test('rejeita JSON de outro RU, schema desconhecido e data divergente',async()=>{
  for(const data of [
    {id:1,cardapios:food.cardapios},
    {id:6,cardapios:[{data:'2026-11-17',refeicoes:[]}]},
    {id:6,cardapios:[{}]},
    {id:6,cardapios:'string'}
  ]) {
    const response=await handleRequest(makeRequest(),{
      now,fetchFn:async()=>fakeResponse(data)
    });
    assert.equal(response.status,502);
  }
});

test('resposta com cardapios vazios não é considerada RU fechado e tem cache curto',async()=>{
  const response=await handleRequest(makeRequest(),{
    now,fetchFn:async()=>fakeResponse({id:6,cardapios:[]})
  });
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'public,max-age=30');
  assert.deepEqual((await response.json()).cardapios,[]);
});

test('API de restaurantes é somente leitura e allowlisted',async()=>{
  let calls=0;
  const response=await handleRequest(makeRequest(base+'/api/restaurants'),{
    now,fetchFn:async(url)=>{
      calls++;
      assert.equal(new URL(url).pathname,'/cardapios/restaurantes');
      return fakeResponse([{id:6,nome:'RU Setorial I'}]);
    }
  });
  assert.equal(response.status,200);
  assert.equal(calls,1);
  assert.equal((await response.json())[0].id,6);
});


test('redirecionamento 302 da FUMP não é seguido nem cacheado',async()=>{
  const cache=fakeCache();
  let calls=0;
  const response=await handleRequest(makeRequest(),{
    now,cache,fetchFn:async(url,init)=>{
      calls++;
      assert.equal(init.redirect,'manual');
      return new Response(null,{
        status:302,
        headers:{Location:'https://evil.example/collect'}
      });
    }
  });
  assert.equal(response.status,502);
  assert.deepEqual(await response.json(),{error:'UPSTREAM_REDIRECT_BLOCKED',status:302});
  assert.equal(calls,1);
  assert.equal(cache.map.size,0);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),goodOrigin);
});
