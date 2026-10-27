import test from 'node:test';import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {encryptPrivate,drawAtMs} from '../public/assets/festas-core.js';
import {prepareRaffle,due} from '../scripts/raffle-engine.mjs';
const event={raffleStatus:'open',published:true,drawAtTimestamp:new Date('2020-01-01T00:00:00.000Z'),winnerCount:2,alternateCount:1};
test('apuração agendada requer horário válido e festa pública aberta',()=>{
  assert.equal(due(event),true);assert.equal(due({...event,drawAtTimestamp:new Date('2099-01-01T00:00:00.000Z')}),false);
  assert.equal(due({...event,raffleStatus:'drawn'}),false);
  assert.equal(due({...event,archived:true}),false);
});
test('drawAtTimestamp é a única autoridade temporal',()=>{
  const now=Date.parse('2026-10-20T12:00:00.000Z');
  assert.equal(drawAtMs({drawAtTimestamp:new Date(now),drawAtUtc:'2099-01-01T00:00:00.000Z'}),now);
  assert.equal(due({...event,drawAtTimestamp:new Date(now),drawAtUtc:'2099-01-01T00:00:00.000Z'},now),true);
  assert.equal(due({...event,drawAtTimestamp:new Date(now+1),drawAtUtc:'2020-01-01T00:00:00.000Z'},now),false);
  assert.equal(Number.isNaN(drawAtMs({drawAtTimestamp:'not-a-date'})),true);
  assert.equal(Number.isNaN(drawAtMs({})),true);
});
test('sorteio seguro deduplica @, protege nome e separa UIDs privados',async()=>{
  const keys=await webcrypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const pub=await webcrypto.subtle.exportKey('jwk',keys.publicKey),priv=await webcrypto.subtle.exportKey('jwk',keys.privateKey);
  const profiles=[];const entries=[];
  for(let i=0;i<5;i++){
    const uid='uid'+i,ig=i===4?'user0':'user'+i;
    profiles.push({uid,encrypted:await encryptPrivate({instagram:ig,name:'Pessoa Teste '+i,email:`p${i}@example.test`},pub,webcrypto.subtle,webcrypto)});
    entries.push({uid,createdAt:`2026-10-20T10:00:0${i}Z`,encryptedProfile:profiles.at(-1).encrypted});
  }
  const {publicResult,privateResult}=await prepareRaffle({event,entries,profiles,privateKey:priv});
  assert.equal(publicResult.eligibleCount,4);assert.equal(publicResult.participantCount,5);
  assert.equal(publicResult.winners.length,2);assert.equal(publicResult.alternates.length,1);
  assert.equal(new Set([...privateResult.winnerUids,...privateResult.alternateUids]).size,3);
  assert.equal(JSON.stringify(publicResult).includes('uid'),false);
  assert.equal(JSON.stringify(publicResult).includes('Pessoa Teste'),false);
  assert.equal(JSON.stringify(publicResult).includes('@user'),false);
});
test('zero participantes produz resultado vazio auditável sem fabricar pessoas',async()=>{
  const keys=await webcrypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const priv=await webcrypto.subtle.exportKey('jwk',keys.privateKey);
  const {publicResult,privateResult}=await prepareRaffle({event,entries:[],profiles:[],privateKey:priv});
  assert.deepEqual(publicResult.winners,[]);assert.deepEqual(publicResult.alternates,[]);
  assert.equal(publicResult.eligibleCount,0);assert.equal(privateResult.attemptedEntries,0);
});
test('menos elegíveis que vagas publica somente participantes reais',async()=>{
  const keys=await webcrypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const pub=await webcrypto.subtle.exportKey('jwk',keys.publicKey),priv=await webcrypto.subtle.exportKey('jwk',keys.privateKey);
  const encryptedProfile=await encryptPrivate({instagram:'unica',name:'Pessoa Única',email:'unica@example.test'},pub,webcrypto.subtle,webcrypto);
  const {publicResult,privateResult}=await prepareRaffle({event,entries:[{uid:'uid-unica',createdAt:'2026-10-20T10:00:00Z',encryptedProfile}],profiles:[],privateKey:priv});
  assert.equal(publicResult.winners.length,1);assert.equal(publicResult.alternates.length,0);
  assert.deepEqual(privateResult.winnerUids,['uid-unica']);
});
test('chave errada ou inscrições totalmente corrompidas bloqueiam publicação',async()=>{
  const keys=await webcrypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const priv=await webcrypto.subtle.exportKey('jwk',keys.privateKey);
  await assert.rejects(()=>prepareRaffle({event,entries:[{uid:'uid-corrompida',encryptedProfile:{wrappedKey:'x'}}],profiles:[],privateKey:priv}),/Nenhuma inscrição/);
});
