import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMenus, identifyRestaurant, inferMealOption, mergeMenus } from '../scripts/parser.mjs';
const realExample = `CARDÁPIO DO DIA\nData : 01/02/2024\nAlmoço\nIsca de Frango Colorida\nBife de milho (Prato protéico 3)\nBatata ao Forno (Guarnição)\nArroz Branco (Acompanhamento 1)\nFeijão Carioca (Acompanhamento 2)\nSalada de Alface Crespa (Entrada 1)\nSalada de Cenoura com Vagem (Entrada 2)\nDoce de Amendoim em Tablete [Sobremesa (uma porção)]\nRefresco [Refresco (um copo)]\nMolho de Hortelã\nCardápio sujeito a alterações.\nJantar\nBife de porco grelhado\nBolinho de Lentilha (Prato protéico 3)\nSopa de legumes (Guarnição)\nArroz Branco (Acompanhamento 1)\nFeijão Carioca (Acompanhamento 2)\nSalada de Alface com Agrião (Entrada 1)\nSalada de Tomate (Entrada 2)\nLaranja [Sobremesa (uma porção)]\nRefresco [Refresco (um copo)]\nMolho de Hortelã\nCardápio sujeito a alterações.`;
test('extrai pratos a partir do formato histórico da FUMP',()=>{
  const x=extractMenus(realExample);
  assert.equal(x.almoco.items.length,10);assert.equal(x.jantar.items.length,10);
  assert.equal(x.almoco.items[1].name,'Bife de milho');assert.equal(x.almoco.items[1].category,'vegetariana');
  assert.equal(x.jantar.items[0].name,'Bife de porco grelhado');
});
test('não confunde texto da página vazia com almoço',()=> {
  const x=extractMenus('Selecione\nAlmoço\nConsultar Cardápio\nAtenção: o cardápio pode sofrer alterações\nFump UFMG');
  assert.deepEqual(x,{});
});
test('não aceita lista curta ou erro como refeição',()=>{
  assert.deepEqual(extractMenus('Almoço\nErro: dados indisponíveis\nVolte mais tarde'),{});
});
test('isola restaurante / refeições selecionados',()=>{
  assert.deepEqual(identifyRestaurant('Restaurante Universitário Setorial I'),['setorial-i']);
  assert.deepEqual(identifyRestaurant('RU Saúde e Direito'),['saude','direito']);
  assert.deepEqual(identifyRestaurant('RU Setorial II'),['setorial-ii']);
  assert.deepEqual(identifyRestaurant('Setorial I e II'),['setorial-i','setorial-ii']);
  assert.equal(inferMealOption('Jantar'),'jantar');
});
test('preserva a maior captura',()=>{
  const a=extractMenus(realExample);const b={almoco:{items:[{name:'Arroz'},{name:'Feijão'},{name:'Salada'},{name:'Carne'}]}};
  mergeMenus(a,b);assert.equal(a.almoco.items.length,10);
});
