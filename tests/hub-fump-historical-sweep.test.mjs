import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annualRanges,classifyHistoricalResponse,scanHistorical
} from '../scripts/fump-historical-classification-sweep.mjs';

test('intervalos anuais são disjuntos e incluem as bordas solicitadas',()=>{
  assert.deepEqual(annualRanges('2025-10-10','2026-02-02'),[
    {from:'2025-10-10',to:'2025-12-31'},
    {from:'2026-01-01',to:'2026-02-02'}
  ]);
  assert.throws(()=>annualRanges('2026-11-18','2026-11-17'),/INVALID_RANGE/);
});

test('varredura histórica cruza quatro fontes em ano parcial sem inventar cardápios',async()=>{
  const calls=[];
  const fake=async url=>{
    const p=new URL(url),id=p.searchParams.get('id'),
      from=p.searchParams.get('dataInicio'),to=p.searchParams.get('dataFim');
    assert.equal(p.origin,'https://fump.ufmg.br:3003');
    calls.push({id,from,to});
    return new Response(JSON.stringify({id:Number(id),cardapios:[{
      data:'2026-11-17T00:00:00.000Z',refeicoes:[{
        tipoRefeicao:'Almoço',pratos:[
          {tipoPrato:'Prato protéico 2',descricaoPrato:'Quibe de Cenoura'},
          {tipoPrato:'Tipo de item não cadastrado',descricaoPrato:'Prato sem categoria inventado'}
        ]
      }]
    }]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const result=await scanHistorical({from:'2026-11-17',to:'2026-11-18',
    fetchFn:fake,pauseMs:0});
  assert.equal(result.complete,true);
  assert.equal(result.expectedRangeQueries,4);
  assert.equal(result.success,4);
  assert.equal(result.records,8);
  assert.equal(calls.length,4);
  assert.equal(result.unclassified.length,1);
  assert.equal(result.unclassified[0].name,'Prato sem categoria inventado');
  assert.equal(result.unknownNames.length,1);
  assert.equal(result.conflictingOfficialTypes[0].name,'Quibe de Cenoura');
});

test('HTTP 429 aborta sem insistir em acesso à fonte oficial',async()=>{
  let n=0;
  const result=await scanHistorical({from:'2026-11-17',to:'2026-11-18',
    fetchFn:async()=>{n++;return new Response('rate limit',{status:429});},pauseMs:0});
  assert.equal(n,1);
  assert.equal(result.complete,false);
  assert.equal(result.aborted,true);
  assert.equal(result.errors[0].error,'HTTP_429');
});

test('um cardápio fora do intervalo pedido não entra na auditoria',()=>{
  const report={names:new Map(),records:0};
  assert.throws(()=>classifyHistoricalResponse({id:6,cardapios:[{
    data:'2026-11-18',refeicoes:[{tipoRefeicao:'Almoço',pratos:[]}]
  }]},{id:'6',from:'2026-11-17',to:'2026-11-17'},report),/DATE_UNVERIFIABLE/);
  assert.equal(report.records,0);
});
