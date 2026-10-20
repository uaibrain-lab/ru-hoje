import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMenuJson, categoryKey} from '../scripts/fump-api.mjs';
import {publishedCategory,categoryFromSourceType} from '../public/assets/dish-category.js';

const date = '2026-10-20';
const apiResponse = {cardapios:[{data:date,refeicoes:[{tipoRefeicao:'Almoço',pratos:[
  {tipoPrato:'Prato protéico 3',descricaoPrato:'Assado de Grão-de-Bico'},
  {tipoPrato:'Prato protéico 1',descricaoPrato:'Copa Lombo Assado'},
  {tipoPrato:'Tipo de item não cadastrado',descricaoPrato:'Frango Xadrez'},
  {tipoPrato:'Tipo de item não cadastrado',descricaoPrato:'Molho Verde'}
]}]}]};

test('v1.9.6: Assado de Grão-de-Bico em dados antigos é vegetariano sem alterar carnes',()=>{
  for (const variant of ['Assado de Grão-de-Bico','Assado de grao de bico',' ASSADO DE GRÃO-DE-BICO ']) {
    assert.equal(publishedCategory('proteina',variant),'vegetariana');
  }
  assert.equal(publishedCategory('proteina','Assado de frango com grão-de-bico'),'proteina');
  assert.equal(publishedCategory('proteina','Assado de carne'),'proteina');
  assert.equal(publishedCategory('guarnicao','Assado de Grão-de-Bico'),'guarnicao');
  assert.equal(publishedCategory('proteina', 'Cassoulet VEGETARIANO'),'vegetariana');
  assert.equal(publishedCategory('proteina', 'Strogonoff vegano'),'vegetariana');
});

test('v1.9.6: novas coletas mantêm tipoPrato exato da API ao lado da categoria',()=>{
  const {meals}=parseMenuJson(apiResponse,{iso:date,sourceId:'2'});
  const items=meals.almoco.items;
  assert.deepEqual(items[0],{name:'Assado de Grão-de-Bico',category:'vegetariana',sourceType:'Prato protéico 3'});
  assert.deepEqual(items[1],{name:'Copa Lombo Assado',category:'proteina',sourceType:'Prato protéico 1'});
  assert.deepEqual(items[2],{name:'Frango Xadrez',category:'proteina',sourceType:'Tipo de item não cadastrado'});
  assert.deepEqual(items[3],{name:'Molho Verde',category:'molho',sourceType:'Tipo de item não cadastrado'});
});

test('v1.9.6: tipo oficial prevalece mesmo quando nome constar de exceções antigas',()=>{
  assert.equal(publishedCategory('proteina','Assado de Grão-de-Bico','Prato protéico 1'),'proteina');
  assert.equal(publishedCategory('proteina','Carne de porco frita','Prato protéico 3'),'vegetariana');
  assert.equal(publishedCategory('proteina','Bolinho de Ervilha','Prato protéico 3'),'vegetariana');
  assert.equal(publishedCategory('', 'Frango Xadrez','Tipo de item não cadastrado'),'proteina');
  assert.equal(publishedCategory('', 'Assado de Grão-de-Bico','Tipo de item não cadastrado'),'vegetariana');
  assert.equal(publishedCategory('', 'Quibe de Cenoura','Tipo de item não cadastrado'),'vegetariana');
  assert.equal(categoryFromSourceType('Entrada 2','Assado de Grão-de-Bico'),'salada');
  assert.equal(categoryKey('Prato proteico 3','Quibe de Cenoura'),'vegetariana');
});

test('v1.9.6: desconhecidos continuam sem suposição e sem reclassificação',()=>{
  assert.equal(publishedCategory('', 'Item não reconhecido'),'');
  assert.equal(categoryKey('Tipo de item não cadastrado','Item não reconhecido'),'');
  assert.equal(publishedCategory('acompanhamento','Assado de Grão-de-Bico','Acompanhamento 1'),'acompanhamento');
  assert.equal(publishedCategory('proteina','Carne de porco frita'),'proteina');
});

test('v1.9.6: frontend usa sourceType, cache novo e integração offline mantida',()=>{
  const app=readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
  const sw=readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8');
  assert.match(app,/publishedCategory\(item.category, name, item.sourceType\)/);
  assert.match(sw,/bandeco-v196-fump-source-types/);
  assert.match(sw,/\/assets\/dish-category\.js/);
});

// Reproduzir também a etapa que recebe dados já classificados pelo coletor:
// o merge não pode descartar o tipoPrato que será necessário no frontend.
test('v1.9.6: a consolidação até o Firestore conserva o tipo oficial', async()=>{
  const {mergeSnapshots} = await import('../scripts/merge-snapshots.mjs');
  const {meals} = parseMenuJson(apiResponse,{iso:date,sourceId:'2'});
  const now='2026-10-20T10:30:00.000Z';
  const item={items:meals.almoco.items,fetchedAt:now};
  const incoming={schemaVersion:1,source:'https://fump.ufmg.br/cardapio-do-dia/',generatedAt:now,
    verifiedCompleteDates:[date],days:{[date]:{restaurants:{saude:{
      sourceRestaurantId:'2',fetchedAt:now,meals:{almoco:item}
    }}}}};
  const merged=mergeSnapshots({schemaVersion:1,days:{}},incoming,new Date(now));
  const published=merged.days[date].restaurants.saude.meals.almoco.items;
  assert.equal(published[0].sourceType,'Prato protéico 3');
  assert.equal(publishedCategory(published[0].category,published[0].name,published[0].sourceType),'vegetariana');
  assert.equal(published[1].sourceType,'Prato protéico 1');
  assert.equal(publishedCategory(published[1].category,published[1].name,published[1].sourceType),'proteina');
});
