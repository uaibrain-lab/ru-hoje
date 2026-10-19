// Teste ponta a ponta do PWA usando dados APENAS em memória (nunca dados de produção).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','public');
const MIME={'.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/config.js') {res.writeHead(200,{'Content-Type':'text/javascript'});res.end('window.RU_CONFIG={firebaseProjectId:"teste-ruhoje"};');return;}
  const destination=path.resolve(ROOT,'.'+pathname,(pathname==='/'?'index.html':''));
  if(!destination.startsWith(ROOT+path.sep)) {res.writeHead(403);res.end();return;}
  try {const content=await fs.readFile(destination);res.writeHead(200,{'Content-Type':MIME[path.extname(destination)]||'application/octet-stream'});res.end(content);}
  catch {res.writeHead(404);res.end('Não encontrado');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const p={};for(const x of new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())) p[x.type]=x.value;
const today=`${p.year}-${p.month}-${p.day}`;
const data={schemaVersion:1,source:'https://fump.ufmg.br/cardapio-do-dia/',generatedAt:new Date().toISOString(),days:{[today]:{restaurants:{'setorial-i':{fetchedAt:new Date().toISOString(),meals:{
  almoco:{items:[{name:'Arroz Branco',category:'acompanhamento'},{name:'Feijão Carioca',category:'acompanhamento'},{name:'Frango grelhado',category:'proteina'},{name:'Salada de Alface',category:'salada'}]},
  jantar:{items:[{name:'Sopa de legumes',category:'guarnicao'},{name:'Arroz integral',category:'acompanhamento'},{name:'Feijão preto',category:'acompanhamento'},{name:'Legumes assados',category:'guarnicao'}]}
}}}}}};
let browser;
try {
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  let interceptedRequests=0;
  await page.route('https://firestore.googleapis.com/**',async route=> {
    interceptedRequests++;
    return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','cache-control':'no-store'},body:JSON.stringify({fields:{payload:{stringValue:JSON.stringify(data)}}})});
  });
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  await page.goto(url,{waitUntil:'networkidle'});
  assert.equal(await page.locator('dialog').evaluate(e=>e.open),true);
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await page.getByText('Frango grelhado',{exact:true}).waitFor({timeout:15000});
  assert.ok(interceptedRequests>=1,'Nenhuma leitura simulada do Firestore foi interceptada');
  assert.equal(await page.locator('.date-card').count(),15);
  assert.equal(await page.locator('.meal-card').count(),2);
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('#current-restaurant').innerText(),'RU Setorial I');
  await page.getByText('Frango grelhado',{exact:true}).waitFor({timeout:15000});
  await page.locator('.date-card').last().click();
  await page.getByText('Ainda sem cardápio por aqui').waitFor();
  assert.deepEqual(errors,[],'Erros de console ou JavaScript durante teste ponta a ponta');
  console.log('E2E aprovado: primeiro acesso, pratos, duas refeições, mudança de data, preferência após reload.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
