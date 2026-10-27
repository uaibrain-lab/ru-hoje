import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const ui=read('public/assets/festas.js');
const rules=read('firestore.rules');
const executor=read('github-qa-executor/scripts/run-raffles-qa.mjs');
const migration=read('scripts/migrate-archived-qa.mjs');
const backend=read('public/assets/festas-backend.js');

test('RC1: cliente não pode apagar evento nem entry; arquivamento é transacional',()=>{
 assert.match(rules,/match \/events\/\{eventId\}[\s\S]*?allow delete: if false/);
 assert.match(rules,/match \/entries\/\{uid\}[\s\S]*?allow delete: if false/);
 assert.doesNotMatch(ui,/batch\.delete\(row\.ref\)/);
 assert.match(ui,/tx\.update\(ref,\{archived:true,published:false/);
 assert.match(ui,/if\(pub\.exists\(\)\|\|priv\.exists\(\)/);
});
test('RC1: consulta com archived false e listener restrito à aba Festas',()=>{
 assert.match(ui,/where\('published','==',true\),dbMod\.where\('archived','==',false\)/);
 assert.match(ui,/function publicEventsActive\(\)/);
 assert.match(ui,/state\.eventsUnsubscribe=dbMod\.onSnapshot/);
 assert.doesNotMatch(ui,/setInterval\(\(\)=>\{if\(!document\.hidden\)refreshEvents\(\);\},30000\)/);
 assert.match(ui,/if\(tab==='festas'\)void refreshEvents\(\);else stopPublicEventsListener\(\);/);
});
test('RC1: transição drawn não pode ser feita pelo SDK cliente, results privado',()=>{
 assert.match(rules,/request\.resource\.data\.raffleStatus != 'drawn'/);
 assert.match(rules,/allow create, update, delete: if false; \/\/ Somente executor Admin SDK/);
 assert.match(rules,/get\(eventPath\(eventId\)\)\.data\.published == true/);
});
test('RC1: executor valida contagem do snapshot fechado, hash e projeto fixo QA',()=>{
 assert.match(executor,/const TARGET_PROJECT='bandeco-homologacao'/);
 assert.doesNotMatch(executor,/cardapioufmg/);
 assert.match(executor,/data\.participantCount!==entries\.length/);
 assert.match(executor,/latest\.data\(\)\.participantCount!==entries\.length/);
 assert.match(executor,/entriesSnapshotSha256/);
});
test('RC1: migração não escreve sem flags QA explícitas',()=>{
 assert.match(migration,/--project=bandeco-homologacao/);
 assert.match(migration,/--confirm=QA-ONLY-ARCHIVED-BACKFILL/);
 assert.match(migration,/Object\.hasOwn\(doc\.data\(\),'archived'\)/);
 assert.doesNotMatch(migration,/cardapioufmg/);
 assert.match(backend,/participantDbs=participantApps\.map/);
});

test('RC1: administração não consegue esconder sorteio aberto com inscrições',()=>{
 assert.match(rules,/resource\.data\.participantCount > 0/);
 assert.match(ui,/procure o procedimento administrativo de cancelamento/);
});
