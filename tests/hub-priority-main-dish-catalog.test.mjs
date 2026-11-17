import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {categoryFromSourceType,knownDishCategory,publishedCategory} from '../public/assets/dish-category.js';
import {parseMenuJson} from '../public/assets/fump-parse.js';

const recipes=JSON.parse(readFileSync(new URL('../public/data/pratos-ingredientes.json',import.meta.url),'utf8'));
const history=JSON.parse(readFileSync(new URL('../public/data/cardapios.json',import.meta.url),'utf8'));
const TYPES=[
  'Prato protéico 1','Prato protéico 2','Prato protéico 3',
  'Guarnição','Acompanhamento 1','Entrada 1','Sobremesa 1 (uma porção)',
  'Bebidas','Tipo de item não cadastrado',''
];
const normalize=name=>String(name??'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim()
  .replace(/[\u2010-\u2015-]/g,' ').replace(/\s+/g,' ');
const entries=new Map();
for(const dish of recipes.dishes)entries.set(normalize(dish.name),dish.name);
for(const day of Object.values(history.days)){
  for(const ru of Object.values(day.restaurants||{})){
    for(const meal of Object.values(ru.meals||{})){
      for(const item of meal.items||[])entries.set(normalize(item.name),item.name);
    }
  }
}
for(const name of [
  'Carne Moída com Legumes','Torta colorida','Banana Prata',
  'Salada de Almeirão com Repolho','Feijão Tropeiro'
])entries.set(normalize(name),name);

test('todo nome conhecido como vegetariano ou proteína prevalece sobre os tipos genéricos da FUMP',()=>{
  let mains=0,vegetarians=0;
  for(const name of entries.values()){
    const expected=knownDishCategory(name);
    if(expected!=='proteina'&&expected!=='vegetariana')continue;
    if(expected==='proteina')mains++;else vegetarians++;
    for(const sourceType of TYPES){
      assert.equal(categoryFromSourceType(sourceType,name),expected,
        name+' / '+sourceType+' (parser)');
      for(const saved of ['','proteina','vegetariana','guarnicao','salada','outros']){
        assert.equal(publishedCategory(saved,name,sourceType),expected,
          name+' / '+sourceType+' / '+saved+' (interface)');
      }
    }
  }
  assert.ok(mains>=45,'Pratos principais historicamente catalogados precisam ser abrangidos');
  assert.ok(vegetarians>=25,'Opções vegetarianas catalogadas precisam ser abrangidas');
});

test('outras categorias catalogadas continuam auxiliares se a FUMP informar tipo válido',()=>{
  assert.equal(knownDishCategory('Salada Síria'),'salada');
  assert.equal(categoryFromSourceType('Acompanhamento 2','Salada Síria'),'acompanhamento');
  assert.equal(publishedCategory('salada','Salada Síria','Acompanhamento 2'),'acompanhamento');
  assert.equal(knownDishCategory('Molho Verde'),'molho');
  assert.equal(categoryFromSourceType('Entrada 2','Molho Verde'),'salada');
  assert.equal(categoryFromSourceType('Tipo de item não cadastrado','Molho Verde'),'molho');
  assert.equal(knownDishCategory('Banana Prata'),'sobremesa');
  assert.equal(categoryFromSourceType('Bebidas','Banana Prata'),'bebida');
});

test('não extrapolar categoria do catálogo para nomes inéditos ou parecidos',()=>{
  assert.equal(knownDishCategory('Carne Moída com Legumes e Soja'),'');
  assert.equal(categoryFromSourceType('Prato protéico 3','Carne Moída com Legumes e Soja'),'vegetariana');
  assert.equal(knownDishCategory('Bife de milho com carne'),'');
  assert.equal(categoryFromSourceType('Prato protéico 1','Bife de milho com carne'),'proteina');
  assert.equal(categoryFromSourceType('Tipo de item não cadastrado','Prato novo sem identificação'),'');
});

test('os quatro RUs usam o mesmo parser e conservam o tipo de origem',()=>{
  const input=[
    {tipoPrato:'Prato protéico 1',descricaoPrato:'Assado de Grão-de-Bico'},
    {tipoPrato:'Prato protéico 3',descricaoPrato:'Carne Moída com Legumes'},
    {tipoPrato:'Entrada 2',descricaoPrato:'Torta colorida'},
    {tipoPrato:'Prato protéico 2',descricaoPrato:'Quibe de Cenoura'},
    {tipoPrato:'Sobremesa 1 (uma porção)',descricaoPrato:'Salada Síria'}
  ];
  for(const id of ['1','2','5','6']){
    const res=parseMenuJson({id:Number(id),cardapios:[{
      data:'2026-11-17',refeicoes:[{tipoRefeicao:'Almoço',pratos:input}]
    }]},{iso:'2026-11-17',sourceId:id});
    assert.deepEqual(res.meals.almoco.items.map(x=>x.category),
      ['vegetariana','proteina','proteina','vegetariana','sobremesa']);
    assert.deepEqual(res.meals.almoco.items.map(x=>x.sourceType),
      input.map(x=>x.tipoPrato));
  }
});
