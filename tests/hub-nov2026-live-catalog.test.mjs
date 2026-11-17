import test from 'node:test';
import assert from 'node:assert/strict';
import {
  knownDishCategory,categoryFromSourceType,publishedCategory
} from '../public/assets/dish-category.js';

const newlyObserved={
  'Banana Prata':'sobremesa',
  'Carne Moída com Legumes':'proteina',
  'Chuchu refogado':'guarnicao',
  'Doce de abóbora':'sobremesa',
  'Feijão com bacon':'acompanhamento',
  'Feijão Tropeiro':'acompanhamento',
  'Gelatina de Uva':'sobremesa',
  'Melão':'sobremesa',
  'Repolho Búlgaro':'guarnicao',
  'Salada de almeirão com alface roxa':'salada',
  'Salada de Almeirão com Repolho':'salada',
  'Salada de Almeirão com Repolho Roxo':'salada',
  'Salada de Jiló':'salada',
  'Sopa de fubá com couve':'guarnicao',
  'Torta colorida':'proteina'
};
test('15 nomes descobertos em consulta real à FUMP de 17–19/11 possuem fallback',()=>{
  assert.equal(Object.keys(newlyObserved).length,15);
  for(const [name,expected] of Object.entries(newlyObserved)){
    assert.equal(knownDishCategory(name),expected,name);
    assert.equal(categoryFromSourceType('Tipo de item não cadastrado',name),expected,name);
    assert.equal(publishedCategory('',name,'Tipo de item não cadastrado'),expected,name);
  }
});
test('o fallback observado não reclassifica contra um tipo oficial atual diferente',()=>{
  assert.equal(knownDishCategory('Torta colorida'),'proteina');
  assert.equal(categoryFromSourceType('Prato protéico 3','Torta colorida'),'vegetariana');
  assert.equal(publishedCategory('proteina','Torta colorida','Prato protéico 3'),'vegetariana');
  assert.equal(categoryFromSourceType('Guarnição','Carne Moída com Legumes'),'guarnicao');
  assert.equal(categoryFromSourceType('Prato protéico 1','Carne Moída com Legumes'),'proteina');
});
test('Quibe de Cenoura é vegetariano nos dois tipos oficiais conflitantes',()=>{
  for(const type of ['Prato protéico 2','Prato protéico 3','Tipo de item não cadastrado']){
    assert.equal(categoryFromSourceType(type,'Quibe de Cenoura'),'vegetariana',type);
    assert.equal(publishedCategory('proteina','Quibe de Cenoura',type),'vegetariana',type);
  }
  assert.equal(categoryFromSourceType('Prato protéico 1','Quibe de carne com cenoura'),'proteina');
});
