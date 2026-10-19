import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {mergeSnapshots} from '../scripts/merge-snapshots.mjs';
import {auditApiDiagnostics} from '../scripts/prepare-api-snapshot.mjs';
import {RU_SOURCES,SOURCE_PAGE,parseMenuJson} from '../scripts/fump-api.mjs';

const DAY='2026-10-19';
const NOW=new Date('2026-10-19T17:00:00Z');
const oldAt='2026-10-19T12:00:00Z', newAt='2026-10-19T16:00:00Z';
const meal=(name,at=oldAt)=>({items:[{name,category:'proteina'}],fetchedAt:at});
const ru=(meals,at=oldAt)=>({meals, fetchedAt:at, sourceRestaurantId:'6'});
const snap=(date,restaurants,at=oldAt,complete=[])=>({schemaVersion:1,generatedAt:at,source:SOURCE_PAGE,days:{[date]:{restaurants}}, verifiedCompleteDates:complete});

test('data auditada substitui almoço e remove jantar retirado da API',()=>{
  const old=snap(DAY,{'setorial-i':ru({almoco:meal('Carne'),jantar:meal('Sopa')})});
  const fresh=snap(DAY,{'setorial-i':ru({almoco:meal('Peixe',newAt)},newAt)},newAt,[DAY]);
  const merged=mergeSnapshots(old,fresh,NOW);
  assert.deepEqual(Object.keys(merged.days[DAY].restaurants['setorial-i'].meals),['almoco']);
  assert.equal(merged.days[DAY].restaurants['setorial-i'].meals.almoco.items[0].name,'Peixe');
  assert.equal(merged.days[DAY].restaurants['setorial-i'].sourceRestaurantId,'6');
});

test('data auditada remove RU explicitamente ausente e preserva RU existente',()=>{
  const old=snap(DAY,{
    'setorial-i':ru({almoco:meal('Antigo')}),
    'saude':ru({almoco:meal('Saúde')}),
  });
  const fresh=snap(DAY,{'saude':ru({almoco:meal('Novo',newAt)},newAt)},newAt,[DAY]);
  const merged=mergeSnapshots(old,fresh,NOW);
  assert.equal(merged.days[DAY].restaurants['setorial-i'],undefined);
  assert.equal(merged.days[DAY].restaurants.saude.meals.almoco.items[0].name,'Novo');
});

test('data não coletada permanece; data auditada vazia desaparece',()=>{
  const yesterday='2026-10-18';
  const old=snap(DAY,{'setorial-i':ru({almoco:meal('Ontem')})});
  old.days[yesterday]={restaurants:{saude:ru({almoco:meal('Ontem saúde')})}};
  const fresh=snap(DAY,{},newAt,[DAY]);
  const merged=mergeSnapshots(old,fresh,NOW);
  assert.equal(merged.days[DAY],undefined);
  assert.equal(merged.days[yesterday].restaurants.saude.meals.almoco.items[0].name,'Ontem saúde');
});

test('sem prova completa, a política conservadora mantém jantar anterior',()=>{
  const old=snap(DAY,{'setorial-i':ru({almoco:meal('Carne'),jantar:meal('Sopa')})});
  const fresh=snap(DAY,{'setorial-i':ru({almoco:meal('Peixe',newAt)},newAt)},newAt);
  const merged=mergeSnapshots(old,fresh,NOW);
  assert.ok(merged.days[DAY].restaurants['setorial-i'].meals.jantar);
});

test('datas auditadas falsas, duplicadas ou sem snapshot são rejeitadas',()=>{
  const base=snap(DAY,{},newAt,[DAY]);
  assert.throws(()=>mergeSnapshots(null,{...base,verifiedCompleteDates:[DAY,DAY]},NOW),/datas verificadas/);
  assert.throws(()=>mergeSnapshots(null,{...base,verifiedCompleteDates:['2026-10-20']},NOW),/datas verificadas/);
  assert.throws(()=>mergeSnapshots(null,{...base,verifiedCompleteDates:['2026-02-30']},NOW),/datas verificadas/);
});

const raw={cardapios:[{refeicoes:[{tipoRefeicao:'Almoço',pratos:[
  {tipoPrato:'Entrada 1',descricaoPrato:'Salada'},
  {tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz'},
]}]}]};
async function fixture(allEmpty=false){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ruhoje-coverage-'));
  const save=(name,val)=>fs.writeFile(path.join(dir,name),JSON.stringify(val));
  await save('raw-restaurantes.json',[
    {id:6,nome:'RU Setorial I'},{id:1,nome:'RU Setorial II'},
    {id:2,nome:'RU Saúde e Direito'},{id:5,nome:'RU ICA'},
  ]);
  const ts='2026-10-19T16:00:00Z';
  const candidate={schemaVersion:1,generatedAt:ts,source:SOURCE_PAGE,days:{}};
  const summary={mode:'diagnostico-sem-publicacao',success:0,empty:0,failures:[],rows:[]};
  for (const source of RU_SOURCES){
    const response=(allEmpty || source.sourceId==='6') ? {cardapios:[]} : raw;
    await save(`raw-${DAY}-id${source.sourceId}.json`,response);
    const {meals,meta}=parseMenuJson(response,{iso:DAY,sourceId:source.sourceId});
    if (!Object.keys(meals).length){summary.empty++;summary.rows.push({iso:DAY,sourceId:source.sourceId,status:'sem cardapio',meta});continue;}
    summary.success++;
    summary.rows.push({iso:DAY,sourceId:source.sourceId,status:'capturado-nao-validado',meta});
    for(const id of source.appIds){
      (candidate.days[DAY] ||= {restaurants:{}}).restaurants[id]={
        meals:Object.fromEntries(Object.entries(meals).map(([k,v])=>[k,{...v,fetchedAt:ts}])),
        fetchedAt:ts,sourceRestaurantId:source.sourceId};
    }
  }
  await save('candidate.json',candidate);await save('summary.json',summary);
  return dir;
}

test('auditoria cobre quatro fontes, inclusive a explicitamente vazia',async t=>{
  const dir=await fixture();t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const result=await auditApiDiagnostics(dir);
  assert.deepEqual(result.report.verifiedCompleteDates,[DAY]);
  assert.equal(result.report.empty,1);
});

test('auditoria bloqueia remoção em massa quando as quatro fontes ficam vazias',async t=>{
  const dir=await fixture(true);t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await assert.rejects(auditApiDiagnostics(dir),/nenhuma refeição|todas as fontes vazias/);
});

test('dia futuro sem pratos não bloqueia a coleta de hoje nem entra nas datas autoritativas',async t=>{
  const dir=await fixture();t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const tomorrow='2026-10-20';
  const summary=JSON.parse(await fs.readFile(path.join(dir,'summary.json'),'utf8'));
  for (const source of RU_SOURCES){
    const response={cardapios:[]};
    await fs.writeFile(path.join(dir,`raw-${tomorrow}-id${source.sourceId}.json`),JSON.stringify(response));
    const {meta}=parseMenuJson(response,{iso:tomorrow,sourceId:source.sourceId});
    summary.empty++;
    summary.rows.push({iso:tomorrow,sourceId:source.sourceId,status:'sem cardapio',meta});
  }
  await fs.writeFile(path.join(dir,'summary.json'),JSON.stringify(summary));
  const result=await auditApiDiagnostics(dir,{requireToday:true,todayIso:DAY});
  assert.deepEqual(result.report.dates,[DAY,tomorrow]);
  assert.deepEqual(result.report.verifiedCompleteDates,[DAY]);
  assert.equal(result.snapshot.days[tomorrow],undefined);
});
