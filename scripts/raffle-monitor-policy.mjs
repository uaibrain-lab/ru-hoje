/**
 * Política pura do monitor de sorteios: não lê Firestore, não apura sorteios.
 * Só classifica se houve execução agendada na main dentro da janela.
 */
export function evaluateRaffleMonitor(runs,{
  enabled=false,now=Date.now(),maxAgeMs=120*60_000,
  pendingGraceMinutes=30
}={}) {
  if(!enabled)return {status:'DISABLED',runId:null};
  if(!Array.isArray(runs)||!Number.isFinite(now))return {status:'INVALID_INPUT',runId:null};
  const active=runs.filter(r=>{
    if(r?.event!=='schedule'||r?.head_branch!=='main')return false;
    const created=Date.parse(r.created_at||'');
    return Number.isFinite(created) && created<=now+60_000 &&
      now-created>=0 && now-created<=maxAgeMs;
  }).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
  const success=active.find(r=>r.status==='completed'&&r.conclusion==='success');
  if(success)return {status:'SUCCESS',runId:success.id};
  const running=active.find(r=>['queued','in_progress','waiting','requested','pending'].includes(r.status));
  const part=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  const minutes=Number(part.hour)*60+Number(part.minute);
  if(running && minutes<19*60+pendingGraceMinutes)
    return {status:'PENDING',runId:running.id};
  return {status:'MISSING_OR_FAILED',runId:active[0]?.id||null};
}

if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href) {
  const chunks=[];
  for await(const part of process.stdin)chunks.push(Buffer.from(part));
  let runs;
  try {runs=JSON.parse(Buffer.concat(chunks).toString('utf8'))?.workflow_runs;}
  catch {runs=null;}
  const result=evaluateRaffleMonitor(runs,{
    enabled:process.env.HUB_PROD_RAFFLES_ENABLED==='true'
  });
  console.log(result.status);
  if(result.status==='INVALID_INPUT')process.exitCode=2;
}
