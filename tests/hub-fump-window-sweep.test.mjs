import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarWindow,collectWindowResponse,sweepWindow} from '../scripts/fump-window-classification-sweep.mjs';

test('varredura cobre exatamente 15 datas e quatro fontes sem repetição',async()=>{
  const dates=calendarWindow('2026-11-17');
  assert.equal(dates.length,15);
  assert.equal(dates[0],'2026-11-17');
  assert.equal(dates.at(-1),'2026-12-01');
  const calls=[];
  const fake=async url=>{
    const parsed=new URL(url),id=parsed.searchParams.get('id'),date=parsed.searchParams.get('data');
    calls.push({id,date});
    const name=id==='6'?'Quibe assado com lentilha':
      id==='1'?'Espinafre com ricota e abobrinha':
      id==='2'?'Prato totalmente desconhecido':'Molho de Manjericão';
    const tipo=id==='5'?'Tipo de item não cadastrado':'Prato protéico 1';
    return new Response(JSON.stringify({id:Number(id),cardapios:[{
      data:date,refeicoes:[{tipoRefeicao:'Almoço',pratos:[
        {tipoPrato:tipo,descricaoPrato:name}
      ]}]
    }]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const report=await sweepWindow({today:'2026-11-17',fetchFn:fake,pauseMs:0});
  assert.equal(report.attempted,60);
  assert.equal(report.ok,60);
  assert.equal(report.empty,0);
  assert.equal(report.records,60);
  assert.equal(report.complete,true);
  assert.equal(new Set(calls.map(c=>c.id+'|'+c.date)).size,60);
  assert.equal(report.unclassified.length,0);
  assert.deepEqual(report.officialDisagreements.map(d=>d.name).sort(),
    ['Espinafre com ricota e abobrinha','Quibe assado com lentilha'].sort());
  assert.deepEqual(report.unknownNames.map(d=>d.name),['Prato totalmente desconhecido']);
});

test('429 interrompe imediatamente para respeitar a API e marca relatório incompleto',async()=>{
  let calls=0;
  const report=await sweepWindow({today:'2026-11-17',pauseMs:0,fetchFn:async()=>{
    calls++;
    return new Response('{}',{status:429});
  }});
  assert.equal(calls,1);
  assert.equal(report.complete,false);
  assert.equal(report.aborted,true);
  assert.equal(report.errors[0].error,'HTTP_429');
});

test('data de resposta divergente da data consultada não é aceita',()=>{
  const report={names:new Map(),totalDishes:0};
  assert.throws(()=>collectWindowResponse(report,{
    id:'6',date:'2026-11-17',json:{id:6,cardapios:[{
      data:'2026-11-18',refeicoes:[{tipoRefeicao:'Almoço',pratos:[]}]
    }]}
  }),/DATE_MISMATCH/);
  assert.equal(report.totalDishes,0);
});
