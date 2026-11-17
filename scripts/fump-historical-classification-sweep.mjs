/**
 * Varredura HISTÓRICA somente leitura da API original da FUMP.
 *
 * A API em :3003 não está acessível nos runners do GitHub (timeout na porta);
 * executar diretamente em uma rede que consiga acessá-la, ex. PC Windows.
 *
 * Uso: node scripts/fump-historical-classification-sweep.mjs 2000-01-01
 * Uso: node scripts/fump-historical-classification-sweep.mjs 2018-01-01 2026-12-01
 *
 * Nunca edita dados da FUMP, Firestore, Worker ou public/data/cardapios.json.
 * Limita requisições, pausa entre GETs, valida datas/IDs e aborta após falhas.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {categoryFromSourceType,knownDishCategory} from '../public/assets/dish-category.js';
import {SWEEP_SOURCES,todayInBrazil} from './fump-window-classification-sweep.mjs';
const ORIGIN='https://fump.ufmg.br:3003';
const MAX_REQUESTS=450;
const MAX_BODY=2_000_000;
const iso=value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
  const d=new Date(value+'T12:00:00Z');
  return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;
};
const plusDays=(value,days)=>{
  const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
};
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('pt-BR').trim().replace(/[\u2010-\u2015-]/g,' ')
  .replace(/\s+/g,' ');
function parseDate(value){
  const str=String(value||'');
  const iso=str.match(/^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
  if(iso)return iso[1];
  const br=str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);
  return br?br[3]+'-'+br[2]+'-'+br[1]:null;
}
export function annualRanges(from,to){
  if(!iso(from)||!iso(to)||from>to)throw new Error('INVALID_RANGE');
  const out=[];
  for(let y=Number(from.slice(0,4));y<=Number(to.slice(0,4));y++){
    const yearStart=y+'-01-01',yearEnd=y+'-12-31';
    out.push({from:from>yearStart?from:yearStart,to:to<yearEnd?to:yearEnd});
  }
  return out;
}
export function classifyHistoricalResponse(data,{id,from,to},out){
  if(!data||!Array.isArray(data.cardapios)||
    (data.id!=null&&String(data.id)!==id))throw new Error('SCHEMA_INVALID');
  let total=0;
  for(const day of data.cardapios){
    if(!day||!Array.isArray(day.refeicoes))throw new Error('DAY_INVALID');
    const keys=['data','dataCardapio','dataReferencia'].filter(x=>day[x]!=null);
    const date=keys.length?parseDate(day[keys[0]]):null;
    if(!date || !iso(date) || date<from || date>to)throw new Error('DATE_UNVERIFIABLE');
    for(const key of keys)if(parseDate(day[key])!==date)throw new Error('DATE_CONFLICT');
    for(const meal of day.refeicoes){
      if(!meal||!Array.isArray(meal.pratos))throw new Error('MEAL_INVALID');
      for(const raw of meal.pratos){
        const name=typeof raw?.descricaoPrato==='string'?raw.descricaoPrato.trim():'';
        if(!name||name.length>180)continue;
        const sourceType=typeof raw.tipoPrato==='string'?raw.tipoPrato:'';
        const category=categoryFromSourceType(sourceType,name);
        const known=knownDishCategory(name);
        const official=categoryFromSourceType(sourceType,'preparacao nao registrada');
        const key=norm(name);
        let item=out.names.get(key);
        if(!item){
          item={name,count:0,sources:new Set(),types:new Set(),
            dates:new Set(),categories:new Set(),known:known||'',
            conflictingTypes:new Set()};
          out.names.set(key,item);
        }
        item.count++;item.sources.add(id);item.types.add(sourceType||'(vazio)');
        item.dates.add(date);item.categories.add(category||'(sem categoria)');
        if(official&&known&&official!==known)item.conflictingTypes.add(sourceType);
        total++;
      }
    }
  }
  out.records+=total;
  return {days:data.cardapios.length,records:total};
}
export async function scanHistorical({
  from='2000-01-01',to=plusDays(todayInBrazil(),14),fetchFn=fetch,
  sleepFn=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  pauseMs=1500,timeoutMs=12000,maxRequests=MAX_REQUESTS,onResult=()=>{}
}={}){
  const ranges=annualRanges(from,to);
  const out={from,to,records:0,names:new Map(),requests:[],errors:[],
    attempted:0,success:0,aborted:false};
  let consecutiveFailures=0;
  // Todas as fontes e todos os anos; dividir se o corpo for excessivo.
  async function collect(id,from,to,depth=0){
    if(out.attempted>=maxRequests){out.aborted=true;return;}
    out.attempted++;
    const url=new URL('/cardapios/cardapio',ORIGIN);
    url.searchParams.set('id',id);url.searchParams.set('dataInicio',from);url.searchParams.set('dataFim',to);
    const entry={id,from,to,status:null,days:0,records:0};
    let split=false;
    try{
      const response=await fetchFn(url.href,{method:'GET',redirect:'error',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeoutMs)});
      entry.status=response.status;
      if(response.status===429){entry.error='HTTP_429';out.aborted=true;}
      else if(response.status===413){split=true;}
      else if(!response.ok)entry.error='HTTP_'+response.status;
      else{
        const size=Number(response.headers?.get?.('content-length')||0);
        if(size>MAX_BODY){split=true;}
        else{
          const body=await response.text();
          if(body.length>MAX_BODY){split=true;}
          else {
            let data;try{data=JSON.parse(body)}catch{throw new Error('INVALID_JSON')}
            const got=classifyHistoricalResponse(data,{id,from,to},out);
            entry.days=got.days;entry.records=got.records;out.success++;
          }
        }
      }
    }catch(e){entry.error=String(e?.code||e?.name||'FETCH_ERROR').slice(0,60);}
    out.requests.push(entry);
    onResult(entry);
    if(split){
      if(from===to||depth>=10){
        entry.error='RESPONSE_TOO_LARGE';out.errors.push(entry);consecutiveFailures++;
      }else{
        const distance=Math.round((new Date(to+'T12:00:00Z')-
          new Date(from+'T12:00:00Z'))/86_400_000);
        const mid=plusDays(from,Math.floor(distance/2));
        if(pauseMs)await sleepFn(pauseMs);
        await collect(id,from,mid,depth+1);
        if(!out.aborted){if(pauseMs)await sleepFn(pauseMs);await collect(id,plusDays(mid,1),to,depth+1);}
        return;
      }
    }else if(entry.error){
      out.errors.push(entry);consecutiveFailures++;
    }else consecutiveFailures=0;
    // Um bloqueio ou falha de transporte persistente não gera centenas de GETs.
    if(consecutiveFailures>=3)out.aborted=true;
  }
  for(const period of ranges){
    for(const source of SWEEP_SOURCES){
      if(out.aborted)break;
      await collect(source.id,period.from,period.to);
      if(!out.aborted&&pauseMs)await sleepFn(pauseMs);
    }
    if(out.aborted)break;
  }
  const names=[...out.names.values()].map(x=>({
    name:x.name,count:x.count,sources:[...x.sources],dates:[...x.dates],
    types:[...x.types],categories:[...x.categories],known:x.known,
    conflictingOfficialTypes:[...x.conflictingTypes]
  })).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  return {
    from,to,expectedRangeQueries:ranges.length*SWEEP_SOURCES.length,
    attempted:out.attempted,success:out.success,errors:out.errors,
    aborted:out.aborted,complete:!out.aborted&&out.errors.length===0,
    records:out.records,distinctNames:names.length,
    unclassified:names.filter(x=>x.categories.includes('(sem categoria)')),
    unknownNames:names.filter(x=>!x.known),
    conflictingOfficialTypes:names.filter(x=>x.conflictingOfficialTypes.length),
    names,requests:out.requests
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const from=process.argv[2]||'2000-01-01';
  const to=process.argv[3]||plusDays(todayInBrazil(),14);
  const result=await scanHistorical({from,to,onResult:entry=>
    console.log('HISTORICAL_FUMP_REQUEST',JSON.stringify(entry))});
  await mkdir(new URL('../audit-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../audit-results/fump-historical-classification.json',import.meta.url),
    JSON.stringify(result,null,2)+'\n');
  console.log('HISTORICAL_FUMP_SUMMARY',JSON.stringify({
    from,to,complete:result.complete,attempted:result.attempted,success:result.success,
    errors:result.errors,records:result.records,distinctNames:result.distinctNames,
    unknownNames:result.unknownNames,unclassified:result.unclassified,
    conflictingOfficialTypes:result.conflictingOfficialTypes
  }));
  console.log('HISTORICAL_FUMP_REPORT audit-results/fump-historical-classification.json');
  if(!result.complete)process.exitCode=2;
}
