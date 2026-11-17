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
  // Reproduz o redirect de cleanUrls do Firebase Hosting.
  if(pathname==='/interno/index.html') {
    res.writeHead(301,{Location:'/interno'});
    res.end();
    return;
  }
  if(pathname==='/config.js') {res.writeHead(200,{'Content-Type':'text/javascript'});res.end('window.RU_CONFIG={firebaseProjectId:"teste-ruhoje",fumpProxyUrl:"https://hub-fump-proxy.hubufmg.workers.dev"};');return;}
  const destination=path.resolve(ROOT,'.'+(pathname==='/interno'?'/interno/index.html':pathname),(pathname==='/'?'index.html':''));
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
  let failOfficialToday=false;
  const tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86_400_000).toISOString().slice(0,10);
  const relayRequests=[];
  // Testa a rota Cloudflare que é efetivamente usada no Hosting.
  const mockWorker=async route=> {
    const request = new URL(route.request().url());
    const id = request.searchParams.get('id');
    const date = request.searchParams.get('data');
    relayRequests.push({id,date});
    if (id==='6' && date===today && failOfficialToday) {
      return route.fulfill({
        status:503,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},
        body:'{"error":"UPSTREAM_CONNECT_FAILED"}'
      });
    }
    const future=id==='6' && date===tomorrow;
    const activeToday=liveEnabled && id==='6' && date===today;
    const name=future ? 'Frango do Dia Seguinte' : 'Frango ao Vivo';
    const cardapios=(future || activeToday)
      ? [{data:date,refeicoes:[{tipoRefeicao:'Almoço',pratos:[
        {tipoPrato:'Prato protéico 1',descricaoPrato:name},
        {tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz Branco'}
      ]}]}]
      : id==='6' && date===today && !liveEnabled
      ? [{data:date,refeicoes:[
        {tipoRefeicao:'Almoço',pratos:[{tipoPrato:'Prato protéico 1',descricaoPrato:'Frango grelhado'},{tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz Branco'}]},
        {tipoRefeicao:'Café da manhã',pratos:[{tipoPrato:'Bebidas',descricaoPrato:'Café com leite'}]}
      ]}]
      : id==='1' && date===today
      ? [{data:date,refeicoes:[
        {tipoRefeicao:'Almoço',pratos:[{tipoPrato:'Prato protéico 1',descricaoPrato:'Proteína II'}]},
        {tipoRefeicao:'Jantar',pratos:[{tipoPrato:'Prato protéico 1',descricaoPrato:'Sopa II'}]}
      ]}] : [];
    await route.fulfill({
      status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},
      body:JSON.stringify({id:Number(id),cardapios})
    });
  };
  await page.route('https://hub-fump-proxy.hubufmg.workers.dev/**',mockWorker);
  await page.route('https://firestore.googleapis.com/**',async route=> {
    if (route.request().url().includes('/publicMenus/current')) interceptedRequests++;
    return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','cache-control':'no-store'},body:JSON.stringify({fields:{payload:{stringValue:JSON.stringify(data)}}})});
  });
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  await page.goto(url,{waitUntil:'networkidle'});
  assert.equal(await page.locator('#restaurant-dialog').evaluate(e=>e.open),true);
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await page.getByText('Frango grelhado',{exact:true}).waitFor({timeout:15000});
  assert.equal(interceptedRequests,0,'Aplicativo não pode consultar snapshot Firestore');
  assert.equal(await page.locator('.date-card').count(),15);
  // O indicador deve representar atendimento REGULAR, não cardápio publicado.
  const dotSchedule=await page.locator('.date-card').evaluateAll(cards=>cards.map(card=>({
    date:card.dataset.iso, noService:card.dataset.noRegularService
  })));
  assert.ok(dotSchedule.some(({date})=>new Date(date+'T12:00:00Z').getUTCDay()===0));
  for(const {date,noService} of dotSchedule) {
    const weekday=new Date(date+'T12:00:00Z').getUTCDay();
    assert.equal(noService,String(weekday===0),'Setorial I: apenas domingo tem bolinha');
  }
  assert.equal(await page.locator('.date-card[data-missing-menu]').count(),0,
    'Atributo legado de ausência de cardápio não deve continuar no calendário');
  assert.equal(await page.locator('.meal-card').count(),2);
  assert.deepEqual(await page.locator('.meal-card h3').allTextContents(),['Almoço','Café da manhã']);
  assert.equal(await page.locator('.meal-card').filter({hasText:'Sopa indevida'}).count(),0);
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.locator('#current-restaurant').innerText(),'RU Setorial I');
  await page.getByText('Frango grelhado',{exact:true}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await page.getByRole('button',{name:'RU Setorial II Campus Pampulha',exact:true}).click();
  await page.getByText('Sopa II',{exact:true}).waitFor({timeout:15000});
  const setorialII=await page.locator('.date-card').evaluateAll(cards=>cards.map(card=>({
    date:card.dataset.iso,noService:card.dataset.noRegularService
  })));
  for(const {date,noService} of setorialII) {
    const weekday=new Date(date+'T12:00:00Z').getUTCDay();
    assert.equal(noService,String(weekday===0||weekday===6),
      'Setorial II: sábado e domingo têm bolinha');
  }
  const clockParts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()).filter(p=>p.type==='hour'||p.type==='minute').map(p=>[p.type,Number(p.value)]));
  const expectedSetorialIIOrder = (clockParts.hour * 60 + clockParts.minute) >= 870 ? ['Jantar','Almoço'] : ['Almoço','Jantar'];
  assert.deepEqual(await page.locator('.meal-card h3').allTextContents(),expectedSetorialIIOrder);
  assert.equal(await page.locator('.meal-card').filter({hasText:'Café indevido'}).count(),0);
  await page.locator('.date-card').last().click();
  await page.getByText('Ainda sem cardápio por aqui').waitFor();
  // O endpoint técnico JSON da FUMP não é oferecido como link ao visitante.
  assert.equal(await page.getByRole('link',{name:/Abrir resposta oficial deste RU\/data/i}).count(),0);
  assert.equal(await page.locator('.no-menu a[href*=":3003/"]').count(),0);

  // Mudança oficial de última hora deve substituir a resposta anterior sem snapshots.
  liveEnabled = true;
  await page.locator('.date-card').first().click();
  await page.locator('#restaurant-trigger').click();
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.getByText('Frango ao Vivo',{exact:true}).waitFor({timeout:12000});
  assert.match(await page.locator('#update-line').innerText(),/FUMP oficial/);
  // A próxima data é consultada em segundo plano sem clique explícito.
  // Pré-carregamento agora vive somente em memória, jamais em localStorage.
  for (let attempt=0;attempt<60 && !relayRequests.some(x=>x.id==='6'&&x.date===tomorrow);attempt++) {
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>localStorage.getItem('ruhoje:live-menus:v1')),null);
  assert.ok(relayRequests.some(x=>x.id==='6'&&x.date===tomorrow),
    'Pré-carregamento não buscou o dia seguinte pelo proxy');
  const tomorrowBefore=relayRequests.filter(x=>x.id==='6'&&x.date===tomorrow).length;
  await page.locator('.date-card').nth(1).click();
  await page.getByText('Frango do Dia Seguinte',{exact:true}).waitFor({timeout:12000});
  assert.equal(relayRequests.filter(x=>x.id==='6'&&x.date===tomorrow).length,tomorrowBefore,
    'Clique em data já prefetched não deve duplicar requisição recente');
  // A FUMP pode alterar o cardápio ou ficar indisponível depois de um
  // resultado válido: jamais reaproveitar o prato anterior como se fosse atual.
  await page.locator('.date-card').first().click();
  await page.getByText('Frango ao Vivo',{exact:true}).waitFor({timeout:12000});
  failOfficialToday=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.getByText('Ainda sem cardápio por aqui').waitFor({timeout:17000});
  assert.equal(await page.getByText('Frango ao Vivo',{exact:true}).count(),0);
  assert.match(await page.locator('#connection-notice').innerText(),/Não foi possível consultar a FUMP/);
  failOfficialToday=false;
  assert.deepEqual(errors.filter(error=>!/^Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)$/.test(error)),[],
    'Erros inesperados de JavaScript; HTTP 503 foi simulado deliberadamente');


  // Regressão realista: o cardápio de hoje tem HTTP 503, mas as próximas
  // datas já estão publicadas. O visitante NÃO clica em nenhuma data futura.
  // Um erro pontual no D+2 também não pode impedir que o D+3 seja coletado.
  const passive=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  await passive.addInitScript(stale=>{
    localStorage.setItem('ruhoje:restaurant:v1','setorial-i');
    localStorage.setItem('ruhoje:menus:v1',JSON.stringify(stale));
    localStorage.setItem('ruhoje:live-menus:v1',JSON.stringify({
      [Object.keys(stale.days)[0]+'|6']:{
        iso:Object.keys(stale.days)[0],sourceRestaurantId:'6',
        fetchedAt:new Date().toISOString(),
        meals:{almoco:{items:[{name:'Prato antigo e indevido'}]}}
      }
    }));
  },data);
  const day3=new Date(Date.parse(today+'T12:00:00Z')+3*86_400_000).toISOString().slice(0,10);
  const failedTomorrowPlusOne=new Date(Date.parse(today+'T12:00:00Z')+2*86_400_000).toISOString().slice(0,10);
  const observed=[];
  await passive.route('https://hub-fump-proxy.hubufmg.workers.dev/**',async route=>{
    const u=new URL(route.request().url());
    const date=u.searchParams.get('data');
    const id=u.searchParams.get('id');
    observed.push({date,id});
    if(id==='6' && (date===today || date===failedTomorrowPlusOne)) {
      return route.fulfill({status:503,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},
        body:'{"error":"UPSTREAM_CONNECT_FAILED"}'});
    }
    const published=id==='6' && (date===tomorrow || date===day3);
    const cardapios=published ? [{
      data:date,
      refeicoes:[{tipoRefeicao:'Almoço',pratos:[
        {tipoPrato:'Prato protéico 1',descricaoPrato:'Cardápio Pré-Carregado '+date},
        {tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz'}
      ]}]
    }] : [];
    return route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*'},
      body:JSON.stringify({id:Number(id),cardapios})});
  });
  await passive.route('https://firestore.googleapis.com/**',async route=>route.fulfill({
    status:200,contentType:'application/json',
    headers:{'Access-Control-Allow-Origin':'*'},
    body:JSON.stringify({fields:{payload:{stringValue:JSON.stringify(data)}}})
  }));
  const passiveErrors=[];
  passive.on('pageerror',e=>passiveErrors.push(e.message));
  await passive.goto(url,{waitUntil:'domcontentloaded'});
  await passive.getByText('Ainda sem cardápio por aqui').waitFor({timeout:15000});
  await passive.waitForTimeout(250);
  assert.equal(await passive.getByText('Prato antigo e indevido',{exact:true}).count(),0);
  assert.equal(await passive.getByText('Frango grelhado',{exact:true}).count(),0);
  assert.equal(await passive.evaluate(()=>localStorage.getItem('ruhoje:menus:v1')),null);
  assert.equal(await passive.evaluate(()=>localStorage.getItem('ruhoje:live-menus:v1')),null);
  for (let attempt=0;attempt<95 && !observed.some(x=>x.id==='6'&&x.date===day3);attempt++) {
    await passive.waitForTimeout(350);
  }
  await passive.waitForTimeout(350);
  assert.equal(await passive.evaluate(()=>localStorage.getItem('ruhoje:live-menus:v1')),null);
  assert.ok(observed.some(x=>x.id==='6' && x.date===today),
    'O teste deve simular falha da consulta do dia selecionado');
  assert.ok(observed.some(x=>x.id==='6' && x.date===tomorrow),
    'O aplicativo não consultou D+1 sem clique');
  assert.ok(observed.some(x=>x.id==='6' && x.date===failedTomorrowPlusOne),
    'O teste deve simular erro na primeira sequência de pré-busca');
  assert.ok(observed.some(x=>x.id==='6' && x.date===day3),
    'Falha pontual bloqueou D+3');
  // Mesmo sob HTTP 503, somente domingo indica falta de atendimento regular.
  // Setorial I funciona de segunda a sábado.
  const expectedNoService=new Date(failedTomorrowPlusOne+'T12:00:00Z').getUTCDay()===0;
  assert.equal(await passive.locator('.date-card[data-iso="'+failedTomorrowPlusOne+'"]').getAttribute('data-no-regular-service'),String(expectedNoService));
  assert.deepEqual(passiveErrors,[],'Exceção JS no pré-carregamento sem cliques');
  await passive.close();
  // Pré-carregamento da FUMP e bolinhas por horário são independentes.

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
    const c=await caches.open('hub-v276-20261117-fresh-menus-r1');
    await c.put('/assets/app.js?v=hub-20261117-fresh-menus-r1',
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

  // Regressão PWA: iframe do Interno com SW controlando a navegação.
  const busContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});
  // O cenário testa o mapa (não o modal inicial do RU); pré-selecionar RU
  // impede que um diálogo aberto após DOMContentLoaded bloqueie a aba Interno.
  await busContext.addInitScript(()=>{
    try{localStorage.setItem('ruhoje:restaurant:v1','setorial-i');}catch{}
  });
  const busPage=await busContext.newPage();
  try{
    await busPage.goto(url,{waitUntil:'domcontentloaded'});
    await busPage.evaluate(()=>document.getElementById('restaurant-dialog')?.close());
    await busPage.locator('#tab-interno').click();
    const bus=busPage.frameLocator('#interno-frame');
    await bus.locator('#sheet').waitFor({timeout:20000});
    // Todos os 49 pontos, inclusive Escola de Música (Ida), são iguais.
    const stopMarkers=bus.locator('path.interno-stop');
    await stopMarkers.first().waitFor({timeout:20000});
    assert.equal(await stopMarkers.count(),49,'Todas as 49 paradas têm o mesmo estilo');
    const styles=await stopMarkers.evaluateAll(nodes=>nodes.map(node=>({
      fill:node.getAttribute('fill'),
      stroke:node.getAttribute('stroke'),
      width:node.getAttribute('stroke-width')
    })));
    assert.deepEqual([...new Set(styles.map(x=>JSON.stringify(x)))],
      [JSON.stringify({fill:'#ffffff',stroke:'#334155',width:'2.5'})],
      'Os marcadores não podem ter aro azul nem variar o contorno');
    assert.match(await bus.locator('body').evaluate(()=>document.title),/Interno/);
    await busPage.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:20000});
    await busPage.reload({waitUntil:'domcontentloaded'});
    await busPage.evaluate(()=>document.getElementById('restaurant-dialog')?.close());
    await busPage.locator('#tab-interno').click();
    await bus.locator('#sheet').waitFor({timeout:20000});
    assert.equal(await bus.locator('body').evaluate(()=>location.pathname),'/interno');
    // Links ainda armazenados em HTML antigo também devem abrir o mapa.
    await busPage.locator('#interno-frame').evaluate(frame=>{
      frame.src='/interno/index.html?legacy=1';
    });
    await bus.locator('#sheet').waitFor({timeout:20000});
    assert.match(await bus.locator('body').evaluate(()=>document.title),/Interno/);
    assert.match(await bus.locator('body').innerText(),/Pontos|Linhas|Ponto perto de mim/);
    // Se ficar offline, o shell canônico já foi armazenado na instalação do SW.
    await busContext.setOffline(true);
    await busPage.locator('#interno-frame').evaluate(frame=>{
      frame.src='/interno/index.html?offline=1';
    });
    await bus.locator('#sheet').waitFor({timeout:20000});
    assert.match(await bus.locator('body').evaluate(()=>document.title),/Interno/);
  }finally{
    await busContext.close();
  }
  console.log('E2E Interno aprovado: mapa canônico, SW ativo, rota antiga e contingência offline.');

  console.log('E2E aprovado: FUMP como fonte única, ausência de Firestore/localStorage antigo, prefetch D+1 e migração PWA.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
