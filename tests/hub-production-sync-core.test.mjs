import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSnapshot, safeGet} from '../scripts/hub-production-sync-core.mjs';
import {mergeSnapshots} from '../scripts/merge-snapshots.mjs';

const fixedNow = new Date('2026-11-16T12:00:00.000Z');
const iso = '2026-11-16';
const restaurants = [
  {id:1,nome:'RU Setorial II'},
  {id:2,nome:'RU Saúde e Direito'},
  {id:5,nome:'RU ICA'},
  {id:6,nome:'RU Setorial I'},
];
function menuResponse(id, {empty = false} = {}) {
  if (empty) return {id:Number(id),nome:restaurants.find(x=>x.id===Number(id)).nome,cardapios:[]};
  return {
    id:Number(id),
    nome:restaurants.find(x=>x.id===Number(id)).nome,
    cardapios:[{data:`${iso}T00:00:00.000Z`,refeicoes:[{
      tipoRefeicao:'Almoço',
      pratos:[{tipoPrato:'Acompanhamento 1',descricaoPrato:`Arroz RU ${id}`}]
    }]}]
  };
}
function fakeGetter({emptyIds = []} = {}) {
  return async url => {
    if (url.endsWith('/cardapios/restaurantes')) return restaurants;
    const u = new URL(url);
    const id = u.searchParams.get('id');
    return menuResponse(id,{empty:emptyIds.includes(id)});
  };
}
function previousSnapshot() {
  return {
    schemaVersion:1,
    generatedAt:'2026-11-16T11:00:00.000Z',
    source:'https://fump.ufmg.br/cardapio-do-dia/',
    days:{[iso]:{restaurants:{
      'setorial-i':{fetchedAt:'2026-11-16T11:00:00.000Z',sourceRestaurantId:'6',meals:{
        almoco:{fetchedAt:'2026-11-16T11:00:00.000Z',items:[{name:'Menu antigo Setorial I',category:'proteina'}]}
      }},
      'setorial-ii':{fetchedAt:'2026-11-16T11:00:00.000Z',sourceRestaurantId:'1',meals:{
        almoco:{fetchedAt:'2026-11-16T11:00:00.000Z',items:[{name:'Menu antigo Setorial II',category:'proteina'}]}
      }}
    }}}
  };
}

test('resposta vazia de um RU não declara a data completa nem autoriza apagar dados antigos', async () => {
  const {snapshot,rows} = await collectSnapshot(1,{
    getJsonFn:fakeGetter({emptyIds:['1','6']}),
    now:fixedNow,
    maxAttempts:1
  });
  assert.deepEqual(snapshot.verifiedCompleteDates,[]);
  assert.equal(rows.filter(x=>x.status==='resposta-vazia-nao-autoritativa').length,2);
  assert.equal(snapshot.days[iso].restaurants['setorial-i'],undefined);
  assert.equal(snapshot.days[iso].restaurants['setorial-ii'],undefined);

  const merged=mergeSnapshots(previousSnapshot(),snapshot,fixedNow);
  assert.equal(merged.days[iso].restaurants['setorial-i'].meals.almoco.items[0].name,'Menu antigo Setorial I');
  assert.equal(merged.days[iso].restaurants['setorial-ii'].meals.almoco.items[0].name,'Menu antigo Setorial II');
  assert.equal(merged.days[iso].restaurants.saude.meals.almoco.items[0].name,'Arroz RU 2');
  assert.equal(merged.days[iso].restaurants.ica.meals.almoco.items[0].name,'Arroz RU 5');
});

test('somente cobertura positiva e datada das quatro fontes autoriza data completa', async () => {
  const {snapshot,rows}=await collectSnapshot(1,{
    getJsonFn:fakeGetter(),
    now:fixedNow,
    maxAttempts:1
  });
  assert.deepEqual(snapshot.verifiedCompleteDates,[iso]);
  assert.equal(rows.filter(x=>x.status==='com-cardapio').length,4);
});

test('resposta de rede registra causa sanitizada e retenta', async () => {
  let calls=0;
  const networkError = new TypeError('fetch failed',{
    cause:Object.assign(new Error('socket reset'),{code:'ECONNRESET'})
  });
  await assert.rejects(
    safeGet('https://fump.ufmg.br:3003/cardapios/restaurantes',{
      getJsonFn:async()=>{calls+=1;throw networkError;},
      maxAttempts:2,
      baseDelayMs:0
    }),
    /FUMP_FETCH_FAILED_ECONNRESET/
  );
  assert.equal(calls,2);
});
