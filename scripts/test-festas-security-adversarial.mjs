// Suíte adversarial exclusiva dos emuladores locais. Nunca usar com produção.
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {initializeApp, deleteApp} from 'firebase-admin/app';
import {getFirestore, FieldValue} from 'firebase-admin/firestore';
import {initializeApp as initializeClientApp, deleteApp as deleteClientApp} from 'firebase/app';
import {getAuth, connectAuthEmulator, signInAnonymously} from 'firebase/auth';
import {getFirestore as getClientFirestore, connectFirestoreEmulator, doc, runTransaction, serverTimestamp, increment} from 'firebase/firestore';
import {encryptPrivate} from '../public/assets/festas-core.js';
import {prepareRaffle} from './raffle-engine.mjs';

const project = 'demo-bandeco';
const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!fsHost || !authHost || process.env.GCLOUD_PROJECT !== project) {
  throw new Error('BLOQUEIO: suíte adversarial só pode executar no projeto demo-bandeco com os emuladores Auth e Firestore.');
}

const base = `http://${fsHost}/v1/projects/${project}/databases/(default)/documents`;
const authUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1`;

async function authPassword(label) {
  const response = await fetch(`${authUrl}/accounts:signUp?key=fake-key`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({email: `${label}-${Date.now()}-${Math.random()}@example.test`, password: 'LocalTestsOnly123!', returnSecureToken: true})
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return {uid: body.localId, token: body.idToken};
}
async function authGoogle(label) {
  const response = await fetch(`${authUrl}/accounts:signInWithIdp?key=fake-key`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({postBody: `id_token=${encodeURIComponent(JSON.stringify({sub:`emulator-${label}`,email:`${label}@example.test`,email_verified:true,name:label}))}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true})
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return {uid: body.localId, token: body.idToken};
}

