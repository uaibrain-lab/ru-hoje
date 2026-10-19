import test from 'node:test';
import assert from 'node:assert/strict';
import {RU_SOURCES,checkRestaurantList,menuUrl,parseMenuJson,categoryKey,mealKey,addDate} from '../scripts/fump-api.mjs';
const date='2026-10-19';
const sources=[
  {id:1,nome:'RU Setorial II'},{id:2,nome:'RU Saúde e Direito'},
  {id:5,nome:'RU ICA'},{id:6,nome:'RU Setorial I'},
];
const response={cardapios:[{data:date,refeicoes:[
  {tipoRefeicao:'Almoço',pratos:[
    {tipoPrato:'Entrada 1',descricaoPrato:'Salada de Almeirão'},
    {tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz Branco'},
    {tipoPrato:'Prato protéico 1',descricaoPrato:'Carne Cozida'},
    {tipoPrato:'Sobremesa 1 (uma porção)',descricaoPrato:'Fruta'},
    {tipoPrato:'(um copo)',descricaoPrato:'Refresco'},
  ]},
  {tipoRefeicao:'Jantar',pratos:[{tipoPrato:'Acompanhamento 2',descricaoPrato:'Feijão Carioca'}]}
]}]};
test('IDs do HTML oficial correspondem a quatro fontes, Saúde/Direito compartilhada',()=>{
  assert.equal(RU_SOURCES.length,4);
  assert.deepEqual(checkRestaurantList(sources).find(x=>x.sourceId==='2').appIds,['saude','direito']);
});
test('inversão de Setorial I e II aborta mapeamento',()=>{
  assert.throws(()=>checkRestaurantList(sources.map(x=>x.id===6?{...x,nome:'RU Setorial II'}:x)),/divergente/);
});
test('URL usa parâmetros da API oficial da FUMP',()=>{
  const url=new URL(menuUrl('6',date));
  assert.equal(url.port,'3003');
  assert.equal(url.pathname,'/cardapios/cardapio');
  assert.equal(url.searchParams.get('dataInicio'),date);
  assert.equal(url.searchParams.get('dataFim'),date);
  assert.equal(url.searchParams.get('id'),'6');
});
test('extrai somente pratos estruturados e preserva almoço e jantar',()=>{
  const {meals,meta}=parseMenuJson(response,{iso:date,sourceId:'6'});
  assert.deepEqual(Object.keys(meals),['almoco','jantar']);
  assert.equal(meals.almoco.items.length,5);
  assert.equal(meals.almoco.items[0].category,'salada');
  assert.equal(meals.almoco.items[2].category,'proteina');
  assert.equal(meals.almoco.items[4].category,'bebida');
  assert.equal(meta.checkedDates,1);
});
test('data divergente é rejeitada em vez de atribuída ao dia errado',()=>{
  assert.throws(()=>parseMenuJson(response,{iso:'2026-10-20',sourceId:'6'}),/retornou/);
});
test('HTML não é aceito como JSON de refeições',()=>{
  assert.throws(()=>parseMenuJson({text:'Valorizamos sua privacidade'},{iso:date,sourceId:'6'}),/cardapios/);
});
test('exclui textos de interface e HTML, mesmo que apareçam no JSON',()=>{
  const json={cardapios:[{refeicoes:[{tipoRefeicao:'Almoço',pratos:[
    {tipoPrato:'Entrada 1',descricaoPrato:'Valorizamos sua privacidade'},
    {tipoPrato:'Entrada 2',descricaoPrato:'Salada Tabule'},
    {tipoPrato:'Entrada 2',descricaoPrato:'<img src=x>cookies'},
  ]}]}]};
  const {meals,meta}=parseMenuJson(json,{iso:date,sourceId:'2'});
  assert.equal(meals.almoco.items.length,1);
  assert.equal(meals.almoco.items[0].name,'Salada Tabule');
  assert.equal(meta.ignored,2);
});
test('não fabrica jantar quando só veio almoço',()=>{
  const {meals}=parseMenuJson({cardapios:[{refeicoes:[{tipoRefeicao:'Almoço',pratos:[{tipoPrato:'Guarnição',descricaoPrato:'Chuchu Tropeiro'}]}]}]},{iso:date,sourceId:'1'});
  assert.ok(meals.almoco);
  assert.equal(meals.jantar,undefined);
});
test('falha quando a API muda refeicoes[]/pratos[]',()=>{
  assert.throws(()=>parseMenuJson({cardapios:[{}]},{iso:date,sourceId:'1'}),/refeicoes/);
  assert.throws(()=>parseMenuJson({cardapios:[{refeicoes:[{tipoRefeicao:'Jantar'}]}]},{iso:date,sourceId:'1'}),/pratos/);
});
test('classificações seguem tipoPrato da API sem inferir pela redação',()=>{
  assert.equal(categoryKey('Entrada 2'),'salada');
  assert.equal(categoryKey('Guarnição'),'guarnicao');
  assert.equal(mealKey('Almoço'),'almoco');
  assert.equal(mealKey('Jantar'),'jantar');
});
test('data inválida bloqueada',()=>{
  assert.throws(()=>addDate('2026-02-31',1),/inexistente/);
});
