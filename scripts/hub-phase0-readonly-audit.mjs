/**
 * Hub UFMG: auditoria local e SOMENTE LEITURA antes de cada fase do roadmap.
 *
 * Sem rede, Firebase, Cloudflare, credenciais, deploy ou gravações.
 * A lista de verificações cobre contratos de segurança que devem sobreviver
 * às refatorações; ajustes propositais exigem revisão explícita dos testes.
 */
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const localRead = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ok = (id,pass,detail) => ({id,pass:pass===true,detail});

export function auditPhaseZero(read=localRead) {
  const sw=read('public/service-worker.js');
  const html=read('public/index.html');
  const internal=read('public/interno/index.html');
  const proxy=read('worker/fump-proxy.mjs');
  const source=read('public/assets/fump-live.js');
  const app=read('public/assets/app.js');
  const firestore=read('firestore.rules');
  const raffle=read('.github/workflows/hub-production-raffles.yml');
  const raffleAlert=read('.github/workflows/hub-production-raffle-alert.yml');

  const inlineStart=internal.indexOf('const D=');
  const inlineEnd=internal.indexOf(';\nconst S=',inlineStart);
  let dataset=null,backup=null;
  try {
    dataset=JSON.parse(internal.slice(inlineStart+'const D='.length,inlineEnd));
    backup=JSON.parse(read('backups/interno/rotas-paradas-horarios-2026-11-17.json'));
  } catch { /* erro reportado pelo teste, sem reparar ou inventar dados */ }
  const variantCount=dataset?.linhas?.categoriasDias?.reduce((n,x)=>n+(x.linhas?.length||0),0);
  const menuWorkflows=['hub-production-cardapios.yml','hub-production-request-processor.yml','hub-production-watchdog.yml','sync-cardapios.yml'];
  const menusManual=menuWorkflows.every(name=>{
    const workflow=read('.github/workflows/'+name);
    return /workflow_dispatch:/.test(workflow) && !/^  schedule:/m.test(workflow);
  });
  const results=[
    ok('FUMP_FIXED_UPSTREAM',
      proxy.includes("const API_ORIGIN = 'https://fump.ufmg.br:3003'") &&
      proxy.includes("const IDS = new Set(['1','2','5','6'])") &&
      proxy.includes("if (request.method!=='GET')") &&
      proxy.includes("if (origin && !ALLOWED_ORIGINS.has(origin))"),
      'Proxy apenas GET, quatro IDs e origem FUMP fixa'),
    ok('FUMP_CLIENT_NO_WRITE',
      source.includes("method:'GET',mode:'cors',credentials:'omit'") &&
      source.includes("const APP_TO_SOURCE = Object.freeze({") &&
      app.includes('readLiveMenu(') &&
      !/menuSyncRequests\/current|requestCommunityRefresh\(/.test(app),
      'Navegador consulta cardápios sem endpoint de gravação'),
    ok('FIRESTORE_MENU_DENY_WRITE',
      /match \/publicMenus\/current\s*\{[^}]*allow list, create, update, delete: if false;/s.test(firestore) &&
      /match \/menuSyncRequests\/current\s*\{[^}]*allow read, write: if false;/s.test(firestore),
      'Coleções legadas de cardápios rejeitam escrita de cliente'),
    ok('MENU_AUTHORITATIVE_ONLY',
      app.includes('function menuFor(date, ruId) { return liveMenuFor(date,ruId); }') &&
      app.includes('state.liveMenus.delete(key)') &&
      !/firestore\.googleapis\.com|publicMenus\/current|\/data\/cardapios\.json|hydrateLiveMenus\(|persistLiveMenus\(|fetchMenus\(/.test(app) &&
      !sw.includes("'/data/cardapios.json'") &&
      !/publicFeedUrl/.test(read('public/config.js')),
      'A interface só exibe cardápios da FUMP: sem Firestore, estático ou menu duradouro'),
    ok('RAFFLE_SINGLE_SCHEDULE_GATED',
      /cron: '10 21 \* \* 3-5'/.test(raffle) &&
      raffle.includes("vars.HUB_PROD_RAFFLES_ENABLED == 'true'") &&
      raffle.includes("github.ref == 'refs/heads/main'") &&
      raffle.includes('node scripts/run-raffles-production.mjs --commit') &&
      raffle.includes('group: hub-production-raffles'),
      'Executor de sorteios continua com janela, gate e concorrência controlada'),
    ok('RAFFLE_MONITOR_NO_DRAW',
      /cron: '15 22 \* \* 3-5'/.test(raffleAlert) &&
      !/PRIVATE_KEY_JWK|run-raffles-production|id-token: write/.test(raffleAlert),
      'Monitor de sorteios não contém credenciais de sorteio'),
    ok('MENU_SCHEDULES_MANUAL',
      menusManual,
      'Sincronização de cardápios legado não é agendada automaticamente'),
    ok('INTERNO_DATA_SNAPSHOT_MATCH',
      dataset?.paradas?.length===49 &&
      variantCount===13 &&
      isDeepStrictEqual(dataset,backup) &&
      read('backups/interno/LICENSE-INTERNOROTAS').includes('MIT License'),
      'Backup independente idêntico às 49 paradas e 13 variantes de linha'),
    ok('INTERNO_CANONICAL_PWA',
      html.includes('src="/interno"') &&
      sw.includes("url.pathname==='/interno/index.html'") &&
      sw.includes("event.request.mode==='navigate'") &&
      sw.includes("if(url.origin!==self.location.origin) return"),
      'A página Interno usa rota canônica e SW não intercepta origens externas')
  ];
  return {
    phase:0, mode:'read-only', timestamp:new Date().toISOString(),
    checks:results, passed:results.filter(x=>x.pass).length,
    failed:results.filter(x=>!x.pass).map(x=>x.id),
    observedTechnicalDebt:[
      'Fase 1: Firestore/JSON e menu local foram retirados da exibição; revisar cache do Worker na Fase 2',
      'Interno ainda carrega Leaflet externo e tiles OSM; contingência na Fase 5',
      'Sorteios ainda dependem de GitHub Actions; migrar apenas após homologação da Fase 6',
      'Cache do Worker usa 240 s e pode servir resposta anterior; revisar na Fase 2'
    ]
  };
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const result=auditPhaseZero();
  console.log(JSON.stringify(result,null,2));
  if(result.failed.length) process.exitCode=1;
}
