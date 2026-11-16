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
  if(pathname==='/config.js') {res.writeHead(200,{'Content-Type':'text/javascript'});res.end('window.RU_CONFIG={firebaseProjectId:"teste-ruhoje",fumpProxyUrl:"https://hub-fump-proxy.hubufmg.workers.dev"};');return;}
  const destination=path.resolve(ROOT,'.'+pathname,(pathname==='/'?'index.html':''));
  if(!destination.startsWith(ROOT+path.sep)) {res.writeHead(403);res.end();return;}
  try {const content=await fs.readFile(destination);res.writeHead(200,{'Content-Type':MIME[path.extname(destination)]||'application/octet-stream'});res.end(content);}
  catch {res.writeHead(404);res.end('Não encontrado');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const p={};for(const x of new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())) p[x.type]=x.value;
const today=`${p.year}-${p.month}-${p.day}`;
const stamp=new Date().toISOString();
const data={
  schemaVersion:1,
  source:'https://fump.ufmg.br/cardapio-do-dia/',
  generatedAt:stamp,
  days:{
    [today]:{
      restaurants:{
        'setorial-i':{
          fetchedAt:stamp,
          meals:{
            cafe:{items:[{name:'Café com leite',category:'bebida'},{name:'Pão de queijo',category:'acompanhamento'}]},
            almoco:{items:[{name:'Arroz Branco',category:'acompanhamento'},{name:'Feijão Carioca',category:'acompanhamento'},{name:'Frango grelhado',category:'proteina'},{name:'Salada de Alface',category:'salada'}]},
            jantar:{items:[{name:'Sopa indevida',category:'guarnicao'}]}
          }
        },
        'setorial-ii':{
          fetchedAt:stamp,
          meals:{
            cafe:{items:[{name:'Café indevido',category:'bebida'}]},
            almoco:{items:[{name:'Arroz II',category:'acompanhamento'},{name:'Feijão II',category:'acompanhamento'},{name:'Proteína II',category:'proteina'}]},
            jantar:{items:[{name:'Sopa II',category:'guarnicao'},{name:'Arroz II noite',category:'acompanhamento'}]}
          }
        }
      }
    }
  }
};
let browser;
try {
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  let interceptedRequests=0;
  let liveEnabled=false;
  const tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86_400_000).toISOString().slice(0,10);
  const relayRequests=[];
  // Testa a rota Cloudflare que é efetivamente usada no Hosting.
  const mockWorker=async route=> {
    const request = new URL(route.request().url());
    const id = request.searchParams.get('id');
    const date = request.searchParams.get('data');
    relayRequests.push({id,date});
    const future=id==='6' && date===tomorrow;
    const activeToday=liveEnabled && id==='6' && date===today;
    const name=future ? 'Frango do Dia Seguinte' : 'Frango ao Vivo';
    const cardapios=(future || activeToday)
      ? [{data:date,refeicoes:[{tipoRefeicao:'Almoço',pratos:[
        {tipoPrato:'Prato protéico 1',descricaoPrato:name},
        {tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz Branco'}
      ]}]}]
      : [];
    await route.fulfill({
      status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},
      body:JSON.stringify({id:Number(id),cardapios})
    });
  };
  await page.route('https://hub-fump-proxy.hubufmg.workers.dev/**',mockWorker);
  await page.route('https://firestore.googleapis.com/**',async route=> {
    interceptedRequests++;
    return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','cache-control':'no-store'},body:JSON.stringify({fields:{payload:{stringValue:JSON.stringify(data)}}})});
  });
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  await page.goto(url,{waitUntil:'networkidle'});
  assert.equal(await page.locator('#restaurant-dialog').evaluate(e=>e.open),true);
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await page.getByText('Frango grelhado',{exact:true}).waitFor({timeout:15000});
  assert.ok(interceptedRequests>=1,'Nenhuma leitura simulada do Firestore foi interceptada');
  assert.equal(await page.locator('.date-card').count(),15);
  assert.equal(await page.locator('.meal-card').count(),2);
  assert.deepEqual(await page.locator('.meal-card h3').allTextContents(),['Almoço','Café da manhã']);
  assert.equal(await page.locator('.meal-card').filter({hasText:'Sopa indevida'}).count(),0);
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('#current-restaurant').innerText(),'RU Setorial I');
  await page.getByText('Frango grelhado',{exact:true}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await page.getByRole('button',{name:'RU Setorial II Campus Pampulha',exact:true}).click();
  await page.getByText('Sopa II',{exact:true}).waitFor({timeout:15000});
  const clockParts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).filter(p=>p.type==='hour'||p.type==='minute').map(p=>[p.type,Number(p.value)]));
  const expectedSetorialIIOrder = (clockParts.hour * 60 + clockParts.minute) >= 870 ? ['Jantar','Almoço'] : ['Almoço','Jantar'];
  assert.deepEqual(await page.locator('.meal-card h3').allTextContents(),expectedSetorialIIOrder);
  assert.equal(await page.locator('.meal-card').filter({hasText:'Café indevido'}).count(),0);
  await page.locator('.date-card').last().click();
  await page.getByText('Ainda sem cardápio por aqui').waitFor();
  // Novos dados reais simulados chegam depois de a cópia Firestore já estar visível.
  liveEnabled = true;
  await page.locator('.date-card').first().click();
  await page.locator('#restaurant-trigger').click();
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.getByText('Frango ao Vivo',{exact:true}).waitFor({timeout:12000});
  assert.match(await page.locator('#update-line').innerText(),/FUMP ao vivo/);
  // A próxima data é consultada em segundo plano sem clique explícito.
  await page.waitForFunction(day=>{
    try {
      const entries=JSON.parse(localStorage.getItem('ruhoje:live-menus:v1')||'{}');
      return entries[day+'|6']?.meals?.almoco?.items?.some(x=>x.name==='Frango do Dia Seguinte');
    }catch{return false;}
  },tomorrow,{timeout:25000});
  assert.ok(relayRequests.some(x=>x.id==='6'&&x.date===tomorrow),
    'Pré-carregamento não buscou o dia seguinte pelo proxy');
  const tomorrowBefore=relayRequests.filter(x=>x.id==='6'&&x.date===tomorrow).length;
  await page.locator('.date-card').nth(1).click();
  await page.getByText('Frango do Dia Seguinte',{exact:true}).waitFor({timeout:12000});
  assert.equal(relayRequests.filter(x=>x.id==='6'&&x.date===tomorrow).length,tomorrowBefore,
    'Clique em data já prefetched não deve duplicar requisição recente');
  assert.deepEqual(errors,[],'Erros de console ou JavaScript durante teste ponta a ponta');

  // Um PWA instalado NÃO pode continuar executando app.js ou config.js
  // inválidos que tenham sido preservados pelo cache anterior ao deploy.
  const pwaPage=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'allow'});
  await pwaPage.route('https://hub-fump-proxy.hubufmg.workers.dev/**',mockWorker);
  await pwaPage.route('https://firestore.googleapis.com/**',async route=>route.fulfill({
    status:200,contentType:'application/json',
    headers:{'Access-Control-Allow-Origin':'*'},
    body:JSON.stringify({fields:{payload:{stringValue:JSON.stringify(data)}}})
  }));
  const pwaErrors=[];
  pwaPage.on('pageerror',err=>pwaErrors.push(err.message));
  await pwaPage.goto(url,{waitUntil:'domcontentloaded'});
  await pwaPage.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:25000});
  await pwaPage.waitForTimeout(700);
  await pwaPage.evaluate(async()=>{
    const c=await caches.open('hub-v267-20261116-prefetch-cache-heal-r1');
    await c.put('/assets/app.js?v=hub-20261116-prefetch-cache-heal-r1',
      new Response('throw new Error("STALE_CACHE_EXECUTED")',{
        headers:{'Content-Type':'text/javascript'}
      }));
    await c.put('/config.js',
      new Response('window.RU_CONFIG={firebaseProjectId:"stale",fumpProxyUrl:""};',{
        headers:{'Content-Type':'text/javascript'}
      }));
  });
  await pwaPage.reload({waitUntil:'domcontentloaded'});
  await pwaPage.waitForFunction(()=>
    window.RU_CONFIG?.fumpProxyUrl==='https://hub-fump-proxy.hubufmg.workers.dev',
    null,{timeout:20000});
  await pwaPage.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await pwaPage.getByText('Frango ao Vivo',{exact:true}).waitFor({timeout:12000});
  assert.deepEqual(pwaErrors,[],'PWA executou JavaScript obsoleto do CacheStorage');
  await pwaPage.close();

  console.log('E2E aprovado: proxy Cloudflare, cache Firestore, prefetch de D+1 e migração do PWA sem limpar cache.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
