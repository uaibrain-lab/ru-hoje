import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const path='../public/interno/index.html';
const backupPath='../backups/interno/rotas-paradas-horarios-2026-11-17.json';

function originalData() {
  const html=read(path);
  const start=html.indexOf('const D=');
  const end=html.indexOf(';\nconst S=',start);
  assert.ok(start>=0 && end>start,'A origem inline de dados do Interno deve existir');
  return JSON.parse(html.slice(start+'const D='.length,end));
}

test('backup independente é idêntico aos dados de paradas/linhas/horários publicados no Hub',()=>{
  const snapshot=JSON.parse(read(backupPath));
  const inline=originalData();
  assert.deepEqual(snapshot,inline,
    'Dados usados na página diferem do backup: atualizar conscientemente após revisar a origem');
  const sourceHash=createHash('sha256').update(JSON.stringify(inline)).digest('hex');
  const backupHash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  assert.equal(backupHash,sourceHash);
});

test('backup preserva 49 paradas e 13 variantes de linha com coordenadas e horários',()=>{
  const data=JSON.parse(read(backupPath));
  assert.equal(data.paradas.length,49);
  assert.ok(data.paradas.every(p=>p.idParada && p.nome &&
    Array.isArray(p.coordenadas) && p.coordenadas.length===2 &&
    p.coordenadas.every(Number.isFinite)));
  assert.equal(new Set(data.paradas.map(p=>p.idParada)).size,49);
  const variants=data.linhas.categoriasDias.flatMap(x=>x.linhas);
  assert.equal(variants.length,13);
  assert.ok(variants.every(line=>Array.isArray(line.coordenadasTrajeto) && line.coordenadasTrajeto.length>0));
  assert.equal(data.paradas.find(p=>p.idParada==='P01')?.nome,'Escola de Música (Ida)');
});

test('origem e licença MIT de terceiros ficam preservadas no próprio backup',()=>{
  const license=read('../backups/interno/LICENSE-INTERNOROTAS');
  const help=read('../backups/interno/README.md');
  assert.match(license,/MIT License/);
  assert.match(license,/Copyright \(c\) 2023 internorotas/);
  assert.match(help,/https:\/\/github\.com\/internorotas\/ufmg/);
  assert.match(help,/OpenStreetMap/);
});
