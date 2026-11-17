import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dateBrasilia,RU_IDS,validOfficialResponse,inspectIndependentHealth,
  runIndependentScheduled} from '../worker/hub-independent-monitor.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const date='2026-11-17';
const now=new Date('2026-11-17T15:00:00Z');

const mockFetch=(behaviour={})=>async(url,options)=>{
  assert.equal(options.method,'GET');
  assert.equal(options.cache,'no-store');
  assert.equal(options.redirect,'manual');
  const uri=new URL(url);
  if(uri.hostname==='hubufmg.web.app'){
    assert.equal(uri.pathname,'/service-worker.js');
    return new Response(behaviour.hostingBody??"const VERSION = 'hub-v277-20261117-batch3-5-r1';",{
      status:behaviour.hostingStatus??200
    });
  }
  assert.equal(uri.host,'fump.ufmg.br:3003');
  assert.equal(uri.pathname,'/cardapios/cardapio');
  const id=uri.searchParams.get('id');
  assert.ok(RU_IDS.includes(id));
  assert.deepEqual([...uri.searchParams.entries()],[
    ['id',id],['dataInicio',date],['dataFim',date]
  ]);
  if(behaviour.timeout===true||behaviour.timeoutId===id)throw Error('FUMP_CONNECTION_TIMEOUT');
  return new Response(JSON.stringify(
    behaviour.badId===id ? {id:'999',cardapios:[]} :
    behaviour.payloadById?.[id] ?? {
      id:Number(id),
      cardapios:[{data:date,refeicoes:[{tipoRefeicao:'Almoço',pratos:[]}]}]
    }),{
    status:behaviour.httpById?.[id]??200,headers:{'content-type':'application/json'}
  });
};

test('Cron gratuito monitora Hosting e todos os quatro RUs com apenas 5 GETs',async()=>{
  assert.equal(dateBrasilia(now),date);
  const urls=[];
  const f=mockFetch();
  const result=await inspectIndependentHealth({fetchFn:async(url,options)=>{
    urls.push(url);return f(url,options);
  },now});
  assert.deepEqual(result,{
    hosting:'OK',fump:'OK',restaurants:{'1':'OK','2':'OK','5':'OK','6':'OK'},
    date,readOnly:true
  });
  assert.equal(urls.length,5);
  assert.equal(urls.filter(url=>url.includes('fump.ufmg.br:3003')).length,4);
  assert.deepEqual([...RU_IDS].sort(),['1','2','5','6']);
  const worker=read('worker/fump-proxy.mjs');
  assert.match(worker,/async scheduled\(_controller,_env,_ctx\)/);
  assert.match(worker,/return runIndependentScheduled\(\)/);
  const monitor=read('worker/hub-independent-monitor.mjs');
  assert.doesNotMatch(monitor,/\.put\(|\.create\(|\.delete\(|firebase-admin|Firestore|run-raffles|PRIVATE_KEY_JWK|\.collection\(|\.doc\(/);
});

test('Resposta vazia de qualquer RU não é fechamento nem falha',async()=>{
  const result=await inspectIndependentHealth({fetchFn:mockFetch({
    payloadById:{'6':{id:6,cardapios:[]},'1':{id:1,cardapios:[]},
      '2':{id:2,cardapios:[]},'5':{id:5,cardapios:[]}}
  }),now});
  assert.equal(result.fump,'OK');
  assert.ok(Object.values(result.restaurants).every(value=>value==='OK'));
});

test('Falha em um único RU gera PARTIAL sem esconder outros restaurantes',async()=>{
  const report=await inspectIndependentHealth({
    fetchFn:mockFetch({httpById:{'2':503}}),now
  });
  assert.equal(report.hosting,'OK');
  assert.equal(report.fump,'PARTIAL');
  assert.equal(report.restaurants['2'],'ERROR');
  assert.equal(report.restaurants['6'],'OK');
  const messages=[];
  await assert.rejects(()=>runIndependentScheduled({now,
    fetchFn:mockFetch({httpById:{'2':503}}),
    logger:{log:()=>{},error:(...parts)=>messages.push(parts)}
  }),/HUB_INDEPENDENT_HEALTH_DEGRADED/);
  assert.equal(messages.length,1);
  assert.ok(!JSON.stringify(messages).includes('ciphertext'));
});

test('Queda de todos os quatro restaurantes gera ERROR; Hosting é separado',async()=>{
  const report=await inspectIndependentHealth({fetchFn:mockFetch({timeout:true}),now});
  assert.equal(report.hosting,'OK');
  assert.equal(report.fump,'ERROR');
  assert.ok(Object.values(report.restaurants).every(value=>value==='ERROR'));
  const badHosting=await inspectIndependentHealth({
    fetchFn:mockFetch({hostingStatus:503}),now
  });
  assert.equal(badHosting.hosting,'ERROR');
  assert.equal(badHosting.fump,'OK');
});

test('Validador não aceita prato de outra data ou RU nem esquema silenciosamente alterado',()=>{
  const good={id:6,cardapios:[{data:'2026-11-17T00:00:00.000Z',refeicoes:[
    {tipoRefeicao:'Almoço',pratos:[{descricaoPrato:'Arroz'}]}
  ]}]};
  assert.equal(validOfficialResponse(good,'6',date),true);
  assert.equal(validOfficialResponse({id:6,cardapios:[]},'6',date),true);
  for(const bad of [
    {...good,id:1},
    {...good,cardapios:[{...good.cardapios[0],data:'2026-11-18'}]},
    {...good,cardapios:[{refeicoes:[]}]},
    {...good,cardapios:[{data:date,refeicoes:[{pratos:null}]}]},
    {...good,cardapios:'invalid'},
    {error:'maintenance'}
  ])assert.equal(validOfficialResponse(bad,'6',date),false);
});

test('Wrangler continua com um Cron gratuito e cache positivo controlado',()=>{
  const wrangler=read('worker/wrangler.toml');
  assert.match(wrangler,/\[triggers\]\s*crons = \[ "30 11,16,21 \* \* \*" \]/);
  assert.match(wrangler,/\[cache\]\s*enabled = false/);
  assert.doesNotMatch(wrangler,/kv_namespaces|durable_objects|d1_databases/);
  assert.match(read('worker/fump-proxy.mjs'),/if \(request\.method!=='GET'\)/);
});
