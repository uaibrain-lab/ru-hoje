import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeSnapshots} from './merge-snapshots.mjs';
import {auditApiDiagnostics} from './prepare-api-snapshot.mjs';
import {isDeepStrictEqual} from 'node:util';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=JSON.parse(await fs.readFile(path.join(ROOT,'public/data/cardapios.json'),'utf8'));
if (!snapshot.generatedAt || !Object.keys(snapshot.days||{}).length) throw new Error('Nenhum cardápio validado para publicar.');
// Verifica a proveniência do arquivo preparado ANTES de abrir conexão Firebase.
// O runner deve conter as respostas brutas da mesma coleta e o gate aprovado.
const {snapshot:audited,report}=await auditApiDiagnostics(undefined,{requireToday:true});
const {verifiedCompleteDates, ...plainSnapshot}=snapshot;
if (!Array.isArray(verifiedCompleteDates) ||
    !isDeepStrictEqual(verifiedCompleteDates,report.verifiedCompleteDates) ||
    !isDeepStrictEqual(plainSnapshot,audited)) {
  throw new Error('Snapshot de publicação não confere com a auditoria das quatro fontes oficiais.');
}
const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if(!raw) throw new Error('Configure FIREBASE_SERVICE_ACCOUNT_JSON nos Secrets do GitHub Actions.');
let credentials;
try { credentials=JSON.parse(raw); } catch { throw new Error('Credenciais do Firebase: JSON inválido.'); }
if(!credentials.project_id || !credentials.client_email || !credentials.private_key) throw new Error('Credenciais do Firebase incompletas.');
if (credentials.project_id !== 'cardapioufmg') throw new Error('Credencial do projeto errado: esperado cardapioufmg.');
if (/uaibrain/i.test(credentials.project_id)) throw new Error('Não usar Firebase do UaiBrain.');
const [{initializeApp,cert},{getFirestore,FieldValue}]=await Promise.all([
  import('firebase-admin/app'),
  import('firebase-admin/firestore')
]);
const firebaseAdminApp=initializeApp({credential:cert(credentials)});
const db=getFirestore(firebaseAdminApp);
const docRef=db.doc('publicMenus/current');
// Read/merge/write in a transaction so a partially failed collection cannot
// delete unrelated restaurant/day data previously confirmed by the FUMP.
await db.runTransaction(async tx=>{
  const oldDoc=await tx.get(docRef);
  let old=null;
  try {old=JSON.parse(oldDoc.data()?.payload || 'null');} catch {old=null;}
  if (old?.generatedAt && Date.parse(old.generatedAt) > Date.parse(snapshot.generatedAt)) {
    console.log('Snapshot mais antigo que o documento remoto. Nenhuma escrita realizada.');
    return;
  }
  const merged=mergeSnapshots(old,snapshot);
  const payload=JSON.stringify(merged);
  if(Buffer.byteLength(payload,'utf8')>850_000) throw new Error('Tamanho acima do limite seguro Firestore (850 KB).');
  if(old && JSON.stringify(old.days)===JSON.stringify(merged.days)) {
    console.log('Sem mudanças de cardápio. Mantendo documento remoto.');return;
  }
  tx.set(docRef,{payload,updatedAt:FieldValue.serverTimestamp()});
  console.log(`Projeto ${credentials.project_id}: ${Object.keys(merged.days).length} dias consolidados.`);
});
