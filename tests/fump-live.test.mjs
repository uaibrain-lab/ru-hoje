import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLiveUrl,sourceForRu,validISO,readLiveMenu,isValidLiveEntry} from '../public/assets/fump-live.js';
import {parseMenuJson as parseServer} from '../scripts/fump-api.mjs';
import {parseMenuJson as parseClient} from '../public/assets/fump-parse.js';

const iso='2026-11-16';
const dishes=[{tipoPrato:'Prato protéico 3',descricaoPrato:'Bolinho de Soja'},{tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz Branco'}];
const payload=(id='6',d=iso)=>({id:Number(id),cardapios:[{data:d,refeicoes:[{tipoRefeicao:'Almoço',pratos:dishes}]}]});
const reply=(data,status=200)=>({
 ok:status>=200&&status<300,status,
 headers:{get:(name)=>name==='content-type'?'application/json':null},
 text:async()=>JSON.stringify(data)
});

test('links respeitam a data selecionada, o ID e o domínio autorizado',()=>{
 const url=new URL(buildLiveUrl('setorial-i',iso));
 assert.equal(url.host,'fump.ufmg.br:3003');
 assert.equal(url.pathname,'/cardapios/cardapio');
 assert.deepEqual([...url.searchParams.entries()],[['id','6'],['dataInicio',iso],['dataFim',iso]]);
 assert.equal(sourceForRu('saude'),'2');
 assert.equal(sourceForRu('direito'),'2');
 assert.equal(validISO('2026-02-31'),false);
 assert.throws(()=>buildLiveUrl('unknown',iso));
});

test('Node e navegador interpretam exatamente o mesmo menu FUMP',()=>{
 const json=payload();
 assert.deepEqual(parseClient(json,{iso,sourceId:'6'}),parseServer(json,{iso,sourceId:'6'}));
});

test('consulta usa CORS sem credenciais, valida data e salva refeições somente quando positivas',async()=>{
 let seen;
 const result=await readLiveMenu('setorial-i',iso,{
  fetchFn:async(url,opts)=>{seen={url,opts};return reply(payload());},
  nowFn:()=>new Date('2026-11-16T15:30:00.000Z')
 });
 assert.equal(result.status,'VALID_MENU');
 assert.equal(result.dateEvidence,'response');
 assert.equal(result.meals.almoco.items[0].category,'vegetariana');
 assert.equal(seen.opts.mode,'cors');
 assert.equal(seen.opts.credentials,'omit');
 assert.equal(seen.opts.cache,'no-store');
 assert.equal(seen.opts.method,'GET');
 assert.equal(result.sourceId,'6');
});

test('a origem de ID 2 serve Saúde e Direito sem contaminar Setoriais',async()=>{
 const result=await readLiveMenu('saude',iso,{fetchFn:async()=>reply(payload('2'))});
 assert.equal(result.status,'VALID_MENU');
 const cached={...result,sourceRestaurantId:'2'};
 assert.equal(isValidLiveEntry(cached,iso,'direito'),true);
 assert.equal(isValidLiveEntry(cached,iso,'setorial-i'),false);
});

test('resposta vazia não autoriza apagar cardápios salvos',async()=>{
 const result=await readLiveMenu('setorial-i',iso,{fetchFn:async()=>reply({id:6,cardapios:[]})});
 assert.equal(result.status,'NOT_PUBLISHED');
 assert.equal(result.meals,undefined);
});

test('resposta datada para outro dia é recusada',async()=>{
 const result=await readLiveMenu('setorial-i',iso,{fetchFn:async()=>reply(payload('6','2026-11-15'))});
 assert.equal(result.status,'PARSE_ERROR');
});

test('resposta de outro RU, mesmo com pratos, não é exibida',async()=>{
 const result=await readLiveMenu('setorial-i',iso,{fetchFn:async()=>reply(payload('1'))});
 assert.equal(result.status,'PARSE_ERROR');
});

test('dados sem data no corpo não são apresentados como data verificada no corpo',async()=>{
 const json={id:6,cardapios:[{refeicoes:[{tipoRefeicao:'Almoço',pratos:dishes}]}]};
 const result=await readLiveMenu('setorial-i',iso,{fetchFn:async()=>reply(json)});
 assert.equal(result.status,'VALID_MENU');
 assert.equal(result.dateEvidence,'request');
});

test('schema inesperado é recusado sem renderizar',async()=>{
 const result=await readLiveMenu('setorial-i',iso,{fetchFn:async()=>reply({id:6,cardapios:[{}]})});
 assert.equal(result.status,'PARSE_ERROR');
});

test('erro HTTP permanente não é repetido',async()=>{
 let attempts=0;
 const result=await readLiveMenu('setorial-i',iso,{
  fetchFn:async()=>{attempts++;return reply({},403);},
  sleepFn:async()=>{}
 });
 assert.equal(attempts,1);
 assert.equal(result.status,'FETCH_ERROR');
});

test('erro transitório tenta novamente e recupera sem depender de GitHub',async()=>{
 let attempts=0;
 const result=await readLiveMenu('setorial-i',iso,{
  fetchFn:async()=>{
   attempts++;
   if(attempts===1)throw new TypeError('Failed to fetch');
   return reply(payload());
  },
  sleepFn:async()=>{}
 });
 assert.equal(attempts,2);
 assert.equal(result.status,'VALID_MENU');
});

test('CORS bloqueado falha isoladamente e não produz pratos falsos',async()=>{
 const result=await readLiveMenu('setorial-ii',iso,{
  fetchFn:async()=>{throw new TypeError('Failed to fetch');},
  sleepFn:async()=>{}
 });
 assert.equal(result.status,'FETCH_ERROR');
 assert.equal(result.meals,undefined);
});

test('cache ao vivo nunca cruza data ou fonte errada',()=>{
 const data={iso,ruId:'setorial-i',sourceRestaurantId:'6',
   fetchedAt:new Date().toISOString(),meals:{almoco:{items:[{name:'Arroz Branco'}]}}};
 assert.equal(isValidLiveEntry(data,iso,'setorial-i'),true);
 assert.equal(isValidLiveEntry(data,'2026-11-17','setorial-i'),false);
 assert.equal(isValidLiveEntry(data,iso,'setorial-ii'),false);
});
