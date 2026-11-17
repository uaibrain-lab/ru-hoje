/**
 * Sondagem SOMENTE LEITURA da amplitude histórica da API pública FUMP.
 * Não grava cardápios, não usa chaves, não altera Worker ou Firestore.
 * Executar temporariamente no CI: node scripts/fump-date-range-probe.mjs
 */
const origin='https://fump.ufmg.br:3003';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const queries=[
  ['ru6_today',`${origin}/cardapios/cardapio?id=6&dataInicio=${today}&dataFim=${today}`],
  ['ru6_oct2026',`${origin}/cardapios/cardapio?id=6&dataInicio=2026-10-01&dataFim=2026-10-31`],
  ['ru6_oct2025',`${origin}/cardapios/cardapio?id=6&dataInicio=2025-10-01&dataFim=2025-10-31`],
  ['ru6_oct2020',`${origin}/cardapios/cardapio?id=6&dataInicio=2020-10-01&dataFim=2020-10-31`],
  ['worker_today',`https://hub-fump-proxy.hubufmg.workers.dev/api/menu?id=6&data=${today}`]
];
for(const [label,url] of queries){
  const started=Date.now();
  try{
    const res=await fetch(url,{redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(13000)});
    const raw=await res.text();
    let parsed;try{parsed=JSON.parse(raw)}catch{}
    const days=Array.isArray(parsed?.cardapios)?parsed.cardapios:[];
    let dishes=0;for(const d of days)for(const meal of d.refeicoes||[])dishes+=meal.pratos?.length||0;
    console.log('FUMP_DATE_PROBE',JSON.stringify({label,status:res.status,
      type:res.headers.get('content-type'),size:raw.length,cardapios:days.length,
      dishes,firstDate:days[0]?.data||null,lastDate:days.at(-1)?.data||null,
      error:parsed?.error||null,ms:Date.now()-started}));
  }catch(err){
    console.log('FUMP_DATE_PROBE',JSON.stringify({label,exception:err?.name||'Error',
      cause:err?.cause?.code||null,ms:Date.now()-started}));
  }
  await new Promise(r=>setTimeout(r,1200));
}
