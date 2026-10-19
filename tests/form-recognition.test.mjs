import test from 'node:test';
import assert from 'node:assert/strict';
import {matchRU,matchingOptions,mealOption} from '../scripts/form-recognition.mjs';

test('não confunde Setorial I com Setorial II',()=>{
  assert.equal(matchRU('RU Setorial I Campus Pampulha','setorial-i'),true);
  assert.equal(matchRU('RU Setorial II Campus Pampulha','setorial-i'),false);
  assert.equal(matchRU('RU Setorial II Campus Pampulha','setorial-ii'),true);
  assert.equal(matchRU('RU Setorial I e II','setorial-i'),false);
  assert.equal(matchRU('RU Setorial I e II','setorial-ii'),false);
});
test('reconhece variações oficiais de restaurantes',()=>{
  assert.ok(matchRU('RU Saúde e Direito','saude'));
  assert.ok(matchRU('RU Saúde e Direito','direito'));
  assert.ok(matchRU('RU ICA (Montes Claros)','ica'));
});
test('seleciona somente opções com valores e habilitadas',()=>{
  const opts=[
    {label:'Selecione...',value:''},
    {label:'RU Setorial I Campus Pampulha',value:'11',disabled:false},
    {label:'RU Setorial II Campus Pampulha',value:'12',disabled:false},
    {label:'RU Setorial I Campus Pampulha',value:'99',disabled:true},
  ];
  assert.deepEqual(matchingOptions(opts,'setorial-i').map(o=>o.value),['11']);
});
test('distingue almoço e jantar',()=>{
  assert.equal(mealOption('Almoço','almoco'),true);
  assert.equal(mealOption('Jantar','almoco'),false);
  assert.equal(mealOption('Jantar','jantar'),true);
});
