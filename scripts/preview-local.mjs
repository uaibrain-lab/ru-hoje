/**
 * Servidor de prévia LOCAL do Hub UFMG (Node 22+).
 *
 * - Reproduz a rota limpa /interno do Firebase Hosting.
 * - Encaminha SOMENTE os endpoints públicos da FUMP via Worker oficial.
 * - Não altera o Worker, não faz deploy e não usa chaves privadas.
 * - Disponível exclusivamente em 127.0.0.1 (não expor na rede).
 *
 * Executar: node scripts/preview-local.mjs [porta]
 */
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const UPSTREAM='https://hub-fump-proxy.hubufmg.workers.dev';
const HOST='127.0.0.1';
const IDS=new Set(['1','2','5','6']);
const MIME={
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.ico':'image/x-icon',
  '.webmanifest':'application/manifest+json',
  '.woff':'font/woff',
  '.woff2':'font/woff2'
};
function send(res,status,body,type='text/plain; charset=utf-8',method='GET',extra={}){
  res.writeHead(status,{
    'Content-Type':type,
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    ...extra
  });
  res.end(method==='HEAD'?undefined:body);
}
function isIso(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||''))return false;
  const date=new Date(iso+'T12:00:00Z');
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===iso;
}
async function relayOfficialApi(url,req,res,fetchFn){
  const isMenu=url.pathname==='/api/menu';
  const isRestaurants=url.pathname==='/api/restaurants';
  if(!isMenu&&!isRestaurants)return false;
  if(req.method!=='GET'&&req.method!=='HEAD'){
    send(res,405,'Somente leitura.','text/plain; charset=utf-8',req.method);
    return true;
  }
  const id=url.searchParams.get('id'),iso=url.searchParams.get('data');
  if((isMenu&&(url.searchParams.size!==2||!IDS.has(id)||!isIso(iso)))||
     (isRestaurants&&url.searchParams.size!==0)){
    send(res,400,'Parâmetros inválidos.','text/plain; charset=utf-8',req.method);
    return true;
  }
  const target=new URL(url.pathname,UPSTREAM);
  if(isMenu){
    target.searchParams.set('id',id);
    target.searchParams.set('data',iso);
  }
  try{
    const response=await fetchFn(target.href,{
      method:'GET',redirect:'error',cache:'no-store',
      headers:{Accept:'application/json'},
      signal:AbortSignal.timeout(12000)
    });
    const body=await response.text();
    if(body.length>2_000_000){
      send(res,502,'Resposta do Worker excedeu o limite.','text/plain; charset=utf-8',req.method);
      return true;
    }
    const headers={};
    for(const name of ['x-menu-fetched-at','x-menu-cache','cf-cache-status']){
      const value=response.headers.get(name);
      if(value)headers[name]=value;
    }
    // Mantém o carimbo original da FUMP; jamais inventar uma data de consulta.
    send(res,response.status,body,response.headers.get('content-type')||'application/json; charset=utf-8',req.method,headers);
  }catch(error){
    console.error('[PREVIEW] Falha ao consultar o Worker:',error?.name||'Error');
    send(res,502,JSON.stringify({error:'WORKER_UNAVAILABLE'}),'application/json; charset=utf-8',req.method);
  }
  return true;
}
export function createPreviewServer({fetchFn=fetch}={}){
  return http.createServer(async(req,res)=>{
    let url;
    try{url=new URL(req.url,'http://127.0.0.1');}
    catch{send(res,400,'URL inválida.');return;}
    if(await relayOfficialApi(url,req,res,fetchFn))return;
    if(req.method!=='GET'&&req.method!=='HEAD'){
      send(res,405,'Somente GET e HEAD.');return;
    }
    // Firebase Hosting usa cleanUrls. O Python http.server não implementa isso.
    if(url.pathname==='/interno/index.html'){
      res.writeHead(302,{Location:'/interno'+url.search,'Cache-Control':'no-store'});
      res.end();return;
    }
    let filePath;
    try{
      const decoded=decodeURIComponent(url.pathname);
      const page=decoded==='/'?'/index.html':
        (decoded==='/interno'||decoded==='/interno/')?'/interno/index.html':decoded;
      filePath=path.resolve(ROOT,'.'+page);
      if(!filePath.startsWith(ROOT+path.sep))throw new Error('Fora da pasta pública');
      const info=await stat(filePath);
      if(!info.isFile())throw new Error('Não é arquivo');
    }catch{
      send(res,404,'Arquivo não encontrado.');return;
    }
    try{
      let body=await readFile(filePath);
      if(url.pathname==='/config.js'){
        // Apenas na resposta local: no repositório, config.js permanece intacto.
        const config=body.toString('utf8');
        body=Buffer.from(config+
          '\n// Proxy local somente para esta prévia, nunca enviado ao Hosting.\n'+
          'window.RU_CONFIG=Object.freeze({...window.RU_CONFIG, fumpProxyUrl: window.location.origin});\n');
      }
      send(res,200,body,MIME[path.extname(filePath)]||'application/octet-stream',req.method);
    }catch{
      send(res,500,'Erro ao carregar o arquivo local.');
    }
  });
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=process.argv[2]===undefined?8080:Number(process.argv[2]);
  if(!Number.isInteger(port)||port<1024||port>65535){
    console.error('Use uma porta entre 1024 e 65535.');
    process.exitCode=1;
  }else{
    const server=createPreviewServer();
    server.on('error',error=>{
      console.error('Não foi possível iniciar a prévia:',error.message);
      process.exitCode=1;
    });
    server.listen(port,HOST,()=>{
      console.log('Hub UFMG — prévia local: http://'+HOST+':'+port);
      console.log('Festas demonstrativas: http://'+HOST+':'+port+'/?aba=festas&festas-demo=1');
      console.log('Use Ctrl+C para encerrar. Nada é publicado em produção.');
    });
  }
}
