/**
 * Stage a locally built Externo BH static package inside Hub UFMG.
 * No network calls, no Firebase deploy, and never commits source ZIPs.
 *
 * Usage:
 *   python scripts/build_static_site.py --output dist  (in Externo repo)
 *   node scripts/stage-externo.mjs /absolute/path/to/dist/externo
 *
 * The Hub stays on a draft branch; promotion requires V1 QA gates separately.
 */
import {readFile,stat,readdir,cp,rm,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {localServiceDay,validExternoManifest} from '../public/assets/onibus.js';

const HUB=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DEST=path.join(HUB,'public','externo');
const MAX_TOTAL=350*1024*1024;
const REQUIRED=[
  'index.html','app.js','style.css','hub-parity.css','static-bus.js',
  'static-arrivals.js','service-worker.js','gps-config.json',
  'catalog/manifest.json','catalog/routes.json','catalog/stops.json',
  'catalog/patterns.json','catalog/shapes.json','catalog/metro.json',
  'catalog/arrivals/index.json','catalog/arrivals/calendar.json',
  'hub-v1-build.json','hub-v1-qa.json'
];

async function json(p){return JSON.parse(await readFile(p,'utf8'));}
async function allFiles(dir){
  let total=0,files=0;
  for(const d of await readdir(dir,{withFileTypes:true})){
    const f=path.join(dir,d.name);
    if(d.isSymbolicLink())throw Error('EXTERNO_SYMLINK_REJECTED');
    if(d.isDirectory()){
      const nested=await allFiles(f);
      total+=nested.total;files+=nested.files;
    }else if(d.isFile()){
      total+=(await stat(f)).size;files++;
    }else throw Error('EXTERNO_NON_FILE_REJECTED');
    if(total>MAX_TOTAL)throw Error('EXTERNO_TOO_LARGE');
  }
  return {total,files};
}

export async function validateExternoPackage(source,day=localServiceDay()){
  const root=path.resolve(source);
  if(!(await stat(root)).isDirectory())throw Error('EXTERNO_SOURCE_NOT_DIRECTORY');
  for(const p of REQUIRED){
    try{if(!(await stat(path.join(root,p))).isFile())throw Error('INVALID');}
    catch{throw Error('EXTERNO_REQUIRED_FILE_INVALID: '+p);}
  }
  const qa=await json(path.join(root,'hub-v1-qa.json'));
  const built=await json(path.join(root,'hub-v1-build.json'));
  if(qa.schema!==1||qa.status!=='passed'||
     qa.scope!=='municipal-bh-and-metro'||
     !/^[0-9a-f]{64}$/.test(qa.sourceSha256||'')||
     qa.gtfsVersion!==built.gtfsVersion||
     qa.validThrough!==built.validThrough||
     qa.routingEnabled!==false||qa.metropolitanEnabled!==false||
     qa.gpsEnabled!==true||qa.gpsProvider!=='gtfs_rt'||
     qa.gpsProbePassed!==true||
     !Number.isInteger(qa.gpsRecentPositionsObserved)||
     qa.gpsRecentPositionsObserved<1||
     !qa.gpsProbeCheckedAtUtc||
     qa.shards!==256||built.shards!==256||
     !/^[0-9]{8}$/.test(qa.validatedServiceDate||''))
    throw Error('EXTERNO_V1_QA_NOT_APPROVED');
  const html=await readFile(path.join(root,'index.html'),'utf8');
  if(!html.includes('data-app-mode="free-static"'))
    throw Error('EXTERNO_NOT_STATIC_BUILD');
  if(!/id="quick-rotas"[^>]*\bhidden\b[^>]*\bdisabled\b/.test(html))
    throw Error('EXTERNO_V1_ROUTES_MUST_REMAIN_HIDDEN');
  const gps=await json(path.join(root,'gps-config.json'));
  if(gps.enabled!==true||gps.provider!=='gtfs_rt'||
     gps.endpoint!=='https://externo-bh-gps-free.hubufmg.workers.dev/api/gps')
    throw Error('EXTERNO_V1_LIVE_GPS_REQUIRED');
  const manifest=await json(path.join(root,'catalog/manifest.json'));
  if(!validExternoManifest(manifest,day))throw Error('EXTERNO_GTFS_NOT_CURRENT');
  if(qa.gtfsVersion!==manifest.gtfsVersion||
     qa.validThrough!==manifest.feedEndDate||
     qa.routes!==manifest.routes||
     qa.scheduledStops!==built.scheduledStops||
     qa.validatedServiceDate>day)
    throw Error('EXTERNO_V1_QA_MANIFEST_MISMATCH');
  const index=await json(path.join(root,'catalog/arrivals/index.json'));
  if(index.schema!==1 || index.buckets!==256 ||
     index.version!==manifest.gtfsVersion ||
     index.validThrough!==manifest.feedEndDate ||
     !Number.isInteger(index.stopCount) || index.stopCount>manifest.stops ||
     !index.sizes || Object.keys(index.sizes).length!==256)
     throw Error('EXTERNO_ARRIVALS_INDEX_MISMATCH');
  for(let i=0;i<256;i++){
    const name=i.toString(16).padStart(2,'0')+'.json.gz';
    const expected=index.sizes[name];
    if(!Number.isInteger(expected)||expected<=0||expected>4*1024*1024)
      throw Error('EXTERNO_ARRIVALS_BUCKET_BAD_SIZE: '+name);
    try{
      if((await stat(path.join(root,'catalog/arrivals',name))).size!==expected)
        throw Error('INVALID_BUCKET');
    }catch{throw Error('EXTERNO_ARRIVALS_BUCKET_MISSING_OR_CORRUPT: '+name);}
  }
  // ETA via GTFS-RT só pode ser ativado com a mesma versão do GTFS estático.
  // Pacotes V1 antigos sem índice continuam utilizáveis, com horários de tabela.
  if(qa.rtTripIndexSchema!==undefined){
    if(qa.rtTripIndexSchema!==1||!Number.isInteger(qa.rtTripIndexRows)||
       qa.rtTripIndexRows<1000||qa.rtTripIndexRows>manifest.stopTimeRows)
      throw Error('EXTERNO_RT_TRIP_QA_INVALID');
    const rt=await json(path.join(root,'catalog/rt-trips/index.json'));
    if(rt.schema!==1||rt.buckets!==256||rt.version!==manifest.gtfsVersion||
       rt.validThrough!==manifest.feedEndDate||rt.rows!==qa.rtTripIndexRows||
       !rt.sizes||Object.keys(rt.sizes).length!==256)
      throw Error('EXTERNO_RT_TRIP_INDEX_VERSION_MISMATCH');
    for(let n=0;n<256;n++){
      const file=n.toString(16).padStart(2,'0')+'.json.gz';
      const size=rt.sizes[file];
      if(!Number.isInteger(size)||size<10||size>4*1024*1024)
        throw Error('EXTERNO_RT_TRIP_SHARD_BAD_SIZE: '+file);
      if((await stat(path.join(root,'catalog/rt-trips',file))).size!==size)
        throw Error('EXTERNO_RT_TRIP_SHARD_MISSING: '+file);
    }
  }
  if(built.routingEnabled!==false||built.metropolitanEnabled!==false||built.gpsEnabled!==true)
    throw Error('EXTERNO_V1_DEFERRED_FEATURES_ENABLED');
  const {total,files}=await allFiles(root);
  return {sourceSha256:qa.sourceSha256,qaDate:qa.validatedServiceDate,
    gpsEnabled:true,gpsRecentPositionsObserved:qa.gpsRecentPositionsObserved,
    gtfsVersion:manifest.gtfsVersion,feedEndDate:manifest.feedEndDate,
    routes:manifest.routes,stops:manifest.stops,scheduledStops:index.stopCount,
    bytes:total,files};
}

export async function stageExterno(source,day=localServiceDay()){
  const from=path.resolve(source);
  if(from===DEST || DEST.startsWith(from+path.sep) || from.startsWith(DEST+path.sep))
    throw Error('EXTERNO_SOURCE_DESTINATION_OVERLAP');
  const report=await validateExternoPackage(from,day);
  const temp=DEST+'.next-'+process.pid;
  const backup=DEST+'.previous-'+process.pid;
  await rm(temp,{recursive:true,force:true});
  await rm(backup,{recursive:true,force:true});
  let oldMoved=false;
  try{
    await cp(from,temp,{recursive:true,errorOnExist:true,force:false});
    await validateExternoPackage(temp,day);
    try{await rename(DEST,backup);oldMoved=true;}
    catch(error){if(error.code!=='ENOENT')throw error;}
    try{await rename(temp,DEST);}
    catch(error){
      if(oldMoved)await rename(backup,DEST);
      oldMoved=false;
      throw error;
    }
    if(oldMoved)await rm(backup,{recursive:true,force:true});
    return report;
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const source=process.argv[2];
  if(!source){
    console.error('Uso: node scripts/stage-externo.mjs /caminho/dist/externo');
    process.exitCode=2;
  }else{
    try{
      const result=await stageExterno(source);
      console.log('EXTERNO_STAGED_FOR_LOCAL_QA',JSON.stringify(result));
      console.log('NOT_DEPLOYED — execute o gate GTFS completo antes de aprovar o PR.');
    }catch(error){
      console.error('EXTERNO_STAGE_BLOCKED',error?.message||'erro');
      process.exitCode=2;
    }
  }
}
