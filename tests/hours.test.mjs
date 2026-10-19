import test from 'node:test';
import assert from 'node:assert/strict';
import {REGULAR_HOURS,hoursFor,currentOpening,shortHour,weeklySummary,brClock} from '../public/assets/hours.js';
const moment=(date,clock)=>new Date(`${date}T${clock}-03:00`);
test('cinco restaurantes com horários locais e informação de sábado',()=>{
  assert.equal(Object.keys(REGULAR_HOURS).length,5);
  assert.deepEqual(hoursFor('setorial-i','2026-10-19').map(x=>x.id),['almoco','jantar']);
  assert.deepEqual(hoursFor('setorial-i','2026-10-24').map(x=>x.id),['almoco']);
  assert.deepEqual(hoursFor('setorial-ii','2026-10-24'),[]);
  assert.deepEqual(hoursFor('ica','2026-10-24').map(x=>x.id),['almoco']);
  assert.deepEqual(hoursFor('direito','2026-10-25'),[]);
});
test('limites exatos: abertura inclusiva, fechamento exclusivo',()=>{
  assert.equal(currentOpening('setorial-i',moment('2026-10-19','10:29:00')).state,'closed');
  assert.match(currentOpening('setorial-i',moment('2026-10-19','10:30:00')).message,/Aberto agora · fecha às 14h/);
  assert.equal(currentOpening('setorial-i',moment('2026-10-19','14:00:00')).state,'closed');
  assert.match(currentOpening('setorial-i',moment('2026-10-19','17:10:00')).message,/fecha às 19h30/);
  assert.equal(currentOpening('setorial-i',moment('2026-10-19','19:30:00')).state,'closed');
});
test('próxima abertura no mesmo dia, amanhã ou segunda',()=>{
  assert.match(currentOpening('setorial-i',moment('2026-10-19','14:30:00')).message,/abre às 17h10/);
  assert.match(currentOpening('saude',moment('2026-10-19','20:00:00')).message,/abre amanhã às 7h/);
  assert.match(currentOpening('setorial-ii',moment('2026-10-23','20:00:00')).message,/abre segunda-feira às 6h45/);
  assert.match(currentOpening('setorial-i',moment('2026-10-24','13:00:00')).message,/abre segunda-feira às 10h30/);
});
test('café da manhã e horários do ICA',()=>{
  assert.match(currentOpening('setorial-ii',moment('2026-10-19','06:45:00')).message,/fecha às 8h/);
  assert.match(currentOpening('ica',moment('2026-10-19','13:29:00')).message,/fecha às 13h30/);
  assert.equal(shortHour('06:45'),'6h45');
  assert.ok(weeklySummary('saude')[1].services.some(s=>s.includes('11h30–13h')));
});
test('fuso São Paulo independe do fuso da máquina',()=>{
  assert.equal(brClock(new Date('2026-10-20T01:00:00Z')).iso,'2026-10-19');
});
