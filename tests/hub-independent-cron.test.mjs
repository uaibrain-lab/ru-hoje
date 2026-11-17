import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dateBrasilia,inspectIndependentHealth,runIndependentScheduled} from '../worker/hub-independent-monitor.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const date='2026-11-17';
const now=new Date('2026-11-17T15:00:00Z');
const fump={id:6,cardapios:[{data:date,refeicoes:[]}]};
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
  assert.deepEqual([...uri.searchParams.entries()],[
    ['id','6'],['dataInicio',date],['dataFim',date]]);
  if(behaviour.timeout)throw new Error('FUMP_CONNECTION_TIMEOUT');
  return new Response(JSON.stringify(behaviour.fumpPayload??fump),{
    status:behaviour.fumpStatus??200,headers:{'content-type':'application/json'}
  });
};

test('Cloudflare Cron independente não lê nem escreve Firestore e usa somente dois GET oficiais',async()=>{
  assert.equal(dateBrasilia(now),date);
  const accesses=[];
  const f=mockFetch();
  const fetchFn=async(url,opts)=>{accesses.push(url);return f(url,opts);};
  const result=await inspectIndependentHealth({fetchFn,now});
  assert.deepEqual(result,{hosting:'OK',fump:'OK',date,readOnly:true});
  assert.equal(accesses.length,2);
  const worker=read('worker/fump-proxy.mjs');
  assert.match(worker,/async scheduled\(_controller,_env,_ctx\)/);
  assert.match(worker,/return runIndependentScheduled\(\)/);
  const monitor=read('worker/hub-independent-monitor.mjs');
  assert.doesNotMatch(monitor,/\.put\(|\.set\(|\.create\(|firebase-admin|Firestore|run-raffles|PRIVATE_KEY_JWK|fetch\(request/);
});

test('Cron entende resposta oficialmente vazia como publicada e não como falha',async()=>{
  const result=await inspectIndependentHealth({fetchFn:mockFetch({fumpPayload:{id:6,cardapios:[]}}),now});
  assert.equal(result.fump,'OK');
});

test('Cron sinaliza indisponibilidade FUMP sem reaproveitar pratos antigos',async()=>{
  for(const behaviour of [
    {timeout:true},{fumpStatus:503},{fumpPayload:{error:'maintenance'}},
    {fumpPayload:{id:2,cardapios:[]}},
    {fumpPayload:{id:6,cardapios:'invalid'}}
  ]) {
    const result=await inspectIndependentHealth({fetchFn:mockFetch(behaviour),now});
    assert.equal(result.fump,'ERROR');
    const messages=[];
    await assert.rejects(()=>runIndependentScheduled({fetchFn:mockFetch(behaviour),now,
      logger:{log:()=>{},error:(...args)=>messages.push(args)}}),/HUB_INDEPENDENT_HEALTH_DEGRADED/);
    assert.equal(messages.length,1);
    assert.ok(!JSON.stringify(messages).includes('ciphertext'));
  }
});

test('Cron classifica problema de hospedagem independentemente da FUMP',async()=>{
  const result=await inspectIndependentHealth({fetchFn:mockFetch({hostingStatus:503}),now});
  assert.equal(result.hosting,'ERROR');assert.equal(result.fump,'OK');
});

test('Wrangler declara um único gatilho Cron no plano gratuito, sem alterar Cache API',()=>{
  const wrangler=read('worker/wrangler.toml');
  assert.match(wrangler,/\[triggers\]\s*crons = \[ "30 11,16,21 \* \* \*" \]/);
  assert.match(wrangler,/\[cache\]\s*enabled = false/);
  assert.doesNotMatch(wrangler,/kv_namespaces|durable_objects|d1_databases/);
  assert.match(read('worker/fump-proxy.mjs'),/if \(request\.method!=='GET'\)/);
});
