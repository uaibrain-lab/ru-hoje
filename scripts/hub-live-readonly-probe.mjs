/**
 * Audita somente leitura da implantação Hub UFMG.
 * Não requer Firebase Admin/WIF e não publica dados.
 * Não registra pratos nem informações de participantes.
 */
const TIMEZONE='America/Sao_Paulo';
const ORIGIN='https://hubufmg.web.app';
const DATA_URL='https://firestore.googleapis.com/v1/projects/hubufmg/databases/(default)/documents/publicMenus/current';
const RUS=['setorial-i','setorial-ii','saude','direito','ica'];
const today=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'
}).formatToParts(new Date()).map(x=>[x.type,x.value]));
const iso=`${today.year}-${today.month}-${today.day}`;

async function retrieve(url,headers={}) {
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),15000);
  try {
    const r=await fetch(url,{signal:c.signal,cache:'no-store',headers});
    const content=await r.text();
    if (!r.ok) throw new Error('HTTP_'+r.status);
    return {content,status:r.status};
  } finally {clearTimeout(timer);}
}

async function main() {
  const checks=[
    ['site',ORIGIN+'/'],
    ['app',ORIGIN+'/assets/app.js'],
    ['live_module',ORIGIN+'/assets/fump-live.js'],
    ['worker',ORIGIN+'/service-worker.js'],
    ['firestore',DATA_URL]
  ];
  const result={dateBrasilia:iso,checkedAt:new Date().toISOString(),readOnly:true,checks:{},menu:{}};
  let payload=null;
  for(const [name,url] of checks){
    try {
      const {content,status}=await retrieve(url);
      result.checks[name]={status:'ok',http:status,bytes:content.length};
      if(name==='app'){
        result.checks.app.liveFetchIncluded=content.includes('readLiveMenu');
      } else if(name==='worker'){
        result.checks.worker.version=content.match(/const VERSION\s*=\s*'([^']+)'/)?.[1]||null;
      } else if(name==='firestore'){
        const doc=JSON.parse(content);
        result.checks.firestore.updatedAt=doc.updateTime||null;
        payload=JSON.parse(doc.fields?.payload?.stringValue||'null');
        result.checks.firestore.generatedAt=payload?.generatedAt||null;
      }
    }catch(e){
      result.checks[name]={status:'error',code:String(e?.cause?.code||e?.name||e?.message||'UNKNOWN').slice(0,50)};
    }
  }
  for(const ru of RUS){
    const found=payload?.days?.[iso]?.restaurants?.[ru];
    result.menu[ru]={
      fetchedAt:found?.fetchedAt||null,
      meals:Object.fromEntries(
        Object.entries(found?.meals||{}).map(([k,v])=>[k,Array.isArray(v?.items)?v.items.length:0])
      )
    };
  }
  // Verificação externa real, sem writes: o proxy atende menus de hoje
  // E dos próximos dias? Dados vazios não são interpretados como RU fechado.
  const future=new Date(iso+'T12:00:00Z');
  future.setUTCDate(future.getUTCDate()+1);
  const tomorrow=future.toISOString().slice(0,10);
  result.proxy={origin:'https://hub-fump-proxy.hubufmg.workers.dev',checks:[]};
  for(const date of [iso,tomorrow]){
    for(const id of ['6','1','2','5']){
      const url=new URL('/api/menu',result.proxy.origin);
      url.searchParams.set('id',id);
      url.searchParams.set('data',date);
      try{
        const response=await retrieve(url.href,{Origin:ORIGIN,Accept:'application/json'});
        const json=JSON.parse(response.content);
        if(String(json?.id)!==id || !Array.isArray(json?.cardapios))
          throw new Error('RU_OR_SCHEMA_MISMATCH');
        let dishes=0;
        for(const day of json.cardapios){
          for(const meal of day?.refeicoes || []){
            if(Array.isArray(meal?.pratos)) dishes+=meal.pratos.length;
          }
        }
        result.proxy.checks.push({
          date,sourceId:id,
          status:dishes>0 ? 'VALID_MENU' : 'NOT_PUBLISHED',
          dishes
        });
      }catch(error){
        result.proxy.checks.push({
          date,sourceId:id,status:'FETCH_ERROR',
          code:String(error?.message||error?.name||'UNKNOWN').slice(0,60)
        });
      }
    }
  }
  result.menuDates=Object.keys(payload?.days||{}).sort().slice(-10);
  const blank=Object.values(result.menu).every(x=>Object.values(x.meals).every(count=>count===0));
  result.hasMenuToday=!blank;
  console.log('HUB_LIVE_READONLY_AUDIT='+JSON.stringify(result));
  if(result.checks.firestore.status!=='ok') process.exitCode=2;
}
await main();