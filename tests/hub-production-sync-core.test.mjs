import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSnapshot, safeGet, assertCurrentWeekdayCoverage} from '../scripts/hub-production-sync-core.mjs';
import {mergeSnapshots} from '../scripts/merge-snapshots.mjs';

const fixedNow = new Date('2026-11-16T12:00:00.000Z');
const iso = '2026-11-16';
const restaurants = [
  {id:1,nome:'RU Setorial II'},
  {id:2,nome:'RU Saúde e Direito'},
  {id:5,nome:'RU ICA'},
  {id:6,nome:'RU Setorial I'},
];
function menuResponse(id, {empty = false, malformed = false} = {}) {
  if (malformed) return {id:Number(id),nome:restaurants.find(x=>x.id===Number(id)).nome,cardapios:[{}]};
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
function fakeGetter({emptyIds = [], failedIds = [], malformedIds = []} = {}) {
  return async url => {
    if (url.endsWith('/cardapios/restaurantes')) return restaurants;
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (failedIds.includes(id)) {
      throw new TypeError('fetch failed',{cause:Object.assign(new Error('connection timeout'),{code:'UND_ERR_CONNECT_TIMEOUT'})});
    }
    return menuResponse(id,{empty:emptyIds.includes(id),malformed:malformedIds.includes(id)});
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

test('um RU sem cardápio não bloqueia a atualização dos outros nem apaga seus dados antigos', async () => {
  const {snapshot,rows} = await collectSnapshot(1,{
    getJsonFn:fakeGetter({emptyIds:['1','6']}),
    now:fixedNow,maxAttempts:1
  });
  assert.deepEqual(snapshot.verifiedCompleteDates,[]);
  assert.equal(rows.filter(x=>x.status==='NOT_PUBLISHED').length,2);
  assert.equal(rows.filter(x=>x.status==='VALID_MENU').length,2);
  assert.equal(snapshot.days[iso].restaurants['setorial-i'],undefined);
  assert.equal(snapshot.days[iso].restaurants['setorial-ii'],undefined);

  assert.doesNotThrow(()=>assertCurrentWeekdayCoverage(rows,fixedNow));
  const merged=mergeSnapshots(previousSnapshot(),snapshot,fixedNow);
  assert.equal(merged.days[iso].restaurants['setorial-i'].meals.almoco.items[0].name,'Menu antigo Setorial I');
  assert.equal(merged.days[iso].restaurants['setorial-ii'].meals.almoco.items[0].name,'Menu antigo Setorial II');
  assert.equal(merged.days[iso].restaurants.saude.meals.almoco.items[0].name,'Arroz RU 2');
  assert.equal(merged.days[iso].restaurants.ica.meals.almoco.items[0].name,'Arroz RU 5');
});

test('quatro fontes válidas e datadas tornam a data completa', async () => {
  const {snapshot,rows}=await collectSnapshot(1,{
    getJsonFn:fakeGetter(),now:fixedNow,maxAttempts:1
  });
  assert.deepEqual(snapshot.verifiedCompleteDates,[iso]);
  assert.equal(rows.filter(x=>x.status==='VALID_MENU').length,4);
  assert.doesNotThrow(()=>assertCurrentWeekdayCoverage(rows,fixedNow));
});

test('timeout em um RU é isolado; os outros três ainda podem atualizar', async () => {
  const {snapshot,rows}=await collectSnapshot(1,{
    getJsonFn:fakeGetter({failedIds:['6']}),now:fixedNow,maxAttempts:1
  });
  assert.equal(rows.find(x=>x.sourceId==='6').status,'FETCH_ERROR');
  assert.equal(rows.find(x=>x.sourceId==='6').error,'UND_ERR_CONNECT_TIMEOUT');
  assert.equal(rows.filter(x=>x.status==='VALID_MENU').length,3);
  assert.equal(snapshot.days[iso].restaurants['setorial-i'],undefined);
  assert.ok(snapshot.days[iso].restaurants['setorial-ii']);
  assert.doesNotThrow(()=>assertCurrentWeekdayCoverage(rows,fixedNow));
  const merged=mergeSnapshots(previousSnapshot(),snapshot,fixedNow);
  assert.equal(merged.days[iso].restaurants['setorial-i'].meals.almoco.items[0].name,'Menu antigo Setorial I');
});

test('mudança no schema de um RU fica PARSE_ERROR e não contamina os demais', async () => {
  const {snapshot,rows}=await collectSnapshot(1,{
    getJsonFn:fakeGetter({malformedIds:['1']}),now:fixedNow,maxAttempts:1
  });
  assert.equal(rows.find(x=>x.sourceId==='1').status,'PARSE_ERROR');
  assert.equal(rows.filter(x=>x.status==='VALID_MENU').length,3);
  assert.ok(snapshot.days[iso].restaurants['setorial-i']);
  assert.doesNotThrow(()=>assertCurrentWeekdayCoverage(rows,fixedNow));
});

test('bloqueia o apply quando nenhuma fonte válida foi obtida para hoje', async () => {
  await assert.rejects(
    collectSnapshot(1,{getJsonFn:fakeGetter({emptyIds:['1','2','5','6']}),now:fixedNow,maxAttempts:1}),
    /CARDAPIO_PERIODO_AUSENTE/
  );
});

test('safeGet registra a causa original e tenta novamente falha transitória', async () => {
  let calls=0;
  const networkError = new TypeError('fetch failed',{
    cause:Object.assign(new Error('socket reset'),{code:'ECONNRESET'})
  });
  await assert.rejects(
    safeGet('https://fump.ufmg.br:3003/cardapios/restaurantes',{
      getJsonFn:async()=>{calls+=1;throw networkError;},
      maxAttempts:2,baseDelayMs:0
    }),
    /FUMP_FETCH_FAILED_ECONNRESET/
  );
  assert.equal(calls,2);
});

test('safeGet não repete HTTP 403 permanente', async () => {
  let calls=0;
  await assert.rejects(
    safeGet('https://fump.ufmg.br:3003/cardapios/restaurantes',{
      getJsonFn:async()=>{calls+=1;throw new Error('HTTP 403 em /cardapios/restaurantes');},
      maxAttempts:3,baseDelayMs:0
    }),
    /FUMP_FETCH_FAILED_HTTP_403/
  );
  assert.equal(calls,1);
});

test('apply em fim de semana não exige menu atual para publicar', () => {
  const weekend = new Date('2026-11-21T12:00:00.000Z');
  assert.deepEqual(assertCurrentWeekdayCoverage([],weekend),{skipped:true,reason:'FIM_DE_SEMANA'});
});
