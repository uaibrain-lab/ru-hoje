// Exclusão administrativa somente para o Firebase Emulator demo-bandeco.
// Não é um comando de produção e recusa qualquer projeto/host diferente.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {initializeApp, deleteApp} from 'firebase-admin/app';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';

export const EMULATOR_PROJECT='demo-bandeco';

function guard(){
  const fsHost=process.env.FIRESTORE_EMULATOR_HOST;
  const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if(process.env.GCLOUD_PROJECT!==EMULATOR_PROJECT||!fsHost||!authHost)
    throw Error('BLOQUEIO: exclusão somente com GCLOUD_PROJECT=demo-bandeco e Auth/Firestore Emulator.');
  return {fsHost,authHost};
}

export async function verifyEmulatorAdmin(db,{uid,idToken,authHost}){
  assert.match(uid,/^[A-Za-z0-9_-]{1,128}$/,'UID administrativo inválido.');
  assert.ok(idToken,'ID token do Emulator obrigatório.');
  const lookup=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=fake-key`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken})
  });
  const body=await lookup.json();
  assert.equal(lookup.ok,true,'Token não validado pelo Auth Emulator.');
  assert.equal(body.users?.[0]?.localId,uid,'Token não corresponde ao UID informado.');
  const owner=await db.doc('eventAdminAccess/owner').get();
  assert.equal(owner.exists,true,'Administrador não provisionado no Emulator.');
  assert.equal(owner.data().enabled,true,'Administrador desabilitado.');
  assert.equal(owner.data().uid,uid,'UID não é o administrador provisionado.');
  return true;
}

async function eventRecordsForUid(db,uid){
  const events=await db.collection('events').get();
  const records=[];
  for(const eventDoc of events.docs){
    const entry=await eventDoc.ref.collection('entries').doc(uid).get();
    if(!entry.exists)continue;
    const [official,privateResult]=await Promise.all([
      eventDoc.ref.collection('results').doc('official').get(),
      eventDoc.ref.collection('resultPrivate').doc('official').get()
    ]);
    records.push({eventDoc,entry,official,privateResult});
  }
  return records;
}

export async function deleteParticipantRecords(db,uid,{preview=false}={}){
  const records=await eventRecordsForUid(db,uid);
  const blocked=records.filter(({eventDoc,official,privateResult})=>
    eventDoc.data().raffleStatus==='drawn'||official.exists||privateResult.exists
  ).map(({eventDoc})=>eventDoc.id);
  const removable=records.filter(({eventDoc,official,privateResult})=>
    eventDoc.data().raffleStatus!=='drawn'&&!official.exists&&!privateResult.exists
  );
  if(!preview){
    for(const {eventDoc,entry} of removable){
      await db.runTransaction(async tx=>{
        const [latestEvent,latestEntry]=await Promise.all([tx.get(eventDoc.ref),tx.get(entry.ref)]);
        if(!latestEntry.exists)return;
        const count=Number(latestEvent.data()?.participantCount)||0;
        tx.delete(latestEntry.ref);
        tx.update(latestEvent.ref,{participantCount:Math.max(0,count-1),updatedAt:FieldValue.serverTimestamp()});
      });
    }
    const remaining=await eventRecordsForUid(db,uid);
    if(!remaining.length)await db.doc(`eventProfiles/${uid}`).delete().catch(()=>{});
  }
  return {uid,found:records.length,removed:preview?removable.length:records.length-blocked.length,blocked:blocked.length,blockedEventIds:blocked,preview};
}

export async function deleteAllParticipantRecords(db,{preview=false}={}){
  const [profiles,events]=await Promise.all([db.collection('eventProfiles').get(),db.collection('events').get()]);
  const uids=new Set(profiles.docs.map(d=>d.id));
  for(const eventDoc of events.docs){for(const entry of (await eventDoc.ref.collection('entries').get()).docs)uids.add(entry.id);}
  const results=[];
  for(const uid of uids)results.push(await deleteParticipantRecords(db,uid,{preview}));
  return {total:results.length,removed:results.reduce((n,r)=>n+r.removed,0),blocked:results.reduce((n,r)=>n+r.blocked,0),results,preview};
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
  const {authHost}=guard();
  const all=process.argv.includes('--all');
  const preview=process.argv.includes('--preview');
  const confirmed=process.argv.includes('--confirm');
  const uidArg=process.argv.find((arg,index)=>arg==='--uid'&&process.argv[index+1])?process.argv[process.argv.indexOf('--uid')+1]:'';
  if((all&&uidArg)||(!all&&!uidArg))throw Error('Use exatamente --uid UID ou --all.');
  if(!preview&&!confirmed)throw Error('Exclusão exige --confirm; use --preview para apenas contar.');
  const adminUid=process.env.FESTAS_ADMIN_UID, idToken=process.env.FESTAS_ADMIN_ID_TOKEN;
  if(!adminUid||!idToken)throw Error('FESTAS_ADMIN_UID e FESTAS_ADMIN_ID_TOKEN são obrigatórios.');
  const app=initializeApp({projectId:EMULATOR_PROJECT},'festas-emulator-deletion');
  const db=getFirestore(app);
  try{
    await verifyEmulatorAdmin(db,{uid:adminUid,idToken,authHost});
    const result=all?await deleteAllParticipantRecords(db,{preview}):await deleteParticipantRecords(db,uidArg,{preview});
    console.log(JSON.stringify({preview:result.preview,total:result.total??1,removed:result.removed,blocked:result.blocked}));
  }finally{await deleteApp(app);}
}
