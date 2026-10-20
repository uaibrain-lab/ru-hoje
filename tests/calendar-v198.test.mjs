import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hasMenuForDate, isMissingMenu, dateChipLabel} from '../public/assets/date-availability.js';

const fixture = {
  schemaVersion: 1,
  days: {
    '2026-10-24': {restaurants:{saude:{meals:{almoco:{items:[{name:'Prato do sábado'}]}}},
      direito:{meals:{}}}},
    '2026-10-25': {restaurants:{saude:{meals:{almoco:{items:[{name:'Domingo experimental'}]}}}}},
    '2026-10-26': {restaurants:{saude:{meals:{almoco:{items:[]}, jantar:{items:[]}}}}},
    '2026-10-27': {restaurants:{direito:{meals:{almoco:{items:[{name:'Prato de segunda'}]}}}}},
  },
};

test('pontinho só em datas sem cardápio publicado para o RU selecionado',()=>{
  assert.equal(isMissingMenu(fixture,'2026-10-24','saude'),false);
  assert.equal(isMissingMenu(fixture,'2026-10-24','direito'),true);
  assert.equal(isMissingMenu(fixture,'2026-10-26','saude'),true);
  assert.equal(isMissingMenu(fixture,'2026-10-27','saude'),true);
  assert.equal(isMissingMenu(fixture,'2026-10-27','direito'),false);
});

test('domingo com cardápio não tem ponto; domingo sem cardápio tem ponto',()=>{
  assert.equal(isMissingMenu(fixture,'2026-10-25','saude'),false);
  assert.equal(isMissingMenu(fixture,'2026-11-01','saude'),true);
  assert.equal(hasMenuForDate(fixture,'2026-10-25','saude'),true);
});

test('antes de carregar dados, não afirma indisponibilidade',()=>{
  assert.equal(isMissingMenu(null,'2026-10-25','saude'),false);
  assert.equal(isMissingMenu(undefined,'2026-10-25','saude'),false);
  assert.equal(isMissingMenu({days:{}},'2026-10-25','saude'),true);
});

test('sem RU escolhido, o ponto só aparece quando nenhum tem prato',()=>{
  assert.equal(isMissingMenu(fixture,'2026-10-24',null),false);
  assert.equal(isMissingMenu(fixture,'2026-10-26',null),true);
});

test('preserva destaque de hoje sem ponto quando há menu',()=>{
  assert.equal(dateChipLabel(true,false),'hoje');
  assert.equal(dateChipLabel(true,true),'hoje ·');
  assert.equal(dateChipLabel(false,true),'·');
  assert.equal(dateChipLabel(false,false),'');
});

test('frontend inclui domingos, atualiza os pontos quando chegam dados e muda o RU',()=>{
  const app=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
  const sw=fs.readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8');
  assert.match(app,/for \(let offset = 0; offset < 15; offset\+\+\)/);
  assert.doesNotMatch(app,/getUTCDay\(\) === 0\) continue/);
  assert.match(app,/isMissingMenu\(state\.data, iso, state\.selectedRu\)/);
  assert.match(app,/renderRestaurant\(\);\s*renderDates\(\);\s*renderMenus\(\);/);
  assert.match(app,/writeStore\(STORAGE_DATA, JSON\.stringify\(value\)\); \} catch \{\}\s*\/\/[^\n]+\s*renderDates\(\);/);
  assert.match(sw,/\/assets\/date-availability\.js/);
});

test('agenda somente seg-sex e sábado, em UTC e com horizonte de sete dias',()=>{
  const wf=fs.readFileSync(new URL('../.github/workflows/sync-cardapios.yml',import.meta.url),'utf8');
  const crons=[...wf.matchAll(/- cron: '([^']+)'/g)].map(m=>m[1]);
  assert.deepEqual(crons,['45 8 * * 1-5','30 12 * * 1-5','10 19 * * 1-5','0 13 * * 6']);
  assert.match(wf,/DAYS: \$\{\{ github\.event\.inputs\.days \|\| '7' \}\}/);
  assert.match(wf,/RU_SYNC_PUBLISH_ENABLED == 'true'/);
  assert.match(wf,/RU_SYNC_SCHEDULE_ENABLED == 'true'/);
});
