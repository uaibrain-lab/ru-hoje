import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {addDate, RU_SOURCES} from '../scripts/fump-api.mjs';

const wf = fs.readFileSync(new URL('../.github/workflows/sync-cardapios.yml', import.meta.url),'utf8');
const collector = fs.readFileSync(new URL('../scripts/sync-api.mjs', import.meta.url),'utf8');
const auditor = fs.readFileSync(new URL('../scripts/prepare-api-snapshot.mjs', import.meta.url),'utf8');

test('workflow legado manual permite consultar 7 datas, nao apenas tres', () => {
  assert.match(wf, /options: \['1', '2', '3', '4', '5', '6', '7'\]/);
  assert.match(wf, /default: '7'/);
  assert.match(wf, /DAYS: \$\{\{ github\.event\.inputs\.days \|\| '7' \}\}/);
  assert.match(wf, /node scripts\/sync-api\.mjs --days "\$DAYS"/);
});

test('coleta aceita e limita sete dias, mantendo auditoria de todas as fontes', () => {
  assert.match(collector, /const days=ix<0 \? 7 : Number\(args\[ix\+1\]\)/);
  assert.match(collector, /days>7/);
  assert.match(auditor, /RU_SOURCES\.length \* 7/);
  assert.match(auditor, /rows\.length !== dates\.length \* RU_SOURCES\.length/);
  assert.equal(RU_SOURCES.length,4);
  assert.equal(addDate('2026-10-19',6),'2026-10-25');
  assert.equal(addDate('2026-10-22',2),'2026-10-24');
});

test('coleta manual nao cria cron e mantem autorizacao explicita de publicacao', () => {
  assert.doesNotMatch(wf,/^  schedule:/m);
  assert.match(wf,/workflow_dispatch:/);
  assert.match(wf, /RU_SYNC_SCHEDULE_ENABLED == 'true'/);
  assert.match(wf, /RU_SYNC_PUBLISH_ENABLED == 'true'/);
  assert.match(wf, /inputs\.publish == true/);
});
