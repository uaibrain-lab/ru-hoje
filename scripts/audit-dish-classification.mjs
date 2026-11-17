/**
 * Audita classificações já registradas sem alterar ou publicar cardápios.
 * Abrange o catálogo de ingredientes e o histórico FUMP local (somente evidência).
 * Executar: node scripts/audit-dish-classification.mjs
 */
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {knownDishCategory,publishedCategory} from '../public/assets/dish-category.js';

const VALID=new Set(['proteina','vegetariana','guarnicao','acompanhamento',
  'salada','molho','sobremesa','bebida']);
const normalize=name=>String(name??'').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim()
  .replace(/[\u2010-\u2015-]/g,' ').replace(/\s+/g,' ');

export function auditRegisteredDishes({catalog,history}){
  if(!Array.isArray(catalog?.dishes) || !history?.days ||
      typeof history.days!=='object' || Array.isArray(history.days))
    throw new Error('DISH_AUDIT_INVALID_INPUT');
  const names=new Set(),recipeNames=new Set(),historicNames=new Set();
  const originalBlanks=[],unresolved=[],changed=[],byName=new Map(),counts={};
  let historicOccurrences=0;
  for(const dish of catalog.dishes){
    const name=String(dish?.name||'').trim();
    const key=normalize(name);
    if(key){names.add(key);recipeNames.add(key);}
    if(!key || !VALID.has(knownDishCategory(name)))
      unresolved.push({source:'ingredientes',name,category:knownDishCategory(name)});
  }
  for(const [date,day] of Object.entries(history.days)){
    for(const [ru,rest] of Object.entries(day?.restaurants||{})){
      for(const [meal,entry] of Object.entries(rest?.meals||{})){
        for(const item of entry?.items||[]){
          const name=typeof item==='string'?item:String(item?.name||'');
          const key=normalize(name);
          const category=typeof item==='string'?'':String(item?.category||'');
          const sourceType=typeof item==='string'?'':String(item?.sourceType||'');
          const record={name,date,ru,meal,sourceType,original:category};
          historicOccurrences++;
          if(key){names.add(key);historicNames.add(key);}
          if(!VALID.has(category))originalBlanks.push(record);
          if(!byName.has(key))byName.set(key,new Set());
          if(VALID.has(category))byName.get(key).add(category);
          const resolved=publishedCategory(category,name,sourceType);
          if(!key || !VALID.has(resolved))
            unresolved.push({...record,resolved,source:'historico'});
          else {
            counts[resolved]=(counts[resolved]||0)+1;
            if(resolved!==category)changed.push({...record,resolved});
          }
        }
      }
    }
  }
  return {
    recipeCount:catalog.dishes.length,
    historicalOccurrences:historicOccurrences,
    historicalNames:historicNames.size,
    totalNames:names.size,
    namesOnlyInHistory:[...historicNames].filter(name=>!recipeNames.has(name)).length,
    originalBlanks,
    correctedRecords:changed,
    historicalConflicts:[...byName].filter(([key,cats])=>key && cats.size>1)
      .map(([name,cats])=>({name,originalCategories:[...cats]})),
    categoryCounts:counts,
    unresolved
  };
}

export async function auditRegisteredFiles(){
  const [catalog,history]=await Promise.all([
    readFile(new URL('../public/data/pratos-ingredientes.json',import.meta.url),'utf8').then(JSON.parse),
    readFile(new URL('../public/data/cardapios.json',import.meta.url),'utf8').then(JSON.parse)
  ]);
  return auditRegisteredDishes({catalog,history});
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await auditRegisteredFiles();
  console.log('AUDITORIA_CATEGORIAS',JSON.stringify({
    receitas:result.recipeCount,
    registrosHistoricos:result.historicalOccurrences,
    nomesNoHistorico:result.historicalNames,
    nomesDistintos:result.totalNames,
    soNoHistorico:result.namesOnlyInHistory,
    semCategoriaNoOriginal:result.originalBlanks.length,
    registrosResolvidos:result.correctedRecords.length,
    categorias:result.categoryCounts,
    conflitosAntigos:result.historicalConflicts,
    lacunas:result.unresolved
  },null,2));
  if(result.unresolved.length) process.exitCode=1;
}
