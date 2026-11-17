import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readLiveMenu} from '../public/assets/fump-live.js';

const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const iso='2026-11-17';
const proxyUrl='https://hub-fump-proxy.example.workers.dev';
const now=new Date('2026-11-17T15:00:00Z');
const make=(body,status=200)=>async()=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json','x-menu-fetched-at':now.toISOString()}
});

test('única fonte de pratos é a resposta validada da FUMP, não Firestore/static/localStorage',()=>{
  const app=src('public/assets/app.js');
  const sw=src('public/service-worker.js');
  const config=src('public/config.js');
  assert.match(app,/function menuFor\(date, ruId\) \{ return liveMenuFor\(date,ruId\); \}/);
  assert.match(app,/function clearLegacyMenuCaches\(\)/);
  assert.match(app,/state\.liveMenus\.delete\(key\)/);
  assert.doesNotMatch(app,/publicMenus\/current|firestore\.googleapis\.com|\/data\/cardapios\.json|fetchMenus\(|persistLiveMenus\(|hydrateLiveMenus\(|STORAGE_DATA|STORAGE_LIVE/);
  assert.doesNotMatch(config,/publicFeedUrl/);
  assert.doesNotMatch(sw,/['"]\/data\/cardapios\.json['"]/);
  assert.match(sw,/hub-v276-20261117-fresh-menus-r1/);
});

test('consulta oficial válida produz pratos no formato de exibição',async()=>{
  const body={id:6,cardapios:[{data:iso,refeicoes:[
    {tipoRefeicao:'Almoço',pratos:[{tipoPrato:'Prato protéico 1',descricaoPrato:'Frango revisado pela FUMP'}]}
  ]}]};
  const result=await readLiveMenu('setorial-i',iso,{proxyUrl,maxAttempts:1,nowFn:()=>now,fetchFn:make(body)});
  assert.equal(result.status,'VALID_MENU');
  assert.ok(result.meals.almoco.items.some(x=>x.name==='Frango revisado pela FUMP'));
});

test('resposta oficial vazia não vira prato antigo ou indicação falsa de fechamento',async()=>{
  const result=await readLiveMenu('setorial-i',iso,{proxyUrl,maxAttempts:1,nowFn:()=>now,fetchFn:make({id:6,cardapios:[]})});
  assert.equal(result.status,'NOT_PUBLISHED');
  assert.equal(result.meals,undefined);
});

test('falha HTTP 503 e JSON de data errada não são aceitos como cardápio',async()=>{
  const error=await readLiveMenu('setorial-i',iso,{proxyUrl,maxAttempts:1,fetchFn:make({error:'UPSTREAM_CONNECT_FAILED'},503)});
  assert.equal(error.status,'FETCH_ERROR');
  const wrong=await readLiveMenu('setorial-i',iso,{proxyUrl,maxAttempts:1,nowFn:()=>now,
    fetchFn:make({id:6,cardapios:[{data:'2026-11-18',refeicoes:[{tipoRefeicao:'Almoço',pratos:[{descricaoPrato:'Prato de outro dia'}]}]}]})});
  assert.equal(wrong.status,'PARSE_ERROR');
});

test('segurança e domínios da seção festas permanecem independentes',()=>{
  const worker=src('worker/fump-proxy.mjs');
  const rules=src('firestore.rules');
  const app=src('public/assets/app.js');
  assert.match(worker,/if \(request\.method!=='GET'\)/);
  assert.match(rules,/match \/publicMenus\/current/);
  assert.match(rules,/match \/events\/\{eventId\}/);
  assert.match(rules,/match \/eventProfiles\/\{uid\}/);
  assert.match(app,/const STORAGE_RU = 'ruhoje:restaurant:v1'/);
});
