// Núcleo puro, independente de Firebase, testável no Node e offline.
import {createHash,randomInt,webcrypto} from 'node:crypto';
import {decryptPrivate,handle,maskName,drawEligible,drawAtMs} from '../public/assets/festas-core.js';

export function due(event,now=Date.now()){
  const timestamp=drawAtMs(event);
  return Number.isFinite(timestamp) && timestamp<=now && event.published===true && event.archived!==true && event.raffleStatus==='open'
    && Number.isInteger(event.winnerCount) && event.winnerCount>0;
}
export function cryptographicRandomAdapter(){
  return {getRandomValues(array){webcrypto.getRandomValues(array);return array;}};
}
export async function prepareRaffle({event,entries,profiles,privateKey,now=Date.now()}){
  if(!due(event,now))throw Error('Evento não está elegível para apuração.');
  if(!privateKey?.d)throw Error('Chave privada ausente.');
  const ordered=[...entries].sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.uid).localeCompare(String(b.uid)));
  const byHandle=new Map();
  let invalidEntryCount=0;
  for(const e of ordered){
    const encrypted=e.encryptedProfile;if(!encrypted){invalidEntryCount++;continue;}
    let profile;try{profile=await decryptPrivate(encrypted,privateKey,webcrypto.subtle);}catch{invalidEntryCount++;continue;}
    const ig=handle(profile.instagram);
    if(!ig||!profile.name||!profile.email){invalidEntryCount++;continue;}
    if(byHandle.has(ig))continue;
    byHandle.set(ig,{uid:e.uid,instagram:ig,name:profile.name,email:profile.email});
  }
  if(entries.length>0&&byHandle.size===0&&invalidEntryCount>0)throw Error('Nenhuma inscrição criptografada pôde ser validada com a chave QA.');
  const selected=drawEligible([...byHandle.values()],event.winnerCount,event.alternateCount,cryptographicRandomAdapter());
  const winners=selected.winners.map(({name})=>({mask:maskName(name)}));
  const alternates=selected.alternates.map(({name})=>({mask:maskName(name)}));
  const publicResult={status:'published',eligibleCount:selected.total,participantCount:entries.length,
    winners,alternates,method:'CSPRNG Fisher-Yates / rejeição de viés; duplicatas por @ excluídas',schemaVersion:2};
  const privateResult={winnerUids:selected.winners.map(p=>p.uid),alternateUids:selected.alternates.map(p=>p.uid),
    eligibleCount:selected.total,attemptedEntries:entries.length,invalidEntryCount,schemaVersion:2};
  return {publicResult,privateResult};
}
