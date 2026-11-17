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

/**
 * Conferência de resultado preparado ANTES da escrita. Hash igual não basta:
 * rejeitar pool elegível vazio, ganhadores ausentes, UIDs duplicados,
 * sorteio incompleto e divergência entre conteúdo público e privado.
 */
export function assertPreparedRaffleResult({event,entries,publicResult,privateResult}) {
  const count=entries.length;
  const eligible=publicResult?.eligibleCount;
  if(!Number.isInteger(eligible)||eligible<1||eligible>count ||
     publicResult?.status!=='published' ||
     publicResult?.schemaVersion!==2 || privateResult?.schemaVersion!==2 ||
     privateResult?.eligibleCount!==eligible ||
     publicResult?.participantCount!==count ||
     privateResult?.attemptedEntries!==count ||
     !Number.isInteger(privateResult?.invalidEntryCount) ||
     privateResult.invalidEntryCount<0 ||
     !Array.isArray(publicResult?.winners) ||
     !Array.isArray(publicResult?.alternates) ||
     !Array.isArray(privateResult?.winnerUids) ||
     !Array.isArray(privateResult?.alternateUids))
    throw new Error('RESULTADO_PREPARADO_INCONSISTENTE');

  const winners=publicResult.winners.length;
  const alternates=publicResult.alternates.length;
  const expectedWinners=Math.min(event.winnerCount,eligible);
  const expectedAlternates=Math.min(event.alternateCount,eligible-expectedWinners);
  if(winners!==expectedWinners || alternates!==expectedAlternates ||
     winners!==privateResult.winnerUids.length ||
     alternates!==privateResult.alternateUids.length)
    throw new Error('QUANTIDADE_GANHADORES_DIVERGENTE');

  const eligibleIds=new Set(entries.map(row=>row.uid));
  const chosen=[...privateResult.winnerUids,...privateResult.alternateUids];
  if(chosen.some(uid=>typeof uid!=='string'||!eligibleIds.has(uid)) ||
     chosen.length!==new Set(chosen).size ||
     [...publicResult.winners,...publicResult.alternates].some(row=>
       typeof row?.mask!=='string'||!row.mask.trim()))
    throw new Error('GANHADORES_INVALIDOS_OU_DUPLICADOS');

  const hash=entriesSnapshotHash(entries);
  if(publicResult.entriesSnapshotSha256!==hash ||
     privateResult.entriesSnapshotSha256!==hash)
    throw new Error('HASH_DO_RESULTADO_INCONSISTENTE');
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
    assertPreparedRaffleResult({
      event:latest.data(),entries:entriesNow,publicResult,privateResult
    });
    tx.create(resultRef,{...publicResult,publishedAt:FieldValue.serverTimestamp()});
    tx.create(privateRef,{...privateResult,createdAt:FieldValue.serverTimestamp()});
    tx.update(eventRef,{raffleStatus:'drawn',updatedAt:FieldValue.serverTimestamp()});
    return true;
  });
}
