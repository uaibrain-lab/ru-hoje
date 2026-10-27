// Executor privado de produção. Desativado até existir evento elegível e autorização operacional.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {prepareRaffle,due} from './raffle-engine.mjs';

const TARGET_PROJECT='hubufmg';
const TARGET_SERVICE_ACCOUNT='hub-prod-raffles@hubufmg.iam.gserviceaccount.com';
const commit=process.argv.includes('--commit');
if(!commit){console.log('SIMULAÇÃO produção: nenhuma gravação.');process.exit(0);}
if(process.env.HUB_PROD_RAFFLES_ENABLED!=='true')throw Error('GATE: apuração de produção não habilitada.');
if(process.env.HUB_PROD_PROJECT_ID!==TARGET_PROJECT)throw Error('Projeto de produção ausente ou diferente do allowlist.');
const privateKey=JSON.parse(process.env.HUB_PROD_PRIVATE_KEY_JWK||'null');
if(!privateKey?.d)throw Error('Chave privada de produção ausente ou inválida.');
const credentialPath=process.env.GOOGLE_APPLICATION_CREDENTIALS;
if(!credentialPath)throw Error('ADC federado ausente.');
let credentialConfig;
try{credentialConfig=JSON.parse(fs.readFileSync(credentialPath,'utf8'));}catch{throw Error('ADC federado ausente ou ilegível.');}
if(credentialConfig?.type!=='external_account')throw Error('Credencial rejeitada: somente ADC external_account/WIF.');
const expectedProvider=process.env.HUB_PROD_WIF_PROVIDER;
const expectedServiceAccount=process.env.HUB_PROD_SERVICE_ACCOUNT;
if(!expectedProvider?.startsWith('projects/858219271468/locations/global/workloadIdentityPools/hub-prod-actions/providers/hub-prod-raffles'))throw Error('Provider WIF de produção ausente ou fora do allowlist.');
if(expectedServiceAccount!==TARGET_SERVICE_ACCOUNT)throw Error('Conta de serviço de produção ausente ou diferente do allowlist.');
if(credentialConfig.audience!==`//iam.googleapis.com/${expectedProvider}`)throw Error('ADC rejeitado: audience WIF diferente do provider permitido.');
const impersonation=decodeURIComponent(String(credentialConfig.service_account_impersonation_url||''));
if(!impersonation.includes(`/serviceAccounts/${TARGET_SERVICE_ACCOUNT}:generateAccessToken`))throw Error('ADC rejeitado: impersonação fora da conta permitida.');
const {Firestore,FieldValue}=await import('@google-cloud/firestore');
const db=new Firestore({projectId:TARGET_PROJECT});
const safeId=id=>createHash('sha256').update(String(id)).digest('hex').slice(0,10);
let failures=0;
try{
  const snap=await db.collection('events').where('raffleStatus','==','open').get();
  for(const doc of snap.docs){
    const data=doc.data();if(!due(data))continue;
    try{
      const eventRef=doc.ref,resultRef=doc.ref.collection('results').doc('official'),privateRef=doc.ref.collection('resultPrivate').doc('official');
      const entries=(await doc.ref.collection('entries').get()).docs.map(d=>({uid:d.id,createdAt:d.data().createdAt?.toDate?.()?.toISOString?.()||'',encryptedProfile:d.data().encryptedProfile}));
      if(data.participantCount!==entries.length)throw Error('Contagem de inscrições divergente; revisão manual necessária.');
      const {publicResult,privateResult}=await prepareRaffle({event:data,entries,profiles:[],privateKey});
      const snapshotHash=createHash('sha256').update(entries.map(e=>`${e.uid}:${e.createdAt}:${JSON.stringify(e.encryptedProfile||{})}`).sort().join('\n')).digest('hex');
      publicResult.entriesSnapshotSha256=snapshotHash;privateResult.entriesSnapshotSha256=snapshotHash;
      const published=await db.runTransaction(async tx=>{
        const latest=await tx.get(eventRef);const old=await tx.get(resultRef);
        if(!latest.exists||old.exists||!due(latest.data()))return false;
        if(latest.data().participantCount!==entries.length)throw Error('Contagem mudou desde o snapshot.');
        tx.create(resultRef,{...publicResult,publishedAt:FieldValue.serverTimestamp()});
        tx.create(privateRef,{...privateResult,createdAt:FieldValue.serverTimestamp()});
        tx.update(eventRef,{raffleStatus:'drawn',updatedAt:FieldValue.serverTimestamp()});return true;
      });
      console.log(published?`Hub evento ${safeId(doc.id)}: resultado publicado.`:`Hub evento ${safeId(doc.id)}: já processado.`);
    }catch{failures++;console.error(`Hub evento ${safeId(doc.id)}: falha não sensível.`);}
  }
}finally{await db.terminate();}
if(failures)throw Error(`Apuração de produção terminou com ${failures} falha(s); nenhuma transação parcial foi confirmada.`);
