// Execute SOMENTE com Firebase Emulators ativos: nunca toca em produção.
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
const id='demo-bandeco';
const fsHost=process.env.FIRESTORE_EMULATOR_HOST, authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!fsHost||!authHost||process.env.GCLOUD_PROJECT!==id){
  throw new Error('BLOQUEIO DE SEGURANÇA: executar só no emulador com GCLOUD_PROJECT=demo-bandeco, FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST.');
}
const base=`http://${fsHost}/v1/projects/${id}/databases/(default)/documents`;
async function auth(email){
  const res=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalTestsOnly123!',returnSecureToken:true})
  });
  const body=await res.json();if(!res.ok)throw new Error(`Auth Emulator: ${JSON.stringify(body)}`);return {uid:body.localId,token:body.idToken};
}
async function authGoogle(label){
  const idToken=encodeURIComponent(JSON.stringify({sub:`emulator-${label}`,email:`${label}@example.test`,email_verified:true,name:label}));
  const res=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postBody:`id_token=${idToken}&providerId=google.com`,requestUri:'http://localhost',returnSecureToken:true})});
  const body=await res.json();if(!res.ok)throw new Error(`Auth Emulator Google: ${JSON.stringify(body)}`);return {uid:body.localId,token:body.idToken};
}
async function getDoc(route,token=null){
  return fetch(`${base}/${route}`,{headers:token?{Authorization:`Bearer ${token}`}:{}});
}
async function postDoc(route,value,token=null){
  return fetch(`${base}/${route}`,{method:'PATCH',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(value)});
}
const adminApp=initializeApp({projectId:id},'festas-emulator-tests');const db=getFirestore(adminApp);
let createdAdminUid=null,createdParticipantUid=null;
try{
  const admin=await authGoogle(`admin-${Date.now()}`), participant=await auth(`participante-${Date.now()}@example.test`);
  createdAdminUid=admin.uid;createdParticipantUid=participant.uid;
  const event='festas-security-test';
  const idEvent={name:'Festa de teste',place:'Local',organizer:'CATM',description:'',startsAt:'2026-11-11T22:00',ticketUrl:'',posterUrl:'',termsUrl:'',winnerCount:0,alternateCount:0,raffleStatus:'disabled',published:true,archived:false,authorizationReference:'',partnerLabel:'Parceria publicitária',legallyReviewed:false,participantCount:0,updatedAt:new Date()};
  const profile={encrypted:{version:1,algorithm:'RSA-OAEP-SHA256+AES-256-GCM',iv:'dummy',wrappedKey:'dummy',ciphertext:'dummy'},updatedAt:new Date(),schemaVersion:1};
  await db.doc(`eventAdminAccess/owner`).set({enabled:true,uid:admin.uid});
  await db.doc(`events/${event}`).set({...idEvent,hasUploadedPoster:true});
  await db.doc(`eventPosters/${event}`).set({imageDataUrl:'data:image/webp;base64,AAAA',updatedAt:new Date()});
  await db.doc('eventSettings/raffleDefaults').set({rulesText:'Teste privado',updatedAt:new Date()});
  await db.doc(`eventProfiles/${participant.uid}`).set(profile);
  await db.doc(`events/${event}/entries/${participant.uid}`).set({createdAt:new Date(),termsAcceptedAt:new Date()});
  // Leitura de festa publicada por visitante; leitura privada por visitante proibida.
  assert.equal((await getDoc(`events/${event}`)).status,200);
  // As Rules RC1 exigem explicitamente archived:false para leitura pública.
  // Fixtures legados/inválidos não devem ser tornados públicos afrouxando as Rules.
  const legacyEvent='festas-security-legacy';
  const archivedEvent='festas-security-archived';
  const {archived: _omitArchived, ...legacyFixture} = idEvent;
  await db.doc(`events/${legacyEvent}`).set(legacyFixture);
  await db.doc(`events/${archivedEvent}`).set({...idEvent,archived:true});
  assert.equal((await getDoc(`events/${legacyEvent}`)).status,403);
  assert.equal((await getDoc(`events/${archivedEvent}`)).status,403);
  assert.equal((await getDoc(`events/${legacyEvent}`,admin.token)).status,200);
  assert.equal((await getDoc(`eventPosters/${event}`)).status,200);
  assert.equal((await getDoc('eventSettings/raffleDefaults')).status,403);
  assert.equal((await getDoc('eventSettings/raffleDefaults',participant.token)).status,403);
  assert.equal((await getDoc('eventSettings/raffleDefaults',admin.token)).status,200);
  assert.equal((await getDoc(`eventProfiles/${participant.uid}`)).status,403);
  assert.equal((await getDoc(`events/${event}/entries/${participant.uid}`)).status,403);
  // Um usuário autenticado não lê terceiros e não se torna administrador.
  assert.equal((await getDoc(`eventProfiles/${participant.uid}`,participant.token)).status,200);
  assert.equal((await getDoc(`events/${event}/entries/${participant.uid}`,participant.token)).status,200);
  assert.equal((await getDoc(`eventAdminAccess/owner`,participant.token)).status,403);
  assert.equal((await getDoc(`eventProfiles/${participant.uid}`,admin.token)).status,200);
  // Visitante e usuário comum não criam documentos administrativos.
  for(const token of [null,participant.token]){
    const result=await postDoc('events/evento-injetado',{fields:{name:{stringValue:'Injetado'}}},token);
    assert.equal(result.status,403,`Inscrição anônima não deve criar evento (${result.status})`);
  }
  // Impede injeção ou alteração não autorizada de imagens e regras padrão.
  for(const token of [null,participant.token]){
    assert.equal((await postDoc(`eventPosters/${event}`,{fields:{imageDataUrl:{stringValue:'data:image/webp;base64,AAAA'}}},token)).status,403);
    assert.equal((await postDoc('eventSettings/tagCatalog',{fields:{tags:{arrayValue:{values:[{stringValue:'Open Bar'}]}}}},token)).status,403);
  }
  // Ataque direto aos documentos administrativos.
  const takeover=await postDoc(`eventAdminAccess/owner`,{fields:{enabled:{booleanValue:true}}},participant.token);
  assert.equal(takeover.status,403);
  // O SDK cliente nunca pode apagar eventos, mesmo sem resultado; evita órfãos.
  const deleteWithEntry=await fetch(`${base}/events/${event}`,{method:'DELETE',headers:{Authorization:`Bearer ${admin.token}`}});
  assert.equal(deleteWithEntry.status,403,'Administrador não pode apagar evento com inscrição.');
  const deleteEntry=await fetch(`${base}/events/${event}/entries/${participant.uid}`,{method:'DELETE',headers:{Authorization:`Bearer ${admin.token}`}});
  assert.equal(deleteEntry.status,403,'Nenhuma entrada pode ser apagada pelo SDK cliente.');
  const protectedEvent='festas-security-drawn';
  await db.doc(`events/${protectedEvent}`).set({...idEvent,name:'Resultado protegido',raffleStatus:'drawn',participantCount:1});
  await db.doc(`events/${protectedEvent}/results/official`).set({status:'published',winners:[],alternates:[]});
  const blockedDelete=await fetch(`${base}/events/${protectedEvent}`,{method:'DELETE',headers:{Authorization:`Bearer ${admin.token}`}});
  assert.equal(blockedDelete.status,403,'Resultado oficial nunca pode ser excluído pelo navegador.');
  // Festa concluída: o proprietário pode mudar SOMENTE a publicação; resultado e inscrições permanecem intactos.
  const cleanDrawn='festas-security-visibility-drawn',cleanNormal='festas-security-visibility-normal';
  const {termsUrl,authorizationReference,legallyReviewed,...safeFixture}=idEvent;
  await db.doc(`events/${cleanDrawn}`).set({...safeFixture,raffleStatus:'drawn',participantCount:1,drawAtTimestamp:new Date('2026-01-01T12:00:00Z')});
  await db.doc(`events/${cleanDrawn}/results/official`).set({status:'published',winners:[],alternates:[]});
  await db.doc(`events/${cleanNormal}`).set({...safeFixture});
  const patchVisibility=(docId,value,token)=>fetch(`${base}/events/${docId}?updateMask.fieldPaths=published&updateMask.fieldPaths=updatedAt`,{
    method:'PATCH',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:JSON.stringify({fields:{published:{booleanValue:value},updatedAt:{timestampValue:new Date().toISOString()}}})
  });
  assert.equal((await patchVisibility(cleanNormal,false,admin.token)).status,200,'Administrador oculta festa comum');
  assert.equal((await getDoc(`events/${cleanNormal}`)).status,403,'Oculta não é pública');
  assert.equal((await patchVisibility(cleanNormal,true,admin.token)).status,200,'Administrador republica festa comum');
  assert.equal((await patchVisibility(cleanDrawn,false,admin.token)).status,200,'Administrador oculta resultado sem apagá-lo');
  assert.equal((await getDoc(`events/${cleanDrawn}`)).status,403,'Festa concluída oculta não é pública');
  assert.equal((await db.doc(`events/${cleanDrawn}/results/official`).get()).exists,true,'Resultado preservado');
  assert.equal((await patchVisibility(cleanDrawn,true,admin.token)).status,200,'Administrador republica festa concluída');
  assert.equal((await patchVisibility(cleanDrawn,false,participant.token)).status,403,'Participante não pode alterar publicação');
  assert.equal((await patchVisibility(cleanDrawn,false,null)).status,403,'Visitante não pode alterar publicação');
  console.log('VISIBILIDADE ADMIN EMULADOR: ocultar/republicar festa comum e concluída, preservação de resultados e rejeição de não administradores.');
  console.log('SEGURANÇA EMULADOR: leitura de festas/imagens publicadas, isolamento de formulários, regras privadas e bloqueio de gravação não autorizada aprovados; sem produção.');
}finally{await db.doc('events/festas-security-legacy').delete().catch(()=>{});await db.doc('events/festas-security-archived').delete().catch(()=>{});await db.recursiveDelete(db.collection('events').doc('festas-security-test')).catch(()=>{});await db.recursiveDelete(db.collection('events').doc('festas-security-drawn')).catch(()=>{});await db.recursiveDelete(db.collection('events').doc('festas-security-visibility-drawn')).catch(()=>{});await db.recursiveDelete(db.collection('events').doc('festas-security-visibility-normal')).catch(()=>{});await db.doc(`eventProfiles/${createdParticipantUid||'missing'}`).delete().catch(()=>{});await db.doc(`eventAdminAccess/owner`).delete().catch(()=>{});await db.doc(`eventPosters/festas-security-test`).delete().catch(()=>{});await db.doc('eventSettings/raffleDefaults').delete().catch(()=>{});await deleteApp(adminApp);}
