// Exclusão permanente exclusivamente QA; NUNCA executar em produção.
// Executar primeiro SEM --write: node scripts/cleanup-festas-test-qa.mjs --project=bandeco-homologacao --id=<ID>
// Escrita separada, apenas após revisão humana e com credencial QA explicitamente autorizada.
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp,GeoPoint} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const TARGET='bandeco-homologacao';
const opts=new Map(process.argv.slice(2).map(arg=>{const match=/^--([a-z-]+)(?:=(.*))?$/.exec(arg);if(!match)throw Error('Argumento inválido.');return [match[1],match[2]??'true'];}));
function requireArgs(){
  if(opts.get('project')!==TARGET)throw Error('Projeto inválido: somente bandeco-homologacao.');
  const id=opts.get('id');
  if(!id||!/^[a-zA-Z0-9_-]{1,120}$/.test(id))throw Error('Informe um único --id seguro.');
  if(opts.has('all'))throw Error('Exclusão em massa proibida.');
  for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','FIREBASE_CONFIG']){
    const val=process.env[key];if(val && key!=='FIREBASE_CONFIG' && val!==TARGET)throw Error(`${key} não aponta para QA.`);
  }
  if(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw Error('Não executar este utilitário QA com variáveis de Emulator.');
  const write=opts.has('write');
  if(write && (opts.get('confirm')!==`DELETE-QA-${id}` || !opts.get('expected-name') || !opts.get('snapshot-dir')))
    throw Error('Escrita exige --confirm=DELETE-QA-<id>, --expected-name exato e --snapshot-dir local.');
  return {id,write};
}
function snapshotEncoder(_key,value){
  if(value instanceof Timestamp)return {$timestamp:value.toDate().toISOString(),seconds:value.seconds,nanoseconds:value.nanoseconds};
  if(value instanceof GeoPoint)return {$geo:[value.latitude,value.longitude]};
  if(value instanceof Date)return {$date:value.toISOString()};
  if(Buffer.isBuffer(value))return {$bytes:value.toString('base64')};
  return value;
}
async function inspectChildren(ref){
  const collections=await ref.listCollections();
  const nonempty=[];
  for(const collection of collections){if(!(await collection.limit(1).get()).empty)nonempty.push(collection.id);}
  return nonempty;
}
async function main(){
  const {id,write}=requireArgs();
  const app=initializeApp({credential:applicationDefault(),projectId:TARGET},'qa-test-cleanup');
  try{
    const db=getFirestore(app);const ref=db.collection('events').doc(id),posterRef=db.collection('eventPosters').doc(id);
    const [event,poster,children]=await Promise.all([ref.get(),posterRef.get(),inspectChildren(ref)]);
    if(!event.exists)throw Error('Evento não encontrado em QA.');
    const info=event.data();
    const eligible=info.archived===true && info.published===false && info.participantCount===0
      && info.raffleStatus!=='drawn' && children.length===0;
    console.log(JSON.stringify({mode:write?'WRITE':'DRY_RUN',project:TARGET,eventId:id,name:info.name,
      archived:info.archived===true,published:info.published===true,participantCount:info.participantCount,
      raffleStatus:info.raffleStatus,subcollectionsWithDocuments:children,hasPoster:poster.exists,eligible},null,2));
    if(!eligible)throw Error('Exclusão bloqueada: arquive/oculte primeiro e confirme ausência de inscrições, resultados e subcoleções.');
    if(!write){console.log('DRY_RUN_OK: nenhuma alteração foi realizada.');return;}
    if(opts.get('expected-name')!==info.name)throw Error('O nome atual diverge de --expected-name; não excluir.');
    const filename=`bandeco-qa-event-${id}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    const dir=path.resolve(opts.get('snapshot-dir'));
    await mkdir(dir,{recursive:true,mode:0o700});
    const dump=JSON.stringify({project:TARGET,id,exportedAt:new Date().toISOString(),event:info,poster:poster.exists?poster.data():null},snapshotEncoder,2);
    const file=path.join(dir,filename);
    await writeFile(file,dump,{flag:'wx',mode:0o600});
    const digest=createHash('sha256').update(dump).digest('hex');
    console.log(JSON.stringify({snapshot:file,sha256:digest,warning:'Backup JSON de referência; restauração exige procedimento administrativo separado. Não contém subcoleções porque a exclusão só é autorizada quando estão vazias.'}));
    await db.runTransaction(async tx=>{
      const [latest,latestPoster]=await Promise.all([tx.get(ref),tx.get(posterRef)]);
      if(!latest.exists)throw Error('Evento desapareceu.');
      const cur=latest.data();
      if(cur.name!==info.name || cur.archived!==true || cur.published!==false || cur.participantCount!==0 || cur.raffleStatus==='drawn'
        || latest.updateTime.toMillis()!==event.updateTime.toMillis())throw Error('Evento mudou após o snapshot. Exclusão cancelada.');
      if(latestPoster.exists!==poster.exists || (poster.exists&&latestPoster.updateTime.toMillis()!==poster.updateTime.toMillis()))
        throw Error('Cartaz mudou após o snapshot. Exclusão cancelada.');
      tx.delete(ref);
      if(latestPoster.exists)tx.delete(posterRef);
    });
    console.log('DELETE_QA_OK: evento e cartaz removidos; nenhum dado pessoal ou resultado excluído.');
  }finally{await deleteApp(app);}
}
main().catch(e=>{console.error(`BLOQUEADO: ${e.message}`);process.exitCode=1;});
