// Migração não destrutiva, EXCLUSIVA do Firebase QA. Dry-run por padrão.
// Necessária antes de publicar Rules/listagem que exigem archived == false.
import {Firestore} from '@google-cloud/firestore';

const QA_PROJECT='bandeco-homologacao';
const write=process.argv.includes('--write');
if (!process.argv.includes('--project=bandeco-homologacao')) {
  throw new Error('Projeto explícito QA obrigatório: --project=bandeco-homologacao');
}
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT!==QA_PROJECT) {
  throw new Error('GCLOUD_PROJECT não corresponde ao projeto QA.');
}
if (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT!==QA_PROJECT) {
  throw new Error('GOOGLE_CLOUD_PROJECT não corresponde ao projeto QA.');
}
if (write && !process.argv.includes('--confirm=QA-ONLY-ARCHIVED-BACKFILL')) {
  throw new Error('Para aplicar: --write --confirm=QA-ONLY-ARCHIVED-BACKFILL');
}
const db=new Firestore({projectId:QA_PROJECT});
try {
  const snap=await db.collection('events').get();
  const legacy=snap.docs.filter(doc=>!Object.hasOwn(doc.data(),'archived'));
  console.log(`QA: ${snap.size} festa(s), ${legacy.length} sem campo archived. Modo: ${write?'APLICAR':'DRY-RUN'}.`);
  if (!write)process.exitCode=0;
  else {
    let changed=0;
    for (const doc of legacy){
      // update apenas se o campo ainda estiver ausente; operação idempotente e reversível por backup.
      await db.runTransaction(async tx=>{
        const now=await tx.get(doc.ref);
        if (now.exists && !Object.hasOwn(now.data(),'archived')){
          tx.update(doc.ref,{archived:false});changed++;
        }
      });
    }
    console.log(`QA: ${changed} documento(s) normalizado(s); nenhum evento excluído.`);
  }
}finally{await db.terminate();}
