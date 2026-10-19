import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { auditApiDiagnostics } from '../scripts/prepare-api-snapshot.mjs';
import { RU_SOURCES, SOURCE_PAGE, parseMenuJson } from '../scripts/fump-api.mjs';
const ISO='2026-10-19', TS='2026-10-19T15:00:00.000Z';
const raw={cardapios:[{refeicoes:[{tipoRefeicao:'Almoço',pratos:[
  {tipoPrato:'Entrada 1',descricaoPrato:'Salada de almeirão'},
  {tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz branco'},
  {tipoPrato:'Prato protéico 1',descricaoPrato:'Carne cozida'},
 ]}]}]};
async function fixture({emptySource=null,missingRaw=null,ignored=false}={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ruhoje-audit-'));
  const put=async (name,val)=>fs.writeFile(path.join(dir,name), JSON.stringify(val));
  const names=[
    {id:6,nome:'RU Setorial I'}, {id:1,nome:'RU Setorial II'},
    {id:2,nome:'RU Saúde e Direito'}, {id:5,nome:'RU ICA'},
  ];
  await put('raw-restaurantes.json',names);
  const candidate={schemaVersion:1,generatedAt:TS,source:SOURCE_PAGE,days:{}};
  const summary={mode:'diagnostico-sem-publicacao',success:0,empty:0,failures:[],rows:[]};
  for(const source of RU_SOURCES) {
    const contents=source.sourceId===emptySource ? {cardapios:[]} : raw;
    if(source.sourceId !== missingRaw) await put(`raw-${ISO}-id${source.sourceId}.json`,contents);
    const {meals,meta}=parseMenuJson(contents,{iso:ISO,sourceId:source.sourceId});
    if(ignored && source.sourceId==='6') meta.ignored=1;
    if(Object.keys(meals).length) {
      summary.success++;
      summary.rows.push({iso:ISO,sourceId:source.sourceId,status:'capturado-nao-validado',meta});
      for(const id of source.appIds) {
        const ru={meals:Object.fromEntries(Object.entries(meals).map(([k,v])=>[k,{...v,fetchedAt:TS}])),fetchedAt:TS,sourceRestaurantId:source.sourceId};
        (candidate.days[ISO] ||= {restaurants:{}}).restaurants[id]=ru;
      }
    }else {
      summary.empty++;
      summary.rows.push({iso:ISO,sourceId:source.sourceId,status:'sem cardapio',meta});
    }
  }
  await put('summary.json',summary);
  await put('candidate.json',candidate);
  return {dir,put,summary,candidate};
}

test('audita as quatro fontes e cinco restaurantes sem escrita',async t=>{
  const f=await fixture();t.after(()=>fs.rm(f.dir,{recursive:true,force:true}));
  const result=await auditApiDiagnostics(f.dir);
  assert.equal(result.report.captured,4);
  assert.equal(result.snapshot.days[ISO].restaurants.saude.meals.almoco.items[0].name,'Salada de almeirão');
  assert.deepEqual(result.snapshot.days[ISO].restaurants.saude.meals,result.snapshot.days[ISO].restaurants.direito.meals);
});
test('fonte explicitamente sem cardápio não é inventada',async t=>{
  const f=await fixture({emptySource:'6'});t.after(()=>fs.rm(f.dir,{recursive:true,force:true}));
  const result=await auditApiDiagnostics(f.dir);
  assert.equal(result.report.empty,1);
  assert.equal(result.snapshot.days[ISO].restaurants['setorial-i'],undefined);
});
test('falha quando falta uma resposta bruta',async t=>{
  const f=await fixture({missingRaw:'6'});t.after(()=>fs.rm(f.dir,{recursive:true,force:true}));
  await assert.rejects(auditApiDiagnostics(f.dir),/raw-2026-10-19-id6/);
});
test('rejeita contaminação ou metadados com itens ignorados',async t=>{
  const f=await fixture({ignored:true});t.after(()=>fs.rm(f.dir,{recursive:true,force:true}));
  await assert.rejects(auditApiDiagnostics(f.dir),/ignorados/);
});
test('rejeita prato adulterado no candidato',async t=>{
  const f=await fixture();t.after(()=>fs.rm(f.dir,{recursive:true,force:true}));
  f.candidate.days[ISO].restaurants.saude.meals.almoco.items[0].name='Banner cookies';
  await f.put('candidate.json',f.candidate);
  await assert.rejects(auditApiDiagnostics(f.dir),/pratos divergentes/);
});
test('rejeita campos ou restaurantes extras no candidato',async t=>{
  const f=await fixture();t.after(()=>fs.rm(f.dir,{recursive:true,force:true}));
  f.candidate.days[ISO].restaurants.saude.other='não oficial';
  await f.put('candidate.json',f.candidate);
  await assert.rejects(auditApiDiagnostics(f.dir),/snapshot contém/);
});
test('rejeita falta de uma fonte e resumo com erros',async t=>{
  const f=await fixture();t.after(()=>fs.rm(f.dir,{recursive:true,force:true}));
  f.summary.rows.pop();f.summary.success--;
  await f.put('summary.json',f.summary);
  await assert.rejects(auditApiDiagnostics(f.dir),/quatro fontes/);
  f.summary.failures.push({stage:'api',error:'timeout'});
  await f.put('summary.json',f.summary);
  await assert.rejects(auditApiDiagnostics(f.dir),/falhas de coleta/);
});
test('rejeita coleta de data não corrente quando requerida',async t=>{
  const f=await fixture();t.after(()=>fs.rm(f.dir,{recursive:true,force:true}));
  await assert.rejects(auditApiDiagnostics(f.dir,{requireToday:true,todayIso:'2026-10-20'}), /primeiro dia/);
});
