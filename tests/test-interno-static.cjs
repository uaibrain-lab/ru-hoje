// Teste de integridade e regressão do módulo Interno (não acessa rede/Firebase).
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../public/interno/index.html'),'utf8');
const match=src.match(/const D=(\{[^;]+\});\s*const S=/);
assert.ok(match, 'Dataset D não encontrado');
const d=JSON.parse(match[1]);
assert.equal(d.paradas.length,49);
const cats=d.linhas.categoriasDias;
assert.deepEqual(cats.map(x=>x.categoriaDia), ['diasUteis','sabado','feriasRecessos']);
const routes=cats.flatMap(x=>x.linhas);
assert.equal(routes.length,13);
assert.equal(new Set(routes.map(r=>r.idRota)).size,13);
const ids=new Set(d.paradas.map(p=>p.idParada));
assert.equal(ids.size,49);
for (const p of d.paradas) assert.ok(Array.isArray(p.coordenadas) && p.coordenadas.length===2,p.idParada);
for (const r of routes){
  assert.ok(r.horarios.length>0,r.idRota);
  assert.ok(r.itinerarioParadasIds.every(i=>ids.has(i)),r.idRota);
  assert.ok(r.trajetoDetalhado.every(s=>ids.has(s.idParada)),r.idRota);
}
assert.ok(src.includes("localStorage.getItem('bandeco_interno_favoritos_v1')"));
assert.ok(!src.includes("localStorage.getItem('fav')"));
assert.ok(src.includes('if(window.L)'), 'Fallback quando Leaflet não carrega deve existir');
assert.ok(src.includes('e.origin!==window.location.origin'), 'Listener entre abas deve filtrar origem');
assert.ok(src.includes('Não usa GPS'), 'Aviso sobre estimativas deve existir');
assert.ok(src.includes('Copyright (c) 2023 internorotas'), 'Atribuição MIT deve permanecer');
console.log('INTERNO_STATIC_PASS=1');