async function authAnonymous() {
  const response = await fetch(`${authUrl}/accounts:signUp?key=fake-key`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({returnSecureToken: true})
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  const claims = JSON.parse(Buffer.from(body.idToken.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.firebase?.sign_in_provider, 'anonymous', JSON.stringify({provider: claims.firebase?.sign_in_provider}));
  return {uid: body.localId, token: body.idToken};
}

async function anonymousClient() {
  const app = initializeClientApp({apiKey: 'fake-key', projectId: project}, `anon-${Date.now()}-${Math.random()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, {disableWarnings: true});
  await signInAnonymously(auth);
  const clientDb = getClientFirestore(app);
  const [host, port] = fsHost.split(':');
  connectFirestoreEmulator(clientDb, host, Number(port));
  return {app, auth, db: clientDb, uid: auth.currentUser.uid, token: await auth.currentUser.getIdToken()};
}

async function request(path, options = {}, token = null) {
  const headers = {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {}), ...(options.headers || {})};
  const target = path.startsWith(':') ? `${base}${path}` : `${base}/${path}`;
  return fetch(target, {...options, headers});
}

async function getDoc(path, token = null) { return request(path, {}, token); }

function fields({name, published = true, raffleStatus = 'open', participantCount = 0, drawAtTimestamp}) {
  return {
    name: {stringValue: name}, place: {stringValue: 'Laboratório local'}, organizer: {stringValue: 'CATM'},
    description: {stringValue: 'Teste local'}, startsAt: {stringValue: '2026-11-11T22:00'}, ticketUrl: {stringValue: ''},
    posterUrl: {stringValue: ''}, hasUploadedPoster: {booleanValue: false}, winnerCount: {integerValue: '2'}, alternateCount: {integerValue: '3'},
    raffleStatus: {stringValue: raffleStatus}, published: {booleanValue: published}, archived: {booleanValue: false}, participantCount: {integerValue: String(participantCount)},
    updatedAt: {timestampValue: new Date().toISOString()}, drawAtTimestamp: {timestampValue: drawAtTimestamp}
  };
}

function encryptedFields() {
  return {version: {integerValue: '1'}, algorithm: {stringValue: 'RSA-OAEP-SHA256+AES-256-GCM'},
    iv: {stringValue: 'iv'}, wrappedKey: {stringValue: 'wrapped-key'}, ciphertext: {stringValue: 'ciphertext'}};
}

async function joinAtomically(eventId, user) {
  try {
    await runTransaction(user.db, async transaction => {
      transaction.set(doc(user.db, `eventProfiles/${user.uid}`), {
        encrypted: {version: 1, algorithm: 'RSA-OAEP-SHA256+AES-256-GCM', iv: 'iv', wrappedKey: 'wrapped-key', ciphertext: 'ciphertext'},
        schemaVersion: 1, updatedAt: serverTimestamp()
      });
    });
    await runTransaction(user.db, async transaction => {
      transaction.set(doc(user.db, `events/${eventId}/entries/${user.uid}`), {
        createdAt: serverTimestamp(), termsAcceptedAt: serverTimestamp(),
        encryptedProfile: {version: 1, algorithm: 'RSA-OAEP-SHA256+AES-256-GCM', iv: 'iv', wrappedKey: 'wrapped-key', ciphertext: 'ciphertext'}
      });
      transaction.update(doc(user.db, `events/${eventId}`), {participantCount: increment(1)});
    });
    return {status: 200, text: async () => ''};
  } catch (error) {
    return {status: error?.code === 'permission-denied' ? 403 : 500, text: async () => String(error)};
  }
}

const adminApp = initializeApp({projectId: project}, 'festas-adversarial');
const db = getFirestore(adminApp);
const users = [];
const clients = [];
const eventId = 'festas-adversarial-100';
const closedEventId = 'festas-adversarial-closed';
try {
  const admin = await authGoogle('admin-adversarial');
  const ordinary = await authPassword('ordinary-adversarial');
  const first = await anonymousClient();
  clients.push(first);
  users.push(first);
  const future = new Date(Date.now() + 86_400_000).toISOString();
  await db.doc(`eventAdminAccess/owner`).set({uid: admin.uid, enabled: true});
  await db.doc(`events/${eventId}`).set({
    name: 'Sorteio adversarial', place: 'Laboratório local', organizer: 'CATM', description: 'Teste', startsAt: '2026-11-11T22:00',
    ticketUrl: '', posterUrl: '', hasUploadedPoster: false, winnerCount: 2, alternateCount: 3, raffleStatus: 'open', published: true, archived: false,
    participantCount: 0, updatedAt: new Date(), drawAtTimestamp: new Date(future)
  });
  await db.doc(`events/${closedEventId}`).set({
    name: 'Sorteio encerrado', place: 'Laboratório local', organizer: 'CATM', description: 'Teste', startsAt: '2026-11-11T22:00',
    ticketUrl: '', posterUrl: '', hasUploadedPoster: false, winnerCount: 2, alternateCount: 3, raffleStatus: 'closed', published: true, archived: false,
    participantCount: 0, updatedAt: new Date(), drawAtTimestamp: new Date(future)
  });

  // Admin path cannot be read by anonymous users, ordinary users, or an anonymous UID.
  assert.equal((await getDoc('eventAdminAccess/owner')).status, 403);
  assert.equal((await getDoc('eventAdminAccess/owner', ordinary.token)).status, 403);
  assert.equal((await getDoc('eventAdminAccess/owner', first.token)).status, 403);
  assert.equal((await getDoc('eventSettings/raffleDefaults', admin.token)).status, 404);
  assert.equal((await getDoc('eventSettings/raffleDefaults', ordinary.token)).status, 403);

  // A direct counter change, duplicate join, closed event, and non-admin event write are rejected.
  const directCounter = await request(`events/${eventId}`, {method: 'PATCH', body: JSON.stringify({fields: fields({name: 'Sorteio adversarial', participantCount: 1, drawAtTimestamp: future})})}, first.token);
  assert.equal(directCounter.status, 403);
  const adminEdit=fields({name: 'Sorteio adversarial', participantCount: 0, drawAtTimestamp: future});
  adminEdit.description={stringValue:'Descrição administrativa'};
  assert.equal((await request(`events/${eventId}`, {method: 'PATCH', body: JSON.stringify({fields: adminEdit})}, admin.token)).status, 200);
  assert.equal((await request(`events/${eventId}`, {method: 'PATCH', body: JSON.stringify({fields: {participantCount: {integerValue: '99'}}})}, admin.token)).status, 403);
  assert.equal((await request(`events/${eventId}`, {method: 'PATCH', body: JSON.stringify({fields: {winnerCount: {integerValue: '9'}}})}, admin.token)).status, 403);
  assert.equal((await request(`events/${eventId}/results/official`, {method: 'PATCH', body: JSON.stringify({fields: {status: {stringValue: 'published'}}})}, admin.token)).status, 403);
  const firstJoin = await joinAtomically(eventId, first);
  assert.equal(firstJoin.status, 200, await firstJoin.text());
  const duplicateJoin = await joinAtomically(eventId, first);
  assert.equal(duplicateJoin.status, 403);
  const closed = await anonymousClient(); clients.push(closed);
  assert.equal((await joinAtomically(closedEventId, closed)).status, 403);
  assert.equal((await request(`events/${eventId}`, {method: 'PATCH', body: JSON.stringify({fields: fields({name: 'hijacked', drawAtTimestamp: future})})}, ordinary.token)).status, 403);
  assert.equal((await request('eventAdminAccess/owner', {method: 'PATCH', body: JSON.stringify({fields: {uid: {stringValue: ordinary.uid}, enabled: {booleanValue: true}}})}, ordinary.token)).status, 403);

  // One hundred anonymous participants are accepted concurrently; capacity is not a registration limit.
  const remaining = await Promise.all(Array.from({length: 99}, () => anonymousClient()));
  clients.push(...remaining); users.push(...remaining);
  const joins = await Promise.all(users.map(user => joinAtomically(eventId, user)));
  assert.equal(joins.filter(response => response.status === 200).length, 99);
  assert.equal((await db.doc(`events/${eventId}`).get()).data().participantCount, 100);
  assert.equal((await db.collection(`events/${eventId}/entries`).get()).size, 100);
  assert.equal((await getDoc(`events/${eventId}/entries/${first.uid}`, ordinary.token)).status, 403);
  assert.equal((await getDoc(`events/${eventId}/entries/${first.uid}`, admin.token)).status, 200);

  // Full emulator apuração: real encrypted snapshots, 2 winners, 3 alternates, and idempotent atomic publication.
  const keyPair=await webcrypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const publicJwk=await webcrypto.subtle.exportKey('jwk',keyPair.publicKey);
  const privateJwk=await webcrypto.subtle.exportKey('jwk',keyPair.privateKey);
  const entryDocs=(await db.collection(`events/${eventId}/entries`).get()).docs;
  const encryptedSnapshots=await Promise.all(entryDocs.map(async (entryDoc,index)=>({
    ref:entryDoc.ref,
    encryptedProfile:await encryptPrivate({instagram:`participant${index}`,name:`Pessoa Teste ${index}`,email:`p${index}@example.test`},publicJwk,webcrypto.subtle,webcrypto)
  })));
  const snapshotBatch=db.batch();
  for(const row of encryptedSnapshots)snapshotBatch.update(row.ref,{encryptedProfile:row.encryptedProfile});
  await snapshotBatch.commit();
  await db.doc(`events/${eventId}`).update({drawAtTimestamp:new Date(Date.now()-1000),raffleStatus:'open'});
  const raffleEvent=(await db.doc(`events/${eventId}`).get()).data();
  const raffleEntries=(await db.collection(`events/${eventId}/entries`).get()).docs.map(d=>({uid:d.id,createdAt:d.data().createdAt.toDate().toISOString(),encryptedProfile:d.data().encryptedProfile}));
  const {publicResult,privateResult}=await prepareRaffle({event:raffleEvent,entries:raffleEntries,profiles:[],privateKey:privateJwk});
  assert.equal(publicResult.winners.length,2);assert.equal(publicResult.alternates.length,3);
  assert.equal(new Set([...privateResult.winnerUids,...privateResult.alternateUids]).size,5);
  assert.equal(JSON.stringify(publicResult).includes('uid'),false);
  const eventRef=db.doc(`events/${eventId}`),publicRef=db.doc(`events/${eventId}/results/official`),privateRef=db.doc(`events/${eventId}/resultPrivate/official`);
  const publish=()=>db.runTransaction(async tx=>{
    const [latest,old]=await Promise.all([tx.get(eventRef),tx.get(publicRef)]);
    if(old.exists||latest.data()?.raffleStatus!=='open')return false;
    tx.create(publicRef,{...publicResult,publishedAt:FieldValue.serverTimestamp()});
    tx.create(privateRef,{...privateResult,createdAt:FieldValue.serverTimestamp()});
    tx.update(eventRef,{raffleStatus:'drawn',updatedAt:FieldValue.serverTimestamp()});
    return true;
  }).catch(()=>false);
  const publishOutcomes=await Promise.all([publish(),publish()]);
  assert.equal(publishOutcomes.filter(Boolean).length,1);
  assert.equal((await getDoc(`events/${eventId}/results/official`)).status,200);
  assert.equal((await getDoc(`events/${eventId}/resultPrivate/official`,ordinary.token)).status,403);
  assert.equal((await getDoc(`events/${eventId}/resultPrivate/official`,admin.token)).status,200);
  assert.equal(await publish(),false);

  // Owner-only PII, strict schema, and formula-safe private data remain protected.
  assert.equal((await request(`eventProfiles/${first.uid}`, {method: 'PATCH', body: JSON.stringify({fields: {encrypted: {mapValue: {fields: encryptedFields()}}, schemaVersion: {integerValue: '1'}, extraData: {stringValue: 'pollution'}, updatedAt: {timestampValue: new Date().toISOString()}}})}, first.token)).status, 403);
  assert.equal((await getDoc(`eventProfiles/${first.uid}`, ordinary.token)).status, 403);
  assert.equal((await getDoc(`eventProfiles/${first.uid}`, first.token)).status, 200);
  assert.equal((await request(`eventProfiles/${first.uid}`, {method: 'DELETE'}, first.token)).status, 200);

  console.log('SEGURANÇA ADVERSARIAL: admin/anonimato, takeover, leitura privada, schema pollution, contador transacional, duplicata, encerramento e 100 inscrições concorrentes aprovados; somente emulador.');
} finally {
  await db.recursiveDelete(db.collection('events').doc(eventId)).catch(() => {});
  await db.recursiveDelete(db.collection('events').doc(closedEventId)).catch(() => {});
  await Promise.all(clients.map(client => db.doc(`eventProfiles/${client.uid}`).delete().catch(() => {})));
  await db.doc('eventAdminAccess/owner').delete().catch(() => {});
  await Promise.all(clients.map(client => deleteClientApp(client.app).catch(() => {})));
  await deleteApp(adminApp);
}
