/**
 * Diagnóstico API JSON da FUMP. NÃO grava em public/data e NÃO publica Firestore.
 * Uso: node scripts/sync-api.mjs --days 7
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {API_BASE,SOURCE_PAGE,RU_SOURCES,dateInBrasilia,addDate,getJson,checkRestaurantList,menuUrl,parseMenuJson} from './fump-api.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DIAG=path.join(ROOT,'diagnostics','fump-api');
const args=process.argv.slice(2);
if(args.some(a=>a!=='--days' && !/^\d+$/.test(a))) throw new Error('Uso: node scripts/sync-api.mjs --days 7');
const ix=args.indexOf('--days');
const days=ix<0 ? 7 : Number(args[ix+1]);
if(!Number.isInteger(days) || days<1 || days>7) throw new Error('Número de dias fora do intervalo 1 a 7');

const snapshot={schemaVersion:1,generatedAt:null,source:SOURCE_PAGE,days:{}};
const summary={mode:'diagnostico-sem-publicacao',api:API_BASE,startedAt:new Date().toISOString(),restaurants:null,success:0,empty:0,failures:[],rows:[]};
async function main(){
  await fs.mkdir(DIAG,{recursive:true});
  // Abortar a coleta se os IDs da API não corresponderem ao mapa conhecido.
  try {
    const restaurantResponse=await getJson(`${API_BASE}/cardapios/restaurantes`);
    await fs.writeFile(path.join(DIAG,'raw-restaurantes.json'),JSON.stringify(restaurantResponse,null,2)+'\n');
    summary.restaurants=checkRestaurantList(restaurantResponse);
  } catch(e) {
    summary.failures.push({stage:'restaurantes',error:String(e.message||e)});
    return;
  }
  const date=dateInBrasilia();
  for(let i=0;i<days;i++){
    const iso=addDate(date,i);
    for (const source of RU_SOURCES) {
      try {
        const data=await getJson(menuUrl(source.sourceId,iso));
        await fs.writeFile(path.join(DIAG,`raw-${iso}-id${source.sourceId}.json`),JSON.stringify(data,null,2)+'\n');
        const {meals,meta}=parseMenuJson(data,{iso,sourceId:source.sourceId});
        const names=Object.entries(meals).map(([key,value])=>`${key}:${value.items.length}`);
        if(!names.length){summary.empty++;summary.rows.push({iso,sourceId:source.sourceId,status:'sem cardapio',meta});continue;}
        const moment=new Date().toISOString();
        const day=snapshot.days[iso] ||= {restaurants:{}};
        for(const id of source.appIds) {
          day.restaurants[id]={meals:Object.fromEntries(Object.entries(meals).map(([key,value])=>[key,{...value,fetchedAt:moment}])),fetchedAt:moment,sourceRestaurantId:source.sourceId};
        }
        summary.success++;
        summary.rows.push({iso,sourceId:source.sourceId,apps:source.appIds,status:'capturado-nao-validado',meals:names,meta});
        console.log(`${iso}: ${source.label}: ${names.join(', ')}`);
      } catch (e) {
        summary.failures.push({stage:'cardapio',iso,sourceId:source.sourceId,error:String(e.message||e)});
        console.error(`${iso}: ${source.label}: ${e.message}`);
      }
    }
  }
  if(summary.success>0) snapshot.generatedAt=new Date().toISOString();
}
try {await main();} finally {
  summary.finishedAt=new Date().toISOString();
  await fs.mkdir(DIAG,{recursive:true});
  await fs.writeFile(path.join(DIAG,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  await fs.writeFile(path.join(DIAG,'candidate.json'),JSON.stringify(snapshot,null,2)+'\n');
  console.log(`Diagnóstico: ${summary.success} fontes capturadas, ${summary.empty} vazias, ${summary.failures.length} falhas.`);
  console.log('Saída isolada em diagnostics/fump-api/. Nenhum arquivo de produção modificado.');
  if(summary.failures.length || !summary.success) process.exitCode=1;
}
