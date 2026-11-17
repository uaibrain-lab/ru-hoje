import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryFromSourceType,publishedCategory} from '../public/assets/dish-category.js';
import {parseMenuJson} from '../public/assets/fump-parse.js';

test('bife de milho é vegetariano mesmo quando FUMP usa posição protéica diferente',()=>{
  for(const type of ['Prato protéico 1','Prato protéico 2','Prato protéico 3','Tipo de item não cadastrado','']){
    assert.equal(categoryFromSourceType(type,'Bife de milho'),'vegetariana',type);
    assert.equal(publishedCategory('proteina','Bife de milho',type),'vegetariana',type);
  }
  assert.equal(publishedCategory('proteina',' BIFE DE MILHO ','Prato protéico 1'),'vegetariana');
});

test('correção nominal é exata e não move carnes ou outros itens à categoria vegetariana',()=>{
  assert.equal(categoryFromSourceType('Prato protéico 1','Bife bovino'),'proteina');
  assert.equal(categoryFromSourceType('Prato protéico 1','Bife de milho com carne'),'proteina');
  assert.equal(publishedCategory('proteina','Bife de carne','Prato protéico 1'),'proteina');
  assert.equal(publishedCategory('proteina','Almôndegas assadas','Prato protéico 2'),'proteina');
  assert.equal(categoryFromSourceType('Prato protéico 3','Quibe vegetariano'),'vegetariana');
});

test('parser compartilha a correção em Setorial I (6) e Setorial II (1)',()=>{
  for(const [id,tipoPrato] of [['6','Prato protéico 1'],['1','Prato protéico 3']]){
    const result=parseMenuJson({
      id:Number(id),
      cardapios:[{
        data:'2026-11-17',
        refeicoes:[{tipoRefeicao:'Almoço',pratos:[
          {tipoPrato,descricaoPrato:'Bife de milho'},
          {tipoPrato:'Prato protéico 2',descricaoPrato:'Frango grelhado'}
        ]}]
      }]
    },{iso:'2026-11-17',sourceId:id});
    assert.deepEqual(result.meals.almoco.items.map(item=>item.category),['vegetariana','proteina']);
    assert.equal(result.meals.almoco.items[0].sourceType,tipoPrato,'Preservar tipo original para transparência');
  }
});
