import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isNonOperatingDay} from '../public/assets/date-availability.js';

const iso='2026-11-17'; // terça-feira
const saturday='2026-11-21';
const sunday='2026-11-22';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('dias úteis não têm bolinha, mesmo quando a FUMP não publicou cardápio',()=>{
  for(const ru of ['setorial-i','setorial-ii','saude','direito','ica']) {
    assert.equal(isNonOperatingDay(iso,ru),false,ru);
    assert.equal(isNonOperatingDay('2026-11-20',ru),false,ru);
  }
});

test('sábado depende dos horários regulares de cada RU, não dos pratos',()=>{
  for(const ru of ['setorial-i','saude','ica']) {
    assert.equal(isNonOperatingDay(saturday,ru),false,ru+' atende aos sábados');
  }
  for(const ru of ['setorial-ii','direito']) {
    assert.equal(isNonOperatingDay(saturday,ru),true,ru+' não atende regularmente aos sábados');
  }
});

test('domingo é marcado para todos os RUs; sem RU e data inválida não gera bolinha',()=>{
  for(const ru of ['setorial-i','setorial-ii','saude','direito','ica']) {
    assert.equal(isNonOperatingDay(sunday,ru),true,ru);
  }
  assert.equal(isNonOperatingDay(sunday,null),false);
  assert.equal(isNonOperatingDay(sunday,'ru-nao-existente'),false);
  assert.equal(isNonOperatingDay('2026-02-30','setorial-i'),false);
  assert.equal(isNonOperatingDay('not-a-date','setorial-i'),false);
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
  assert.ok(app.includes('return isNonOperatingDay(iso,ruId)'));
  assert.ok(app.includes('sem atendimento regular previsto'));
  assert.ok(!app.includes('sem cardápio carregado'));
});
