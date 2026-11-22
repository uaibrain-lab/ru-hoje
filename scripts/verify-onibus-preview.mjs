/**
 * Gate da homologação Ônibus: impede publicar um Hub sem o catálogo municipal.
 * Execute após "node scripts/stage-externo.mjs /caminho/do/artefato".
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {localServiceDay,validExternoManifest} from '../public/assets/onibus.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=async name=>readFile(path.join(root,'public',name),'utf8');
const json=async name=>JSON.parse(await file(name));
const [manifest,qa,arrivals,stops,routes,patterns,hub,interno]=await Promise.all([
  json('externo/catalog/manifest.json'),
  json('externo/hub-v1-qa.json'),
  json('externo/catalog/arrivals/index.json'),
  json('externo/catalog/stops.json'),
  json('externo/catalog/routes.json'),
  json('externo/catalog/patterns.json'),
  file('index.html'),
  file('interno/index.html')
]);
const today=localServiceDay();
const legacy=await file('externo/index.html');
assert.match(legacy,/HUB_ONIBUS_LEGACY_ALIAS/,
  'A interface externa antiga precisa redirecionar ao Hub');
assert.doesNotMatch(legacy,/Veículos encontrados|Escolha o sentido|GPS recente/,
  'O antigo painel vazio não pode ser publicado');

assert.ok(validExternoManifest(manifest,today),'O GTFS municipal não está válido para hoje');
assert.equal(qa.status,'passed','O pacote municipal não passou pelo QA oficial');
assert.equal(qa.gtfsVersion,manifest.gtfsVersion,'Versões do GTFS divergentes');
assert.equal(arrivals.version,manifest.gtfsVersion,'Versão dos horários divergente');
assert.equal(arrivals.validThrough,manifest.feedEndDate,'Validade dos horários divergente');
assert.equal(arrivals.buckets,256,'Faltam shards de horários por ponto');
assert.equal(qa.gpsProvider,'gtfs_rt','Origem GPS inesperada');
assert.equal(qa.gpsProbePassed,true,'GPS municipal sem comprovação no pacote');

const stopId='14791950';
assert.ok(stops && !Array.isArray(stops) && Array.isArray(stops[stopId]),
  'O ponto municipal usado no relato está ausente do catálogo');
assert.ok(Array.isArray(routes)&&routes.length>0,'Nenhuma linha municipal no catálogo');
assert.ok(Array.isArray(patterns)&&patterns.some(p=>p.stops?.includes(stopId)),
  'O ponto de regressão não possui percurso municipal no catálogo');
const routeIds=new Set(routes.map(r=>String(r.id)));
assert.ok(patterns.some(p=>p.stops?.includes(stopId)&&routeIds.has(String(p.route))),
  'Nenhuma linha municipal foi associada ao ponto de regressão');

assert.match(hub,/id="interno-frame"/,'Iframe unificado ausente');
assert.doesNotMatch(hub,/id="externo-frame"/,'Segunda interface não pode reaparecer');
assert.match(interno,/data-line-filter-mode/,'Filtro de linhas ausente');
assert.doesNotMatch(interno,/id="map-filter-toggle"/,'Filtro flutuante antigo não pode reaparecer');
assert.match(interno,/id="toggle-internal-points"/,'Controle de internos ausente');
assert.match(interno,/id="toggle-municipal-points"/,'Controle de municipais ausente');
assert.match(interno,/function toggleMapLayer\(source\)/,'Camadas não são independentes');
assert.doesNotMatch(interno,/UFMG \+ BH ·/,'Status redundante não pode reaparecer');
assert.match(interno,/id="map-point-legend"/,'Legenda visual ausente');
assert.ok(interno.indexOf('Internos <small>')<interno.indexOf('Municipais <small>'),
  'Linhas internas precisam vir antes das municipais');
assert.match(interno,/function municipalStopView\(/,'Detalhes de ponto municipal ausentes');
assert.match(interno,/function municipalLineView\(/,'Detalhes de linha municipal ausentes');

console.log('HUB_ONIBUS_PREVIEW_ASSETS_OK',JSON.stringify({
  gtfsVersion:manifest.gtfsVersion,validThrough:manifest.feedEndDate,
  municipalRoutes:routes.length,municipalStops:Object.keys(stops).length,
  regressionStop:stopId,servedPatterns:patterns.filter(p=>p.stops?.includes(stopId)).length,
  gpsProof:qa.gpsProbeCheckedAtUtc
}));
