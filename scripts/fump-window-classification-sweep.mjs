/**
 * Varredura read-only do intervalo que o Worker Hub/FUMP permite (hoje a D+14).
 * Uma única requisição por ID de origem e data, sem cache local de cardápios.
 * ZERO Firestore, ZERO publicação, ZERO acesso direto a URLs arbitrárias.
 * Comando: node scripts/fump-window-classification-sweep.mjs
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {categoryFromSourceType,knownDishCategory,publishedCategory} from '../public/assets/dish-category.js';

export const SWEEP_SOURCES=Object.freeze([
  {id:'6',name:'Setorial I'},
  {id:'1',name:'Setorial II'},
  {id:'2',name:'Saúde / Direito'},
  {id:'5',name:'ICA'}
]);
export const SWEEP_BASE='https://hub-fump-proxy.hubufmg.workers.dev';
const PAUSE_MS=900;
const isoDate=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
  const d=new Date(value+'T12:00:00Z');
  return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;
};
export function todayInBrazil(now=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
export function calendarWindow(today=todayInBrazil()){
  if(!isoDate(today))throw new Error('SWEEP_INVALID_START');
  const dates=[];
  for(let day=0;day<=14;day++){
    const value=new Date(today+'T12:00:00Z');
    value.setUTCDate(value.getUTCDate()+day);
    dates.push(value.toISOString().slice(0,10));
  }
  return dates;
}
const normalize=value=>String(value??'')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('pt-BR').trim()
  .replace(/[\u2010-\u2015-]/g,' ').replace(/\s+/g,' ');
function responseDate(value){
  const s=String(value||'');
  const iso=s.match(/^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
  if(iso)return iso[1];
  const br=s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);
  return br?br[3]+'-'+br[2]+'-'+br[1]:null;
}
export function collectWindowResponse(report,{id,date,json}){
  if(!json || !Array.isArray(json.cardapios) ||
     (json.id!==undefined&&String(json.id)!==id))throw new Error('SCHEMA_INVALID');
  let count=0;
  for(const day of json.cardapios){
    if(!day || !Array.isArray(day.refeicoes))throw new Error('DAY_INVALID');
    const fields=['data','dataCardapio','dataReferencia'].filter(x=>day[x]!=null);
    for(const key of fields)if(responseDate(day[key])!==date)
      throw new Error('DATE_MISMATCH');
    for(const meal of day.refeicoes){
      if(!meal || !Array.isArray(meal.pratos))throw new Error('MEAL_INVALID');
      for(const dish of meal.pratos){
        const name=typeof dish?.descricaoPrato==='string'?dish.descricaoPrato.trim():'';
        if(!name||name.length>180)continue;
        const sourceType=typeof dish.tipoPrato==='string'?dish.tipoPrato.trim():'';
        const category=categoryFromSourceType(sourceType,name);
        const effective=publishedCategory(category,name,sourceType);
        const documented=knownDishCategory(name);
        const official=categoryFromSourceType(sourceType,'prato hipotetico desconhecido');
        const key=normalize(name);
        let item=report.names.get(key);
        if(!item){
          item={name,occurrences:0,sources:new Set(),dates:new Set(),
            types:new Set(),categories:new Set(),effective:new Set(),
            documented:documented||'',officialConflicts:new Set()};
          report.names.set(key,item);
        }
        item.occurrences++;
        item.sources.add(id);
        item.dates.add(date);
        item.types.add(sourceType||'(vazio)');
        item.categories.add(category||'(sem categoria)');
        item.effective.add(effective||'(sem categoria)');
        if(official&&documented&&official!==documented)
          item.officialConflicts.add(official+' / '+sourceType);
        count++;
      }
    }
  }
  report.totalDishes+=count;
  return count;
}
export async function sweepWindow({
  today=todayInBrazil(),fetchFn=fetch,sleepFn=ms=>new Promise(r=>setTimeout(r,ms)),
  pauseMs=PAUSE_MS,timeoutMs=9000,onResult=()=>{}
}={}){
  const dates=calendarWindow(today),report={
    dateStart:dates[0],dateEnd:dates.at(-1),
    sources:SWEEP_SOURCES.map(x=>({...x})),attempted:0,ok:0,empty:0,
    totalDishes:0,errors:[],requests:[],names:new Map(),aborted:false
  };
  let consecutiveErrors=0;
  // 4 fontes x 15 datas, com pausa entre GETs. Não retry em 429/503.
  for(const date of dates){
    for(const source of SWEEP_SOURCES){
      const url=SWEEP_BASE+'/api/menu?id='+source.id+'&data='+date;
      const entry={date,id:source.id,source:source.name,status:null,count:0};
      report.attempted++;
      try{
        const response=await fetchFn(url,{method:'GET',redirect:'error',
          cache:'no-store',headers:{Accept:'application/json'},
          signal:AbortSignal.timeout(timeoutMs)});
        entry.status=response.status;
        if(!response.ok){
          entry.error='HTTP_'+response.status;
          report.errors.push(entry);
          consecutiveErrors++;
          if(response.status===429)report.aborted=true;
        }else{
          const raw=await response.text();
          if(raw.length>1_000_000)throw new Error('BODY_TOO_LARGE');
          let data;try{data=JSON.parse(raw)}catch{throw new Error('INVALID_JSON')}
          entry.count=collectWindowResponse(report,{id:source.id,date,json:data});
          entry.cache=response.headers?.get?.('x-menu-cache')||'';
          entry.fetchedAt=response.headers?.get?.('x-menu-fetched-at')||'';
          report.ok++;
          if(!entry.count)report.empty++;
          consecutiveErrors=0;
        }
      }catch(error){
        entry.error=String(error?.code||error?.name||'UNKNOWN').replace(/[^A-Za-z0-9_]/g,'').slice(0,50);
        report.errors.push(entry);
        consecutiveErrors++;
      }
      report.requests.push(entry);
      onResult(entry);
      // Se a API está indisponível, não sobrecarregar o servidor.
      if(consecutiveErrors>=8)report.aborted=true;
      if(report.aborted)break;
      if(pauseMs>0)await sleepFn(pauseMs);
    }
    if(report.aborted)break;
  }
  const names=[...report.names.values()].map(x=>({
    name:x.name,occurrences:x.occurrences,
    sources:[...x.sources],dates:[...x.dates],
    sourceTypes:[...x.types],categories:[...x.categories],
    effectiveCategories:[...x.effective],knownCategory:x.documented,
    mismatchedOfficialCategories:[...x.officialConflicts]
  })).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  return {
    dateStart:report.dateStart,dateEnd:report.dateEnd,
    sources:report.sources,expected:dates.length*SWEEP_SOURCES.length,
    attempted:report.attempted,ok:report.ok,empty:report.empty,
    errors:report.errors,aborted:report.aborted,
    complete:!report.aborted&&report.errors.length===0&&report.ok===dates.length*SWEEP_SOURCES.length,
    records:report.totalDishes,uniqueDishes:names.length,
    unknownNames:names.filter(x=>!x.knownCategory),
    unclassified:names.filter(x=>x.effectiveCategories.includes('(sem categoria)')),
    officialDisagreements:names.filter(x=>x.mismatchedOfficialCategories.length),
    categorizationConflicts:names.filter(x=>x.effectiveCategories.length>1),
    names,requests:report.requests
  };
}
if(process.argv[1]&&new URL('file://'+process.argv[1]).href===import.meta.url){
  const report=await sweepWindow({onResult:entry=>
    console.log('SWEEP_DAY',JSON.stringify(entry))});
  const outfile=process.env.FUMP_SWEEP_REPORT_FILE||'audit-results/fump-window-classification.json';
  await mkdir(new URL('../audit-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../'+outfile,import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log('FUMP_SWEEP_SUMMARY',JSON.stringify({
    from:report.dateStart,to:report.dateEnd,expected:report.expected,
    attempted:report.attempted,ok:report.ok,empty:report.empty,
    errors:report.errors,complete:report.complete,
    records:report.records,uniqueDishes:report.uniqueDishes,
    unknownNames:report.unknownNames,
    unclassified:report.unclassified,officialDisagreements:report.officialDisagreements,
    categorizationConflicts:report.categorizationConflicts
  }));
  console.log('FUMP_SWEEP_REPORT',outfile);
}
