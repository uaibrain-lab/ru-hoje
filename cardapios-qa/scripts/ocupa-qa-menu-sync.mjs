/** Sincronização FUMP -> Firestore QA. Nunca importa publish.mjs ou copy-public-menu-homologation.mjs. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {API_BASE, RU_SOURCES, SOURCE_PAGE, dateInBrasilia,addDate, getJson,checkRestaurantList,menuUrl,parseMenuJson} from './fump-api.mjs';
import {PROJECT,DOCUMENT, safeContext,assertWriteGate,sanitizeIncoming,checkOld,mergeSnapshots,decideWrite} from './ocupa-qa-menu-core.mjs';

const args=process.argv.slice(2);
const accepted=/^--(?:mode=(?:collect|dry-run|apply)|days=[1-7]|ack=PUBLICAR_SOMENTE_OCUPA_QA)$/;
if(args.some(a=>!accepted.test(a)) || args.filter(a=>a.startsWith('--mode=')).length!==1 || args.filter(a=>a.startsWith('--days=')).length>1) throw new Error('ARGUMENTOS_NAO_PERMITIDOS');
const mode=args.find(a=>a.startsWith('--mode=')).split('=')[1];
const days=Number(args.find(a=>a.startsWith('--days='))?.split('=')[1]||'7');
safeContext();
if(mode==='apply') assertWriteGate(args);
else if(args.some(a=>a.startsWith('--ack='))) throw new Error('ACK_APENAS_APPLY');
const sha=s=>createHash('sha256').update(s).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const today=dateInBrasilia();
async function safeGet(url) {
  try { return await getJson(url,{timeoutMs:12000}); }
  catch(e) {await pause(600);return getJson(url,{timeoutMs:12000});}
}
async function collect(){
  const list=await safeGet(`${API_BASE}/cardapios/restaurantes`);
  checkRestaurantList(list);
  const started=new Date();
  const snapshot={schemaVersion:1,generatedAt:null,source:SOURCE_PAGE,days:{}};
  const stats={requests:0,empty:0,filled:0};
  // Em caso de erro de fonte, aborta a coleta sem publicar um snapshot incompleto.
  for(let n=0;n<days;n++) {
    const dayIso=addDate(today,n);
    for(const source of RU_SOURCES) {
      const raw=await safeGet(menuUrl(source.sourceId,dayIso));
      const {meals}=parseMenuJson(raw,{iso:dayIso,sourceId:source.sourceId});
      stats.requests++;
      if(!Object.keys(meals).length){stats.empty++;continue;}
      const stamp=new Date().toISOString();
      const day=snapshot.days[dayIso] ||= {restaurants:{}};
      for(const ru of source.appIds) day.restaurants[ru]={meals:Object.fromEntries(Object.entries(meals).map(([kind,meal])=>[kind,{...meal,fetchedAt:stamp}])),fetchedAt:stamp,sourceRestaurantId:source.sourceId};
      stats.filled++;
    }
  }
  snapshot.generatedAt=new Date().toISOString();
  const validated=sanitizeIncoming(snapshot,new Date(),days);
  if(new Date(snapshot.generatedAt).getTime()-started.getTime()>20*60*1000) throw new Error('COLETA_DEMORADA');
  return {...validated,stats};
}
const url=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${DOCUMENT}`;
async function readRest(){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try {
    const res=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal,redirect:'error'});
    if(res.status!==200) throw new Error(`LEITURA_PUBLICA_HTTP_${res.status}`);
    const raw=await res.json();
    const payload=raw?.fields?.payload?.stringValue;
    if(typeof payload!=='string') throw new Error('PAYLOAD_PUBLICO_AUSENTE');
    const parsed=JSON.parse(payload);checkOld(parsed);
    return {parsed,payload,updateTime:raw.updateTime};
  } finally {clearTimeout(timer);}
}
async function checkADC(){
  const f=process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if(!f) throw new Error('ADC_QA_OU_WIF_NAO_CONFIGURADO');
  const data=JSON.parse(await fs.readFile(f,'utf8'));
  if(data.type==='service_account') {
    if(data.project_id!==PROJECT) throw new Error('CREDENCIAL_PROJETO_DIVERGENTE');
    // Aceita só credencial explicitamente QA; em produção privilegiar WIF, nunca exportar chave.
  } else if(data.type==='external_account') {
    if(!data.service_account_impersonation_url || !data.service_account_impersonation_url.includes(`@${PROJECT}.iam.gserviceaccount.com`)) throw new Error('WIF_SEM_CONTA_QA');
  } else throw new Error('TIPO_ADC_NAO_APROVADO');
  return true;
}
async function backupOld(doc,now){
  const dir=process.env.OCUPA_QA_BACKUP_DIR;
  if(!dir||!path.isAbsolute(dir)) throw new Error('BACKUP_PRIVADO_OBRIGATORIO');
  const abs=path.resolve(dir),root=path.resolve(import.meta.dirname,'..');
  if(abs===root||abs.startsWith(root+path.sep)) throw new Error('BACKUP_DENTRO_DO_PROJETO');
  await fs.mkdir(abs,{recursive:true,mode:0o700});
  const text=JSON.stringify({project:PROJECT,document:DOCUMENT,updateTime:doc.updateTime,payload:doc.payload},null,2)+'\n';
  const dst=path.join(abs,`menu-qa-before-${now.toISOString().replace(/[:.]/g,'-')}-${sha(text).slice(0,10)}.json`);
  await fs.writeFile(dst,text,{flag:'wx',mode:0o600});
  return {path:dst,hash:sha(text)};
}
async function main(){
  const result=await collect();
  const summary={mode,project:PROJECT,document:DOCUMENT,startedDate:today,...result.summary,...result.stats,remoteWrites:0};
  if(mode==='collect'){console.log(JSON.stringify(summary));return;}
  if(mode==='dry-run'){
    const remote=await readRest();
    const merged=mergeSnapshots(remote.parsed,result.snapshot);
    const decision=decideWrite(remote.parsed,merged);
    const payload=JSON.stringify(merged);
    if(Buffer.byteLength(payload)>850_000) throw new Error('DOCUMENTO_ACIMA_850KB');
    console.log(JSON.stringify({...summary,remoteUpdateTime:remote.updateTime,mergedDays:Object.keys(merged.days).length,plannedWrites:Number(decision.write),reason:decision.write?decision.reason:'SEM_ALTERACOES',candidateSha256:sha(payload)}));
    return;
  }
  await checkADC();
  const {Firestore,FieldValue}=await import('@google-cloud/firestore');
  const db=new Firestore({projectId:PROJECT});
  try {
    const ref=db.doc(DOCUMENT);
    const old=await ref.get();
    if(!old.exists||!old.updateTime||typeof old.data()?.payload!=='string') throw new Error('DOCUMENTO_QA_EXISTENTE_OBRIGATORIO');
    const original=old.data().payload;
    const parsed=JSON.parse(original);checkOld(parsed);
    const merged=mergeSnapshots(parsed,result.snapshot);
    const decision=decideWrite(parsed,merged);
    const payload=JSON.stringify(merged);
    if(Buffer.byteLength(payload)>850_000) throw new Error('DOCUMENTO_ACIMA_850KB');
    if(!decision.write){console.log(JSON.stringify({...summary,writePerformed:0,reason:'SEM_ALTERACOES'}));return;}
    // Backup ANTES da escrita, com hora e updateTime originais preservados.
    const save=await backupOld({payload:original,updateTime:old.updateTime.toDate().toISOString()},new Date());
    // Uma escrita em um único documento, protegida por updateTime.
    await ref.update({payload,updatedAt:FieldValue.serverTimestamp()},{lastUpdateTime:old.updateTime});
    const after=await ref.get();
    if(after.data()?.payload!==payload) throw new Error('VERIFICACAO_ADMIN_DIVERGENTE');
    const publicCheck=await readRest();
    if(publicCheck.payload!==payload) throw new Error('VERIFICACAO_PUBLICA_DIVERGENTE');
    console.log(JSON.stringify({...summary,remoteWrites:1,writePerformed:1,reason:decision.reason,backupSha256:save.hash,backupPath:save.path,mergedDays:Object.keys(merged.days).length,payloadSha256:sha(payload),verifiedPublic:true}));
  } finally {await db.terminate();}
}
try{await main();}catch(e){
  console.error(`OCUPA_QA_SYNC_BLOQUEADO=${String(e?.message||'ERRO').replace(/[^A-Z0-9_\-]/gi,'_').slice(0,100)}`);
  process.exitCode=1;
}
