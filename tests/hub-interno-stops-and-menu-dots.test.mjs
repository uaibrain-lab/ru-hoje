import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {needsMenuDot} from '../public/assets/date-availability.js';

const iso='2026-11-17'; // terça-feira
const saturday='2026-11-21';
const sunday='2026-11-22';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

function fixture(ru,date,items) {
  return {days:{[date]:{restaurants:{[ru]:{meals:{almoco:{items}}}}}}};
}

test('bolinha aparece antes de qualquer consulta em dia de atendimento regular',()=>{
  for(const ru of ['setorial-i','setorial-ii','saude','direito','ica']) {
    assert.equal(needsMenuDot(null,iso,ru),true,ru);
    assert.equal(needsMenuDot({days:{}},iso,ru),true,ru);
  }
});

test('bolinha persiste em erro ou HTTP 200 sem pratos, até carregar menu real',()=>{
  const snapshot={days:{}};
  assert.equal(needsMenuDot(snapshot,iso,'setorial-i'),true);
  assert.equal(needsMenuDot(fixture('setorial-i',iso,[]),iso,'setorial-i'),true);
  assert.equal(needsMenuDot(snapshot,iso,'setorial-i',true),false);
  assert.equal(needsMenuDot(fixture('setorial-i',iso,[{name:'Arroz'}]),iso,'setorial-i'),false);
  assert.equal(needsMenuDot(fixture('saude',iso,[{name:'Arroz'}]),iso,'setorial-i'),true);
});

test('bolinhas consideram horários de atendimento por RU sem inventar dias de abertura',()=>{
  assert.equal(needsMenuDot(null,saturday,'setorial-i'),true);
  assert.equal(needsMenuDot(null,saturday,'saude'),true);
  assert.equal(needsMenuDot(null,saturday,'ica'),true);
  assert.equal(needsMenuDot(null,saturday,'setorial-ii'),false);
  assert.equal(needsMenuDot(null,saturday,'direito'),false);
  for(const ru of ['setorial-i','setorial-ii','saude','direito','ica']) {
    assert.equal(needsMenuDot(null,sunday,ru),false,ru);
  }
  assert.equal(needsMenuDot(null,iso,null),false);
  assert.equal(needsMenuDot(null,iso,'ru-nao-existente'),false);
});

test('mapa mantém os 49 pontos com mesmo desenho e sem origem azul',()=>{
  const page=read('../public/interno/index.html');
  const start=page.indexOf('const D=');
  const end=page.indexOf(';\nconst S=',start);
  assert.ok(start>=0 && end>start);
  const data=JSON.parse(page.slice(start+'const D='.length,end));
  const origin=data.paradas.find(p=>p.nome==='Escola de Música (Ida)');
  assert.equal(origin.idParada,'P01');
  assert.equal(origin.categoria,'Ponto de Origem/Destino');
  assert.equal(data.paradas.length,49);
  assert.ok(page.includes("className:'interno-stop'"));
  assert.ok(page.includes("radius:7,"));
  assert.ok(page.includes("color:'#334155',"));
  assert.ok(page.includes("fillColor:'#ffffff'"));
  assert.ok(!page.includes("radius:origin?10:7"));
  assert.ok(!page.includes("color:origin?'#2386d1'"));
  assert.ok(!page.includes("className:origin?'interno-stop-origin'"));
  assert.ok(page.includes(".on('click',()=>go({t:'stop',id:p.idParada}))"));
});

test('aviso verboso da FUMP foi retirado sem esconder o estado sem cardápio',()=>{
  const app=read('../public/assets/app.js');
  assert.ok(!app.includes('A consulta à FUMP não retornou pratos nesta data. Isso não confirma que o RU esteja fechado.'));
  assert.ok(app.includes('list.append(renderNoMenu(ru,day))'));
  assert.ok(app.includes('return needsMenuDot(null,iso,ruId,!!liveMenuFor(iso,ruId))'));
});
