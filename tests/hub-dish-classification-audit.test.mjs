import test from 'node:test';
import assert from 'node:assert/strict';
import {auditRegisteredFiles,auditRegisteredDishes} from '../scripts/audit-dish-classification.mjs';

test('auditoria geral resolve todos os registros catalogados sem categoria',async()=>{
  const report=await auditRegisteredFiles();
  assert.equal(report.recipeCount,126);
  assert.equal(report.historicalOccurrences,685);
  assert.equal(report.historicalNames,142);
  assert.equal(report.totalNames,202);
  assert.equal(report.namesOnlyInHistory,76);
  assert.equal(report.originalBlanks.length,19,
    'Novos campos originalmente vazios exigem atualização da auditoria');
  assert.ok(report.originalBlanks.some(record=>record.name==='Molho de Manjericão'));
  assert.ok(report.originalBlanks.some(record=>record.name==='Escondidinho de Frango'));
  assert.ok(report.originalBlanks.some(record=>record.name==='Arroz Branco'));
  assert.equal(report.unresolved.length,0,
    'Nenhum prato conhecido deve aparecer em Outros por falta de categoria');
  assert.ok(report.correctedRecords.length>=19);
  assert.deepEqual(report.historicalConflicts, [{
    name:'soja refogada com legumes',
    originalCategories:['vegetariana','guarnicao']
  }]);
  assert.ok(report.categoryCounts.vegetariana>0);
});

test('auditoria bloqueia categoria vazia em um prato novo desconhecido',()=>{
  const report=auditRegisteredDishes({
    catalog:{dishes:[{name:'Arroz Branco'}]},
    history:{days:{'2026-11-17':{restaurants:{'setorial-i':{
      meals:{almoco:{items:[
        {name:'Molho de Manjericão',category:'',sourceType:'Tipo de item não cadastrado'},
        {name:'Preparação totalmente inédita',category:'',sourceType:'Tipo de item não cadastrado'}
      ]}}
    }}}}}
  });
  assert.equal(report.originalBlanks.length,2);
  assert.equal(report.unresolved.length,1);
  assert.equal(report.unresolved[0].name,'Preparação totalmente inédita');
  assert.equal(report.categoryCounts.molho,1);
});

test('auditoria não inventa classificação oficial nem modifica dados recebidos',()=>{
  const catalog={dishes:[]};
  const dish={name:'Prato não reconhecido',category:'',sourceType:'Tipo de item não cadastrado'};
  const history={days:{'2026-11-17':{restaurants:{ica:{
    meals:{almoco:{items:[dish]}}
  }}}}};
  const before=JSON.stringify(history);
  const report=auditRegisteredDishes({catalog,history});
  assert.equal(report.unresolved.length,1);
  assert.equal(JSON.stringify(history),before,'A origem é apenas lida');
  assert.equal(dish.category,'');
});
