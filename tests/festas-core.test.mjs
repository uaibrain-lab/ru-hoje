import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs/promises';
import {handle,httpsUrl,maskHandle,validateProfile,validateEvent,secureShuffle,encryptPrivate,decryptPrivate,maskName,normalizeTags,drawEligible,csvSafe} from '../public/assets/festas-core.js';
const root=new URL('../',import.meta.url);
test('Instagram válido e máscara não expõem o @ integral',()=>{
  assert.equal(handle(' @Exemplo.abc '),'exemplo.abc');
  assert.equal(handle('@invalido!?'),'');
  assert.equal(maskHandle('@joaopedro'),'@jo••••');
  assert.equal(maskHandle('@x'),'@x••••');
});
test('URLs exigem HTTPS, sem dados de autenticação',()=>{
  assert.equal(httpsUrl('javascript:alert(1)'),'');
  assert.equal(httpsUrl('http://example.com'),'');
  assert.equal(httpsUrl('https://user:pass@example.com'),'');
  assert.ok(httpsUrl('https://tickets.example.com/festa').startsWith('https://'));
});
test('marketing é opt-in e regras precisam ser aceitas',()=>{
  const base={name:'Maria da Silva',course:'Medicina',email:'a@b.com',instagram:'@maria.silva',acceptTerms:true};
  assert.equal(validateProfile(base).marketingConsent,false);
  assert.equal(validateProfile({...base,marketingConsent:true}).marketingConsent,true);
  assert.throws(()=>validateProfile({...base,acceptTerms:false}),/aceite/);
});
test('sorteio exige regras em texto, data e número de ganhadores, sem limitar inscrições',()=>{
  const base={name:'Festa exemplo',place:'Belo Horizonte',organizer:'CATM',startsAt:'2026-11-06T22:00',ticketUrl:'https://example.com/ingressos',published:true};
  assert.equal(validateEvent(base).raffleStatus,'disabled');
  assert.throws(()=>validateEvent({...base,raffleStatus:'open',winnerCount:2}),/regras|horário/i);
  const e=validateEvent({...base,raffleStatus:'open',winnerCount:2,alternateCount:3,drawAt:'2026-11-06T18:00',rulesText:'Siga a página.'});
  assert.equal(e.winnerCount,2);
  assert.equal(e.alternateCount,3);
  assert.equal(e.rulesText,'Siga a página.');
  assert.throws(()=>validateEvent({...base,posterUrl:'data:image/svg+xml,evil'}),/HTTPS/);
});
test('tags, nomes censurados, CSV protegido e sorteio sem limite de inscrições',()=>{
  assert.deepEqual(normalizeTags(['Open Bar','Open Food','Open Bar','Não cadastrada']),['Open Bar','Open Food','Não cadastrada']);
  assert.equal(maskName('Maria Oliveira'),'Ma••• Ol••••••');
  assert.match(csvSafe('=1+1'),/^"'/);
  const people=Array.from({length:17},(_,i)=>({instagram:`pessoa${i}`,name:`Pessoa ${i}`}));
  const result=drawEligible(people,2,3,webcrypto);
  assert.equal(result.total,17);
  assert.equal(result.winners.length,2);
  assert.equal(result.alternates.length,3);
  assert.equal(new Set([...result.winners,...result.alternates].map(p=>p.instagram)).size,5);
});
test('AES-GCM + RSA-OAEP criptografam cadastro e não deixam PII legível',async()=>{
  const pair=await webcrypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const pub=await webcrypto.subtle.exportKey('jwk',pair.publicKey), priv=await webcrypto.subtle.exportKey('jwk',pair.privateKey);
  const original={name:'Nome Pessoal Privado',email:'exclusivo@example.com',instagram:'identidade',marketingConsent:false};
  const blob=await encryptPrivate(original,pub,webcrypto.subtle,webcrypto);
  assert.equal(blob.algorithm,'RSA-OAEP-SHA256+AES-256-GCM');
  assert.ok(!JSON.stringify(blob).includes(original.name));
  assert.ok(!JSON.stringify(blob).includes(original.email));
  assert.deepEqual(await decryptPrivate(blob,priv,webcrypto.subtle),original);
  const different=await webcrypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  assert.rejects(()=>decryptPrivate(blob,webcrypto.subtle.exportKey('jwk',different.privateKey),webcrypto.subtle));
});
test('apuração exige aleatoriedade criptográfica',()=>{
  assert.deepEqual(secureShuffle([3],webcrypto),[3]);
  assert.deepEqual(secureShuffle([1,2,3,4],webcrypto).sort(),[1,2,3,4]);
  assert.throws(()=>secureShuffle([1,2],{}),/criptográfica/);
});
test('nenhum dado privado é entregue no HTML, dados FUMP preservados e demo só em localhost',async()=>{
  const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const app=await fs.readFile(new URL('../public/assets/app.js',import.meta.url),'utf8');
  const festas=await fs.readFile(new URL('../public/assets/festas.js',import.meta.url),'utf8');
  assert.match(html,/id="admin-lock"/);assert.doesNotMatch(html,/id="admin-lock"[^>]*>Admin/);
  assert.match(html,/id="tab-menu"/);assert.match(html,/id="tab-festas"/);
  assert.match(app,/fetchMenus\(\)/);assert.match(festas,/\['localhost','127\.0\.0\.1'\]/);
  assert.match(html,/id="signup-marketing" type="checkbox"/);
  assert.match(html,/id="signup-event-terms" type="checkbox"/);
  assert.match(html,/id="signup-continue"/);
  assert.match(html,/id="admin-tab-forms"/);
});
test('regras negam operações privadas e exigem contador acoplado à inscrição',async()=>{
  const rules=await fs.readFile(new URL('../firestore.rules',import.meta.url),'utf8');
  assert.match(rules,/match \/publicMenus\/current/);assert.match(rules,/allow get: if true/);
  assert.match(rules,/match \/eventAdminAccess\/\{accessId\}/);assert.match(rules,/allow list, create, update, delete: if false/);
  assert.match(rules,/canJoinCount\(eventId\)/);assert.match(rules,/existsAfter\(entryPath/);assert.match(rules,/request.time < resource.data.drawAtTimestamp/);assert.ok(rules.includes('match /eventPosters/'));assert.ok(rules.includes('match /eventSettings/'));
  assert.match(rules,/encrypted\.ciphertext/);assert.match(rules,/allow create, update, delete: if false/);
});
