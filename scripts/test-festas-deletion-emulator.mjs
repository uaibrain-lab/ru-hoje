// Teste de exclusão administrativa somente no Firebase Emulator.
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {deleteParticipantRecords,deleteAllParticipantRecords,verifyEmulatorAdmin} from './delete-festas-emulator.mjs';

const project='demo-bandeco',fsHost=process.env.FIRESTORE_EMULATOR_HOST,authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(process.env.GCLOUD_PROJECT!==project||!fsHost||!authHost)throw Error('BLOQUEIO: teste somente no Emulator demo-bandeco.');
async function auth(label){
  const res=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${label}-${Date.now()}@example.test`,password:'LocalTestsOnly123!',returnSecureToken:true})});
  const body=await res.json();assert.equal(res.ok,true,JSON.stringify(body));return {uid:body.localId,token:body.idToken};
}
const app=initializeApp({projectId:project},'festas-deletion-test'),db=getFirestore(app);let openRef,drawnRef;
try{
  const admin=await auth('deletion-admin'),participant=await auth('deletion-participant'),other=await auth('deletion-other');
  await db.doc('eventAdminAccess/owner').set({uid:admin.uid,enabled:true});
  await db.doc(`eventProfiles/${participant.uid}`).set({encrypted:{version:1,algorithm:'RSA-OAEP-SHA256+AES-256-GCM',iv:'iv',wrappedKey:'wrapped',ciphertext:'cipher'},schemaVersion:1});
  await db.doc(`eventProfiles/${other.uid}`).set({encrypted:{version:1,algorithm:'RSA-OAEP-SHA256+AES-256-GCM',iv:'iv',wrappedKey:'wrapped',ciphertext:'cipher'},schemaVersion:1});
  openRef=db.doc('events/deletion-open');drawnRef=db.doc('events/deletion-drawn');
  await openRef.set({name:'Open',raffleStatus:'open',published:true,archived:false,participantCount:1});
  await drawnRef.set({name:'Drawn',raffleStatus:'drawn',published:true,archived:false,participantCount:1});
  await openRef.collection('entries').doc(participant.uid).set({encryptedProfile:{ciphertext:'cipher'}});
  await drawnRef.collection('entries').doc(participant.uid).set({encryptedProfile:{ciphertext:'cipher'}});
  await drawnRef.collection('results').doc('official').set({status:'published',winners:[],alternates:[]});
  await drawnRef.collection('resultPrivate').doc('official').set({winnerUids:[participant.uid]});
  await verifyEmulatorAdmin(db,{uid:admin.uid,idToken:admin.token,authHost});
  const preview=await deleteParticipantRecords(db,participant.uid,{preview:true});
  assert.deepEqual({found:preview.found,removed:preview.removed,blocked:preview.blocked},{found:2,removed:1,blocked:1});
  const first=await deleteParticipantRecords(db,participant.uid);
  assert.deepEqual({removed:first.removed,blocked:first.blocked},{removed:1,blocked:1});
  assert.equal((await openRef.collection('entries').doc(participant.uid).get()).exists,false);
  assert.equal((await drawnRef.collection('entries').doc(participant.uid).get()).exists,true);
  assert.equal((await openRef.get()).data().participantCount,0);
  assert.equal((await db.doc(`eventProfiles/${participant.uid}`).get()).exists,true);
  const retry=await deleteParticipantRecords(db,participant.uid);assert.equal(retry.removed,0);assert.equal(retry.blocked,1);
  const allPreview=await deleteAllParticipantRecords(db,{preview:true});assert.equal(allPreview.total,2);assert.equal(allPreview.blocked,1);
  const all=await deleteAllParticipantRecords(db);assert.equal(all.total,2);assert.equal(all.blocked,1);
  assert.equal((await db.doc(`eventProfiles/${other.uid}`).get()).exists,false);
  console.log('EXCLUSÃO EMULADOR: prévia, autorização, idempotência, contador, retomada e bloqueio pós-publicação aprovados; sem produção.');
}finally{
  await db.recursiveDelete(db.collection('events').doc('deletion-open')).catch(()=>{});
  await db.recursiveDelete(db.collection('events').doc('deletion-drawn')).catch(()=>{});
  await db.recursiveDelete(db.collection('eventProfiles')).catch(()=>{});
  await db.doc('eventAdminAccess/owner').delete().catch(()=>{});
  await deleteApp(app);
}
