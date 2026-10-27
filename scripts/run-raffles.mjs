// Executor privado agendado, sem Cloud Functions. Inerte sem autorização explícita.
// GitHub Actions: a cada 5 min aproximadamente, NÃO garante disparo exato.
import {prepareRaffle,due} from './raffle-engine.mjs';

const commit=process.argv.includes('--commit');
if(!commit){console.log('SIMULAÇÃO: execução sem --commit, nenhuma gravação.');process.exit(0);}
if(process.env.RU_FESTAS_DRAW_ENABLED!=='true')throw Error('GATE: apuração não habilitada.');
if(process.env.RU_FESTAS_PROJECT_ID!=='cardapioufmg')throw Error('Projeto Firebase diferente do permitido.');
const credentials=JSON.parse(process.env.RU_FESTAS_FIREBASE_SERVICE_ACCOUNT||'null');
const privateKey=JSON.parse(process.env.RU_FESTAS_PRIVATE_KEY_JWK||'null');
if(credentials?.project_id!=='cardapioufmg'||!privateKey?.d)throw Error('Credenciais de apuração ausentes ou inválidas.');
const [{initializeApp,cert,deleteApp},{getFirestore,FieldValue}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/firestore')]);
const app=initializeApp({credential:cert(credentials),projectId:'cardapioufmg'},'raffle-worker');
const db=getFirestore(app);
try{
  const snap=await db.collection('events').where('raffleStatus','==','open').get();
  for(const doc of snap.docs){
    const data=doc.data();if(!due(data))continue;
    const eventRef=doc.ref,resultRef=doc.ref.collection('results').doc('official');
    const privateRef=doc.ref.collection('resultPrivate').doc('official');
    const entries=await doc.ref.collection('entries').get();
    const entryRows=entries.docs.map(d=>({uid:d.id,createdAt:d.data().createdAt?.toDate?.()?.toISOString?.()||'',encryptedProfile:d.data().encryptedProfile}));
    const {publicResult,privateResult}=await prepareRaffle({event:data,entries:entryRows,profiles:[],privateKey});
    // Checagem e escrita atômicas: reexecução e execuções paralelas não publicam duas vezes.
    const published=await db.runTransaction(async tx=>{
      const [latest,old]=await Promise.all([tx.get(eventRef),tx.get(resultRef)]);
      if(!latest.exists||old.exists||!due(latest.data()))return false;
      tx.create(resultRef,{...publicResult,publishedAt:FieldValue.serverTimestamp()});
      tx.create(privateRef,{...privateResult,createdAt:FieldValue.serverTimestamp()});
      tx.update(eventRef,{raffleStatus:'drawn',updatedAt:FieldValue.serverTimestamp()});
      return true;
    });
    console.log(published?`Sorteio ${doc.id}: resultado publicado (sem PII no log).`:`Sorteio ${doc.id}: já processado.`);
  }
}finally{await deleteApp(app);}
