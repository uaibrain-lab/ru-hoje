// Suíte v2.5.3 somente para Firebase Emulator. Nunca usa o projeto real.
import assert from 'node:assert/strict';
import {initializeApp, deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import fs from 'node:fs/promises';

const project='demo-bandeco';
const fsHost=process.env.FIRESTORE_EMULATOR_HOST;
const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!fsHost||!authHost||process.env.GCLOUD_PROJECT!==project)
  throw new Error('BLOQUEIO: teste v2.5.3 exige exclusivamente os emuladores do projeto demo-bandeco.');
const base=`http://${fsHost}/v1/projects/${project}/databases/(default)/documents`;
const authBase=`http://${authHost}/identitytoolkit.googleapis.com/v1`;
async function signUp(label,anonymous=false){
  const body=anonymous?{returnSecureToken:true}:{email:`${label}-${Date.now()}@example.test`,password:'LocalAdminTests123!',returnSecureToken:true};
  const response=await fetch(`${authBase}/accounts:signUp?key=fake-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();assert.equal(response.ok,true,JSON.stringify(data));
  return {uid:data.localId,token:data.idToken};
}
async function signUpGoogle(label){
  const idToken=encodeURIComponent(JSON.stringify({sub:`emulator-${label}`,email:`${label}@example.test`,email_verified:true,name:label}));
  const response=await fetch(`${authBase}/accounts:signInWithIdp?key=fake-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({postBody:`id_token=${idToken}&providerId=google.com`,requestUri:'http://localhost',returnSecureToken:true})});
  const data=await response.json();assert.equal(response.ok,true,JSON.stringify(data));
  return {uid:data.localId,token:data.idToken};
}
async function request(path,token,options={}){
  return fetch(`${base}/${path}`,{...options,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}});
}
async function patchDoc(path,fields,token){return request(path,token,{method:'PATCH',body:JSON.stringify({fields})});}
const adminApp=initializeApp({projectId:project},`v253-admin-${Date.now()}`);
const db=getFirestore(adminApp);
let ownerUid, eventId='v253-admin-event';
try{
  const authorized=await signUpGoogle('authorized-google-simulation');
  const unauthorized=await signUpGoogle('unauthorized-google-simulation');
  const anonymous=await signUp('anonymous',true);
  ownerUid=authorized.uid;
  await db.doc('eventAdminAccess/owner').set({uid:ownerUid,enabled:true});
  await db.doc(`events/${eventId}`).set({name:'Festa local v2.5.3',place:'Emulador',organizer:'CATM',description:'',startsAt:'2099-11-11T22:00',ticketUrl:'',posterUrl:'',hasUploadedPoster:false,winnerCount:0,alternateCount:0,raffleStatus:'disabled',published:true,archived:false,participantCount:0,updatedAt:new Date()});
  await db.doc(`events/${eventId}/entries/${unauthorized.uid}`).set({createdAt:new Date(),termsAcceptedAt:new Date(),encryptedProfile:{version:1,algorithm:'RSA-OAEP-SHA256+AES-256-GCM',iv:'iv',wrappedKey:'wrapped',ciphertext:'cipher'}});

  // A: UID autorizado, autenticado não-anônimo, lê a autorização e evento.
  assert.equal((await request('eventAdminAccess/owner',authorized.token)).status,200);
  assert.equal((await request(`events/${eventId}`,authorized.token)).status,200);
  // B/C/D: conta diferente, anônima e sem autenticação são rejeitadas.
  assert.equal((await request('eventAdminAccess/owner',unauthorized.token)).status,403);
  assert.equal((await request('eventAdminAccess/owner',anonymous.token)).status,403);
  assert.equal((await request('eventAdminAccess/owner',null)).status,403);
  // E: ninguém altera ou apaga o documento de autorização.
  const forged={uid:{stringValue:unauthorized.uid},enabled:{booleanValue:true}};
  assert.equal((await patchDoc('eventAdminAccess/owner',forged,authorized.token)).status,403);
  assert.equal((await patchDoc('eventAdminAccess/owner',forged,unauthorized.token)).status,403);
  assert.equal((await request('eventAdminAccess/owner',authorized.token,{method:'DELETE'})).status,403);
  // F/G/H: formulários, criação comum e resultados falsos permanecem bloqueados.
  assert.equal((await request(`events/${eventId}/entries/${unauthorized.uid}`,anonymous.token)).status,403);
  assert.equal((await patchDoc('events/evento-injetado',{name:{stringValue:'Injetado'}},unauthorized.token)).status,403);
  assert.equal((await patchDoc(`events/${eventId}/results/official`,{status:{stringValue:'published'}},authorized.token)).status,403);
  // I/J: ausência de token e usuário revogado/sem autorização não abrem rotas privadas.
  assert.equal((await request(`eventSettings/raffleDefaults`,null)).status,403);
  assert.equal((await request(`eventSettings/raffleDefaults`,unauthorized.token)).status,403);
  const source=await fs.readFile(new URL('../public/assets/festas.js',import.meta.url),'utf8');
  const backend=await fs.readFile(new URL('../public/assets/festas-backend.js',import.meta.url),'utf8');
  assert.match(source,/providerId==='google\.com'/);
  assert.match(source,/eventAdminAccess','owner'/);
  assert.match(source,/clearAdminSession/);
  assert.match(backend,/bandeco-participant/);
  assert.match(backend,/bandeco-admin/);
  console.log('ADMIN V2.5.3 EMULADOR aprovado: UID autorizado, identidades não autorizadas, anônimo, não autenticado, adulteração, formulários, criação comum, resultados falsos e rotas privadas bloqueados; sessões separadas verificadas no código.');
}finally{
  await db.doc(`events/${eventId}`).delete().catch(()=>{});
  await db.doc('eventAdminAccess/owner').delete().catch(()=>{});
  await deleteApp(adminApp);
}
