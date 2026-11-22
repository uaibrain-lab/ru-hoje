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
import {readFile,stat,readdir,cp,mkdir,rm,rename,lstat} from 'node:fs/promises';
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
  'catalog/arrivals/index.json','catalog/arrivals/calendar.json'
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
    if(!(await stat(path.join(root,p))).isFile())throw Error('EXTERNO_REQUIRED_FILE_INVALID: '+p);
  }
  const html=await readFile(path.join(root,'index.html'),'utf8');
  if(!html.includes('data-app-mode="free-static"'))
    throw Error('EXTERNO_NOT_STATIC_BUILD');
  if(!/id="quick-rotas"[^>]*\bhidden\b[^>]*\bdisabled\b/.test(html))
    throw Error('EXTERNO_V1_ROUTES_MUST_REMAIN_HIDDEN');
  const gps=await json(path.join(root,'gps-config.json'));
  if(gps.enabled!==false)throw Error('EXTERNO_GPS_NOT_APPROVED');
  const manifest=await json(path.join(root,'catalog/manifest.json'));
  if(!validExternoManifest(manifest,day))throw Error('EXTERNO_GTFS_NOT_CURRENT');
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
    if((await stat(path.join(root,'catalog/arrivals',name))).size!==expected)
      throw Error('EXTERNO_ARRIVALS_BUCKET_MISSING_OR_CORRUPT: '+name);
  }
  const {total,files}=await allFiles(root);
  return {gtfsVersion:manifest.gtfsVersion,feedEndDate:manifest.feedEndDate,
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
