/** Guardas puras de consistência da apuração: sem Firestore, sem PII em logs. */
import {createHash} from 'node:crypto';
import {drawAtMs} from '../public/assets/festas-core.js';

export function entryFromDoc(doc) {
  const data=doc.data();
  return {
    uid:doc.id,
    createdAt:data.createdAt?.toDate?.()?.toISOString?.()||'',
    encryptedProfile:data.encryptedProfile
  };
}

export function entriesSnapshotHash(entries) {
  if(!Array.isArray(entries))throw new Error('INSCRICOES_INVALIDAS');
  // Mesmo formato de hash usado desde a primeira release; mantém auditabilidade.
  return createHash('sha256').update(entries.map(e=>
    `${e.uid}:${e.createdAt}:${JSON.stringify(e.encryptedProfile||{})}`
  ).sort().join('\n')).digest('hex');
}

export function eventFingerprint(event) {
  // Prazos usam drawAtTimestamp do servidor; não confiar em drawAt do UI.
  // Vincular também valores que definem premiação, visibilidade e contagem.
  return JSON.stringify([
    drawAtMs(event),event?.raffleStatus,event?.published===true,
    event?.archived===true,event?.winnerCount,event?.alternateCount,
    event?.participantCount,event?.rulesText||''
  ]);
}

export function assertRaffleSnapshotUnchanged({
  initialEvent,latestEvent,initialEntries,latestEntries,now=Date.now()
}) {
  if(!latestEvent)throw new Error('EVENTO_REMOVIDO');
  if(!Number.isFinite(now))throw new Error('RELOGIO_INVALIDO');
  // Impede publicar prêmio sorteado com parâmetros que mudaram durante a
  // descriptografia (inclusive se a contagem permaneceu igual).
  if(eventFingerprint(initialEvent)!==eventFingerprint(latestEvent))
    throw new Error('EVENTO_ALTERADO_DURANTE_APURACAO');
  if(initialEvent.participantCount!==initialEntries.length ||
     latestEvent.participantCount!==latestEntries.length)
    throw new Error('CONTAGEM_INSCRICOES_DIVERGENTE');
  if(entriesSnapshotHash(initialEntries)!==entriesSnapshotHash(latestEntries))
    throw new Error('INSCRICOES_ALTERADAS_DURANTE_APURACAO');
  if(!Number.isFinite(drawAtMs(latestEvent)) || drawAtMs(latestEvent)>now ||
     latestEvent.published!==true || latestEvent.archived===true ||
     !['open','closed'].includes(latestEvent.raffleStatus))
    throw new Error('EVENTO_NAO_ELEGIVEL');
  return true;
}

/** Usar somente com Admin SDK autorizado e Firestore transaction real.
 * Todas as leituras são realizadas ANTES das três escritas.
 * A consulta transacional de entries bloqueia/revalida as inscrições,
 * inclusive adições, remoções ou edições com o mesmo total.
 */
export async function publishRaffleAtomically({
  db,eventRef,event,entries,publicResult,privateResult,FieldValue,
  nowFn=()=>Date.now()
}) {
  const resultRef=eventRef.collection('results').doc('official');
  const privateRef=eventRef.collection('resultPrivate').doc('official');
  const entriesRef=eventRef.collection('entries');
  return db.runTransaction(async tx=>{
    const latest=await tx.get(eventRef);
    const publicBefore=await tx.get(resultRef);
    const privateBefore=await tx.get(privateRef);
    if(publicBefore.exists !== privateBefore.exists)
      throw new Error('RESULTADO_PARCIAL_PREEXISTENTE');
    if(publicBefore.exists)return false; // execução repetida: idempotência.
    if(!latest.exists)throw new Error('EVENTO_REMOVIDO');
    // QuerySnapshot transacional, não consulta eventual fora da transação.
    const entriesNow=(await tx.get(entriesRef)).docs.map(entryFromDoc);
    assertRaffleSnapshotUnchanged({
      initialEvent:event,latestEvent:latest.data(),
      initialEntries:entries,latestEntries:entriesNow,now:nowFn()
    });
    tx.create(resultRef,{...publicResult,publishedAt:FieldValue.serverTimestamp()});
    tx.create(privateRef,{...privateResult,createdAt:FieldValue.serverTimestamp()});
    tx.update(eventRef,{raffleStatus:'drawn',updatedAt:FieldValue.serverTimestamp()});
    return true;
  });
}
