import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../public/assets/festas.js',import.meta.url),'utf8');

test('readback administrativo de cartaz usa a instância Firestore admin',()=>{
  const start=source.indexOf('async function paintPoster');
  const end=source.indexOf('\nasync function optimizePoster',start);
  assert.ok(start>=0&&end>start,'paintPoster não encontrado');
  const block=source.slice(start,end);
  assert.match(block,/const posterDb=state\.admin\?adminDb:db/);
  assert.match(block,/dbMod\.doc\(posterDb,'eventPosters',event\.id\)/);
  assert.doesNotMatch(block,/getDoc\(dbMod\.doc\(db,'eventPosters'/);
});

test('readback mantém contrato de payload WebP/JPEG e não registra conteúdo',()=>{
  const start=source.indexOf('function safePosterDataUrl');
  const end=source.indexOf('\nasync function paintPoster',start);
  const block=source.slice(start,end);
  assert.match(block,/data:image\\\/\(\?:webp\|jpeg\)/);
  assert.doesNotMatch(block,/console\.(log|info|debug).*imageDataUrl/);
});
