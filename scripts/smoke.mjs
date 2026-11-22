// Teste ponta a ponta do PWA usando dados APENAS em memória (nunca dados de produção).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {isNonOperatingDay} from '../public/assets/date-availability.js';
import {createPreviewServer} from './preview-local.mjs';
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
  const futureOpen=Array.from({length:5},(_,i)=>{
    return new Date(Date.parse(today+'T12:00:00Z')+(i+1)*86_400_000).toISOString().slice(0,10);
  }).filter(day=>!isNonOperatingDay(day,'setorial-i')).slice(0,3);
  assert.equal(futureOpen.length,3,'Teste requer três dias futuros de atendimento dentro de cinco dias');
  const tomorrow=futureOpen[0]; // Primeira data futura COM atendimento.
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
      headers:{
        'Access-Control-Allow-Origin':'*',
        'Access-Control-Expose-Headers':'X-Menu-Fetched-At, CF-Cache-Status',
        'X-Menu-Fetched-At':new Date().toISOString(),
        'Cache-Control':'no-store'
      },
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
  assert.equal(await page.locator('.meal-card').count(),1);
  assert.deepEqual(await page.locator('.meal-card h3').allTextContents(),['Almoço']);
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
  // A última data do calendário cai ocasionalmente no fim de semana:
  // não confundir "sem atendimento regular" com "cardápio não divulgado".
  const lastCard=page.locator('.date-card').last();
  const noRegularService=await lastCard.getAttribute('data-no-regular-service');
  await lastCard.click();
  await page.getByText(noRegularService==='true'
    ? 'Sem atendimento regular previsto'
    : 'Cardápio ainda não divulgado').waitFor();
  // O endpoint técnico JSON da FUMP não é oferecido como link ao visitante.
  assert.equal(await page.getByRole('link',{name:/Abrir resposta oficial deste RU\/data/i}).count(),0);
  assert.equal(await page.locator('.no-menu a[href*=":3003/"]').count(),0);

  // O relógio de teste avança 31s para ultrapassar o limite de clique,
  // sem aguardar o tempo real nem abrir uma exceção no rate-limit de produção.
  await page.evaluate(()=>{
    window.__realDateNow=Date.now;
    Date.now=()=>window.__realDateNow()+31_000;
  });
  // Mudança oficial de última hora deve substituir a resposta anterior sem snapshots.
  liveEnabled = true;
  await page.locator('.date-card').first().click();
  await page.locator('#restaurant-trigger').click();
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.getByText('Frango ao Vivo',{exact:true}).waitFor({timeout:12000});
  await page.evaluate(()=>{
    Date.now=window.__realDateNow;
    delete window.__realDateNow;
  });
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
  const firstOpenOffset=Math.round((Date.parse(tomorrow+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86_400_000);
  await page.locator('.date-card').nth(firstOpenOffset).click();
  await page.getByText('Frango do Dia Seguinte',{exact:true}).waitFor({timeout:12000});
  assert.equal(relayRequests.filter(x=>x.id==='6'&&x.date===tomorrow).length,tomorrowBefore,
    'Clique em data já prefetched não deve duplicar requisição recente');
  // A FUMP pode alterar o cardápio ou ficar indisponível depois de um
  // resultado válido: jamais reaproveitar o prato anterior como se fosse atual.
  await page.locator('.date-card').first().click();
  await page.getByText('Frango ao Vivo',{exact:true}).waitFor({timeout:12000});
  failOfficialToday=true;
  // Avançar somente o relógio do cooldown da página no E2E, sem aguardar 30s.
  // A data oficial da resposta continua vindo da API simulada.
  await page.evaluate(()=>{
    window.__realDateNow=Date.now;
    // A consulta anterior foi feita com relógio +31s. +65s garante
    // novo intervalo de pelo menos 30s antes do 503 simulado.
    Date.now=()=>window.__realDateNow()+65_000;
    window.dispatchEvent(new Event('online'));
  });
  await page.getByText('Consulta indisponível').waitFor({timeout:17000});
  await page.evaluate(()=>{
    Date.now=window.__realDateNow;
    delete window.__realDateNow;
  });
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
    // addInitScript runs inside same-origin transport iframes too. Restrict
    // stale-menu fixture to the top page; otherwise a late /interno iframe
    // can recreate deleted legacy keys after app.js has already migrated.
    if(window.top!==window)return;
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
  const day3=futureOpen[2];
  const failedTomorrowPlusOne=futureOpen[1];
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
  await passive.getByText('Consulta indisponível').waitFor({timeout:15000});
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
  // Não marcamos ausência de serviço em dias em que o RU funciona, mesmo
  // quando a resposta oficial é 503.
  const expectedNoService=false;
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
    const c=await caches.open('hub-v277-20261117-batch3-5-r1');
    await c.put('/assets/app.js?v=hub-20261117-batch3-5-r1',
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
  // O CI não consulta tiles públicos do OSM. Simula falha do mapa-base sem
  // impedir os 49 pontos vetoriais, itinerários, horários e uso offline.
  await busPage.route('https://tile.openstreetmap.org/**',route=>route.abort());
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
    assert.match(await bus.locator('body').evaluate(()=>document.title),/Ônibus/);
    await busPage.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:20000});
    await busPage.reload({waitUntil:'domcontentloaded'});
    await busPage.evaluate(()=>document.getElementById('restaurant-dialog')?.close());
    await busPage.locator('#tab-interno').click();
    await bus.locator('#sheet').waitFor({timeout:20000});
    assert.equal(await bus.locator('body').evaluate(()=>location.pathname),'/interno');
    // Links antigos redirecionam. Não inspecionar o iframe enquanto o
    // documento anterior está sendo destruído: guardar sua identidade e
    // exigir um documento NOVO, completamente carregado, na rota canônica.
    await busPage.evaluate(()=>{
      const frame=document.getElementById('interno-frame');
      window.__previousInternoDoc=frame.contentDocument;
      frame.src='/interno/index.html?legacy=1';
    });
    await busPage.waitForFunction(()=>{
      const frame=document.getElementById('interno-frame');
      try {
        const doc=frame?.contentDocument;
        return doc && doc!==window.__previousInternoDoc &&
          doc.readyState==='complete' && !!doc.querySelector('#sheet') &&
          /Ônibus/.test(doc.title) &&
          frame.contentWindow.location.pathname==='/interno';
      }catch{return false;}
    },null,{timeout:20000});
    await busPage.evaluate(()=>delete window.__previousInternoDoc);
    assert.match(await bus.locator('body').innerText(),/Pontos|Linhas|Ponto perto de mim/);
    // Se ficar offline, o shell canônico já foi armazenado na instalação do SW.
    await busContext.setOffline(true);
    await busPage.evaluate(()=>{
      const frame=document.getElementById('interno-frame');
      // Sem comparar a identidade, a espera pode passar no iframe ANTIGO
      // ainda pronto, antes da nova navegação offline realmente começar.
      window.__beforeOfflineDoc=frame?.contentDocument;
      frame.src='/interno/index.html?offline=1';
    });
    await busPage.waitForFunction(()=>{
      const frame=document.getElementById('interno-frame');
      try{
        const doc=frame?.contentDocument;
        return doc && doc!==window.__beforeOfflineDoc &&
          doc.readyState==='complete' && !!doc.querySelector('#sheet') &&
          /Ônibus/.test(doc.title) &&
          frame.contentWindow.location.pathname==='/interno' &&
          frame.contentWindow.L?.version==='1.9.4' &&
          doc.querySelectorAll('path.interno-stop').length===49 &&
          /Mapa-base indisponível/.test(
            doc.getElementById('map-basemap-notice')?.textContent||'');
      }catch{return false;}
    },null,{timeout:20000});
    await busPage.evaluate(()=>delete window.__beforeOfflineDoc);
    const offlineMap=await busPage.evaluate(()=>{
      const frame=document.getElementById('interno-frame');
      const doc=frame?.contentDocument;
      return {leaflet:frame?.contentWindow?.L?.version,
        stops:doc?.querySelectorAll('path.interno-stop').length,
        notice:doc?.getElementById('map-basemap-notice')?.textContent};
    });
    assert.equal(offlineMap.leaflet,'1.9.4','Leaflet precisa vir do PWA local, sem CDN');
    assert.equal(offlineMap.stops,49,'Mapa offline deve preservar as 49 paradas vetoriais');
    assert.match(offlineMap.notice,/Mapa-base indisponível/);
  }finally{
    await busContext.close();
  }
  // Regressão mobile-first: festa em tela pequena, abas no histórico e busca do Interno.
  // A demonstração usa dados locais, sem depender de contas ou eventos reais.
  const mobileContext=await browser.newContext({serviceWorkers:'block'});
  await mobileContext.addInitScript(()=>{
    try{localStorage.setItem('ruhoje:restaurant:v1','setorial-i');}catch{}
  });
  try{
    for(const width of [375,390,412]){
      const mobile=await mobileContext.newPage();
      await mobile.setViewportSize({width,height:812});
      let menuRequests=0;
      await mobile.route('https://hub-fump-proxy.hubufmg.workers.dev/**',route=>{menuRequests++;return route.fulfill({
        status:200,contentType:'application/json',body:'{"id":6,"cardapios":[]}'
      });});
      await mobile.route('https://tile.openstreetmap.org/**',route=>route.abort());
      await mobile.goto(url+'?festas-demo=1&aba=festas',{waitUntil:'domcontentloaded'});
      await mobile.locator('.festas-page .festa-card--compact').waitFor({state:'visible'});
      assert.equal(await mobile.locator('#festas-heading').isVisible(),true,
        'Festas precisa de um título visível');
      const festivalHeader=await mobile.locator('#festas-heading').evaluate(node=>{
        const rect=node.getBoundingClientRect(),card=document.querySelector('.festa-card--compact').getBoundingClientRect();
        return {left:rect.left,right:rect.right,bottom:rect.bottom,cardTop:card.top};
      });
      assert.ok(festivalHeader.bottom+10<=festivalHeader.cardTop,
        'Respiro entre título e eventos insuficiente: '+JSON.stringify(festivalHeader));
      if(width===390){
        await fs.mkdir(path.resolve(ROOT,'../qa-results/menu-compact'),{recursive:true});
        await mobile.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/alltabs-festas-390.png')});
      }
      assert.equal(menuRequests,0,'Festas não deve disparar consultas de cardápio no primeiro acesso');
      const layout=await mobile.evaluate(()=>{
        const card=document.querySelector('.festas-page .festa-card--compact');
        const action=card?.querySelector('.festa-action');
        const title=card?.querySelector('.festa-card-title');
        return {
          viewport:window.innerWidth,
          documentWidth:document.documentElement.scrollWidth,
          cardRight:card?.getBoundingClientRect().right,
          actionHeight:action?.getBoundingClientRect().height,
          labelSize:parseFloat(getComputedStyle(action.querySelector('.festa-action-label')).fontSize),
          titleSize:parseFloat(getComputedStyle(title).fontSize)
        };
      });
      assert.ok(layout.documentWidth<=width+1,`Rolagem horizontal em ${width}px: ${JSON.stringify(layout)}`);
      assert.ok(layout.cardRight<=width+1,`Card de Festas ultrapassa viewport de ${width}px`);
      assert.ok(layout.actionHeight>=43.9,`Ação pequena em ${width}px: ${layout.actionHeight}px`);
      assert.ok(layout.labelSize>=12,`Legenda pequena em ${width}px: ${layout.labelSize}px`);
      assert.ok(layout.titleSize>=16,`Título pequeno em ${width}px: ${layout.titleSize}px`);
      await mobile.locator('#tab-sobre').click();
      assert.equal(new URL(mobile.url()).searchParams.get('aba'),'sobre');
      await mobile.mouse.move(1,1);
      const activeNav=await mobile.locator('#bandeco-navigation button[id^="tab-"]').evaluateAll(
        nodes=>nodes.filter(n=>n.getAttribute('aria-current')==='page').map(n=>n.id));
      assert.deepEqual(activeNav,['tab-sobre'],
        'Navegação precisa destacar somente a aba realmente visível');
      assert.equal(await mobile.locator('.sobre-topic').count(),3,
        'Sobre precisa de três regiões distintas');
      const aboutLayout=await mobile.evaluate(()=>{
        const sections=[...document.querySelectorAll('.sobre-topic')];
        return {width:document.documentElement.scrollWidth,
          gaps:sections.slice(1).map((n,i)=>n.getBoundingClientRect().top-
            sections[i].getBoundingClientRect().bottom),
          textSize:parseFloat(getComputedStyle(sections[0].querySelector('p')).fontSize)};
      });
      assert.ok(aboutLayout.width<=width+1,'Rolagem horizontal Sobre: '+JSON.stringify(aboutLayout));
      assert.ok(aboutLayout.gaps.every(g=>g>=12),'Seções Sobre amontoadas: '+JSON.stringify(aboutLayout));
      assert.ok(aboutLayout.textSize>=14,'Texto Sobre pequeno: '+JSON.stringify(aboutLayout));
      if(width===390){
        await mobile.waitForTimeout(230); // aguardar transição visual da barra inferior
        await mobile.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/alltabs-sobre-390.png')});
      }
      await mobile.goBack();
      await mobile.waitForFunction(()=>
        document.querySelector('#tab-festas')?.getAttribute('aria-current')==='page');
      await mobile.locator('#tab-interno').click();
      const bus=mobile.frameLocator('#interno-frame');
      await bus.locator('#q').waitFor({state:'visible',timeout:15000});
      const ui=await mobile.evaluate(()=>{
        const f=document.getElementById('interno-frame')?.getBoundingClientRect();
        return {viewport:innerWidth,width:document.documentElement.scrollWidth,
          mapHeight:f?.height};
      });
      assert.ok(ui.width<=width+1,'Rolagem horizontal na aba Ônibus: '+JSON.stringify(ui));
      assert.ok(ui.mapHeight>=320,'O mapa precisa ter espaço útil: '+JSON.stringify(ui));
      await bus.locator('#quick-linhas').click();
      const filterAll=bus.locator('[data-line-filter-mode="all"]');
      const filterInternal=bus.locator('[data-line-filter-mode="internal"]');
      const filterMunicipal=bus.locator('[data-line-filter-mode="external"]');
      await filterAll.waitFor({state:'visible'});
      assert.equal(await bus.locator('[data-line-filter-mode]').count(),3,
        'Linhas precisa exibir os filtros Todas, Internos e Municipais');
      assert.equal(await filterAll.getAttribute('aria-pressed'),'true');
      if(width<=759){
        assert.equal(await bus.locator('#map-source-switch').isVisible(),false,
          'Linhas aberto não deve duplicar o filtro sobre o mapa');
      }
      const dimensions=await bus.locator('.bus-line-filters').evaluate(n=>({
        height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width
      }));
      assert.ok(dimensions.height>=40&&dimensions.width>=180,
        'Filtro de Linhas deve ser visível e tocável: '+JSON.stringify(dimensions));
      assert.match(await bus.locator('#bus-lines-list .bus-line-group').first().innerText(),/Internos/);
      assert.equal(await bus.locator('#bus-lines-list [data-line]').count()>0,true);
      await filterInternal.click();
      assert.equal(await filterInternal.getAttribute('aria-pressed'),'true');
      assert.equal(await bus.locator('#bus-lines-list [data-externo-code]').count(),0);
      await filterMunicipal.click();
      assert.equal(await filterMunicipal.getAttribute('aria-pressed'),'true');
      assert.equal(await bus.locator('#bus-lines-list [data-line]').count(),0);
      assert.match(await bus.locator('#bus-lines-list .bus-line-group').first().innerText(),/Municipais/);
      await filterAll.click();
      assert.equal(await filterAll.getAttribute('aria-pressed'),'true');
      assert.match(await bus.locator('#bus-lines-list .bus-line-group').first().innerText(),/Internos/);
      if(width===390){
        // Recolher Linhas devolve o filtro ao mapa; reabrir devolve à lista.
        const toggle=bus.locator('#sheet-toggle');
        await toggle.click(); // painel intermediário → ampliado
        await toggle.click(); // ampliado → recolhido
        assert.equal(await bus.locator('#map-source-switch').isVisible(),true,
          'Mapa não pode perder o filtro quando Linhas é recolhido');
        await toggle.click(); // recolhido → intermediário
        assert.equal(await bus.locator('#map-source-switch').isVisible(),false,
          'Filtro de Linhas não deve ser duplicado sobre mapa aberto');
        // Teste geométrico: controles no mapa e ferramentas em Linhas não se sobrepõem.
        const blocks=await bus.locator('body').evaluate(()=>{
          const b=selector=>{const n=document.querySelector(selector);if(!n)return null;
            const r=n.getBoundingClientRect();return {left:r.left,right:r.right,
              top:r.top,bottom:r.bottom,width:r.width,height:r.height,hidden:n.hidden};};
          return {loc:b('#loc'),mapFilter:b('#map-filter-toggle'),
            zoom:b('.leaflet-control-zoom'),status:b('#map-data-status'),
            offline:b('#map-basemap-notice'),sheet:b('#sheet'),
            search:b('.bus-line-search'),listFilter:b('.bus-line-filters')};
        });
        for(const key of ['loc','mapFilter','zoom','status','sheet','search','listFilter'])
          assert.ok(blocks[key],`Layout Ônibus sem ${key}: ${JSON.stringify(blocks)}`);
        assert.ok(blocks.loc.right+8<=blocks.mapFilter.left,
          'Localização e filtro se sobrepõem: '+JSON.stringify(blocks));
        assert.ok(blocks.mapFilter.right+3<=blocks.zoom.left,
          'Filtro e zoom se sobrepõem: '+JSON.stringify(blocks));
        assert.ok(blocks.mapFilter.bottom+8<=blocks.status.top,
          'Filtro sobrepõe status do mapa: '+JSON.stringify(blocks));
        assert.ok(blocks.search.bottom<=blocks.listFilter.top+3&&
          blocks.listFilter.top-blocks.search.bottom<=18&&
          blocks.listFilter.width>=blocks.search.width-8,
          'Busca e filtros devem ocupar faixas compactas separadas, sem buscas duplicadas: '+JSON.stringify(blocks));
        if(blocks.offline&&!blocks.offline.hidden){
          assert.ok(blocks.status.bottom+3<=blocks.offline.top,
            'Avisos do mapa sobrepostos: '+JSON.stringify(blocks));
          assert.ok(blocks.offline.bottom+12<=blocks.sheet.top,
            'Aviso do mapa coberto pelo painel: '+JSON.stringify(blocks));
        }
        await fs.mkdir(path.resolve(ROOT,'../qa-results/menu-compact'),{recursive:true});
        await mobile.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/onibus-linhas-390.png')});
      }
      await bus.locator('#quick-pontos').click();
      await bus.locator('#q').waitFor({state:'visible'});
      assert.equal(await bus.locator('#map-source-switch').isVisible(),true,
        'Em Pontos, o filtro flutuante do mapa deve estar disponível');
      assert.equal(await bus.locator('#sheet').evaluate(e=>e.classList.contains('peek')),false,
        'Busca do Interno deve abrir sem painel recolhido');
      assert.equal(menuRequests,0,'Interno não deve disparar consulta FUMP');
      await mobile.locator('#tab-menu').click();
      await mobile.waitForFunction(()=>document.querySelector('#tab-menu')?.getAttribute('aria-current')==='page');
      for(let attempt=0;attempt<30 && !menuRequests;attempt++)await mobile.waitForTimeout(100);
      assert.ok(menuRequests>0,'Ao voltar ao Cardápio, a consulta FUMP deve ser retomada');
      await mobile.close();
    }
  }finally{await mobileContext.close();}
  // Revisão desktop da navegação e hierarquia nas três abas públicas.
  const designContext=await browser.newContext({
    viewport:{width:1280,height:900},serviceWorkers:'block'
  });
  await designContext.addInitScript(()=>{
    try{localStorage.setItem('ruhoje:restaurant:v1','setorial-i')}catch{}
  });
  try{
    const design=await designContext.newPage();
    await design.goto(url+'?aba=festas&festas-demo=1',{waitUntil:'domcontentloaded'});
    await design.locator('.festa-card--compact').waitFor({state:'visible'});
    const festDesktop=await design.evaluate(()=>{
      const r=selector=>document.querySelector(selector).getBoundingClientRect();
      return {width:document.documentElement.scrollWidth,
        navRight:r('#bandeco-navigation').right,
        headingLeft:r('.festas-section-header').left,
        cardLeft:r('.festa-card--compact').left,
        headingBottom:r('.festas-section-header').bottom,
        cardTop:r('.festa-card--compact').top};
    });
    assert.ok(festDesktop.width<=1281,
      'Festas desktop ultrapassou viewport: '+JSON.stringify(festDesktop));
    assert.ok(festDesktop.navRight+12<festDesktop.cardLeft,
      'Sidebar se sobrepõe às Festas: '+JSON.stringify(festDesktop));
    assert.ok(festDesktop.headingBottom+8<festDesktop.cardTop,
      'Hierarquia desktop de Festas sem respiro: '+JSON.stringify(festDesktop));
    await fs.mkdir(path.resolve(ROOT,'../qa-results/menu-compact'),{recursive:true});
    await design.waitForTimeout(230);
    const navFest=await design.locator('#bandeco-navigation button[id^="tab-"]').evaluateAll(nodes=>
      nodes.filter(x=>x.getAttribute('aria-current')==='page').map(x=>x.id));
    assert.deepEqual(navFest,['tab-festas'],'Festas deve ser o único item selecionado no desktop');
    await design.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/alltabs-festas-1280.png')});
    await design.locator('#tab-sobre').click();
    await design.mouse.move(1,1);
    assert.equal(await design.locator('.sobre-topic').count(),3);
    assert.equal(await design.locator('#tab-sobre').getAttribute('aria-current'),'page');
    assert.equal(await design.locator('#tab-festas').getAttribute('aria-current'),'false');
    await design.waitForTimeout(230);
    await design.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/alltabs-sobre-1280.png')});
    await design.locator('#tab-menu').click();
    assert.equal(await design.locator('#tab-menu').getAttribute('aria-current'),'page');
    await design.waitForTimeout(230);
    await design.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/alltabs-cardapio-1280.png')});
  }finally{await designContext.close()}
  // Celular estreito: avaliar as três abas públicas sem depender da FUMP.
  const narrowDesignContext=await browser.newContext({
    viewport:{width:320,height:740},serviceWorkers:'block'
  });
  await narrowDesignContext.addInitScript(()=>{
    try{localStorage.setItem('ruhoje:restaurant:v1','setorial-i')}catch{}
  });
  try{
    const narrow=await narrowDesignContext.newPage();
    await narrow.route('https://hub-fump-proxy.hubufmg.workers.dev/**',
      route=>route.fulfill({status:200,contentType:'application/json',
        body:'{"id":6,"cardapios":[]}'}));
    await narrow.goto(url+'?aba=festas&festas-demo=1',{waitUntil:'domcontentloaded'});
    await narrow.locator('.festas-page .festa-card--compact').waitFor({state:'visible'});
    const noHorizontal=async tab=>{
      const info=await narrow.evaluate(()=>({
        viewport:innerWidth,width:document.documentElement.scrollWidth,
        navHeight:document.querySelector('#tab-menu').getBoundingClientRect().height
      }));
      assert.ok(info.width<=info.viewport+1,
        tab+' causou rolagem horizontal em 320px: '+JSON.stringify(info));
      assert.ok(info.navHeight>=44,
        tab+' reduziu o alvo de navegação: '+JSON.stringify(info));
    };
    await noHorizontal('Festas');
    await fs.mkdir(path.resolve(ROOT,'../qa-results/menu-compact'),{recursive:true});
    await narrow.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/alltabs-festas-320.png')});
    await narrow.locator('#tab-sobre').click();
    await narrow.locator('.sobre-topic').first().waitFor({state:'visible'});
    await noHorizontal('Sobre');
    assert.equal(await narrow.locator('.sobre-topic').count(),3);
    await narrow.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/alltabs-sobre-320.png')});
    await narrow.locator('#tab-menu').click();
    await narrow.locator('#restaurant-trigger').waitFor({state:'visible'});
    await noHorizontal('Cardápio');
    await narrow.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/alltabs-cardapio-320.png')});
  }finally{await narrowDesignContext.close()}
  // Integração real de eventos: clicar linha municipal na lista unificada
  // abre a MESMA linha no iframe externo (dados 100% sintéticos do teste).
  const combinedCtx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await combinedCtx.addInitScript(()=>{
    try{localStorage.setItem('ruhoje:restaurant:v1','setorial-i')}catch{}
  });
  try{
    const combined=await combinedCtx.newPage();
    await combined.route('https://tile.openstreetmap.org/**',route=>route.abort());
    await combined.route('**/externo/catalog/manifest.json',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({gtfsVersion:'synthetic-qa',routes:2,stops:2,stopTimeRows:4,
        feedStartDate:'20260101',feedEndDate:'20261231'})
    }));
    await combined.route('**/externo/catalog/routes.json',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify([{id:'R1',code:'101',name:'BH Centro'},
        {id:'R2',code:'901',name:'BH Pampulha'}])
    }));
    // Reproduce a small official-style municipal area in the unified map.
    await combined.route('**/externo/catalog/stops.json',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({
        '14784087':['Av. Campus Principal',-19.8694,-43.9672],
        '14784088':['Av. Centro',-19.8697,-43.9676]
      })
    }));
    await combined.route('**/externo/catalog/patterns.json',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify([{id:'p-qa',route:'R1',stops:['14784087','14784088']}])
    }));
    await combined.route('**/__hub_gps?**',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({available:true,source:'GTFS_RT',
        fetchedAt:new Date().toISOString(),
        records:[{routeId:'101',vehicleId:'qa-vehicle-1',
          latitude:-19.8694,longitude:-43.9672,lastGpsFixAt:new Date().toISOString()}]})
    }));
    await combined.route('**/externo/',route=>route.fulfill({
      status:200,contentType:'text/html',
      body:'<!doctype html><html data-app-mode="free-static"><head><title>Externo QA</title></head><body>'+
        '<input id="lineInput"><datalist id="routeList"><option value="101"></option><option value="901"></option></datalist>'+
        '<button id="goLine" onclick="document.getElementById(\'lineTitle\').textContent=document.getElementById(\'lineInput\').value;document.getElementById(\'lineExit\').hidden=false">Abrir linha</button>'+
        '<button id="lineExit" hidden>Fechar</button><h3 id="lineTitle"></h3></body></html>'
    }));
    await combined.goto(url+'?aba=onibus',{waitUntil:'domcontentloaded'});
    await combined.locator('#restaurant-dialog').evaluate(e=>e.close());
    const sheet=combined.frameLocator('#interno-frame');
    const mapFilter=sheet.locator('#map-filter-toggle');
     await mapFilter.waitFor({state:'visible'});
     assert.equal(await mapFilter.getAttribute('data-current-filter'),'all');
     const target=await mapFilter.evaluate(n=>n.getBoundingClientRect().toJSON());
     assert.ok(target.width<160&&target.height>=44,'Filtro do mapa deve ser compacto e tocável');
     await mapFilter.click();
     assert.equal(await mapFilter.getAttribute('data-current-filter'),'internal');
     await mapFilter.click();
     assert.equal(await mapFilter.getAttribute('data-current-filter'),'external');
     assert.equal(await sheet.locator('#map-filter-label').innerText(),'Municipais');
     await mapFilter.click();
     assert.equal(await mapFilter.getAttribute('data-current-filter'),'all');
     await sheet.locator('#map-data-status').getByText(/GPS ao vivo:/).waitFor({timeout:15000});
    assert.equal(await sheet.locator('.gps-bus-pin').count(),1);
    // Mobile compacto real: a aba deve continuar utilizável mesmo dentro do
    // iframe do Hub, que tem largura interna menor que a tela de 320 px.
    await combined.setViewportSize({width:320,height:740});
    const narrow=await sheet.locator('body').evaluate(()=>{
      const rect=q=>{const n=document.querySelector(q);if(!n)return null;
        const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}};
      return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
        loc:rect('#loc'),filter:rect('#map-filter-toggle'),
        zoom:rect('.leaflet-control-zoom')};
    });
    assert.ok(narrow.loc&&narrow.filter&&narrow.zoom,'Faltou controle essencial em 320px');
    assert.ok(narrow.scrollWidth<=narrow.width+1,'Rolagem horizontal interna em 320px: '+JSON.stringify(narrow));
    assert.ok(narrow.loc.right+6<=narrow.filter.left,'Localização sobrepõe filtro em 320px: '+JSON.stringify(narrow));
    assert.ok(narrow.filter.right+3<=narrow.zoom.left,'Filtro sobrepõe zoom em 320px: '+JSON.stringify(narrow));
    await fs.mkdir(path.resolve(ROOT,'../qa-results/menu-compact'),{recursive:true});
    await combined.screenshot({path:path.resolve(ROOT,'../qa-results/menu-compact/onibus-320.png')});
    await combined.setViewportSize({width:390,height:844});
    await sheet.locator('#quick-linhas').click();
    const stars=sheet.locator('#bus-lines-list [data-fav-list-line^="int:"]');
    await stars.nth(1).waitFor({state:'visible'});
    const favorite=await stars.nth(1).getAttribute('data-fav-list-line');
    await stars.nth(1).click();
    assert.equal(await sheet.locator('#bus-lines-list [data-fav-list-line]').first()
      .getAttribute('data-fav-list-line'),favorite,'Linha marcada deve subir ao topo');
    assert.equal(await sheet.locator('#bus-lines-list [data-fav-list-line="'+favorite+'"]')
      .getAttribute('aria-pressed'),'true');

    await sheet.locator('[data-externo-code="101"]').waitFor({state:'attached',timeout:15000});
    assert.match(await sheet.locator('#bus-lines-list .bus-line-group').first().innerText(),/Internos/);
    assert.equal(await sheet.locator('input#line-q').count(),1,
      'Hub deve oferecer apenas uma busca de linha');
    await sheet.locator('[data-externo-code="101"]').click();
    await sheet.locator('.municipal-detail-title').getByText(/101/).waitFor({timeout:15000});
    assert.equal(await combined.locator('#externo-frame').count(),0,
      'Selecionar municipal não deve trocar para segundo aplicativo');
    await combined.waitForFunction(()=>new URL(location.href).searchParams.get('linha')==='101',
      {timeout:10000});
    assert.equal(new URL(combined.url()).searchParams.get('tipo'),'externo');
    assert.equal(await sheet.locator('.municipal-direction-list').count(),1);
    assert.equal(await sheet.locator('[data-municipal-pattern]').count(),1);
    await sheet.locator('[data-municipal-list]').click();
    await sheet.locator('[data-line-filter-toggle]').waitFor({state:'visible'});
    assert.equal(await sheet.locator('[data-line-filter-toggle]').getAttribute('data-current-filter'),'all');
    assert.match(await sheet.locator('#bus-lines-list .bus-line-group').first().innerText(),/Internos/);
    await combined.waitForFunction(()=>new URL(location.href).searchParams.get('tipo')===null,
      {timeout:10000});
    await sheet.locator('#quick-pontos').click();
    await sheet.locator('[data-ext-stop="14784087"]').waitFor({state:'visible',timeout:15000});
    const internalStopStar=sheet.locator('#list [data-fav-stop-list]').nth(1);
    const stopId=await internalStopStar.getAttribute('data-fav-stop-list');
    await internalStopStar.click();
    assert.equal(await sheet.locator('#list [data-fav-stop-list]').first()
      .getAttribute('data-fav-stop-list'),stopId,'Ponto favorito deve subir sem seção especial');
    await sheet.locator('[data-ext-stop="14784087"]').click();
    await sheet.locator('.municipal-detail-title').getByText('Av. Campus Principal').waitFor();
    await combined.waitForFunction(()=>new URL(location.href).searchParams.get('ponto')==='14784087',
      {timeout:10000});
    assert.equal(await sheet.locator('#map-point-legend').count(),1);
    assert.equal(await sheet.locator('#map-source-switch').isVisible(),true);
    await sheet.locator('[data-municipal-list]').click();
    assert.match(await sheet.locator('#bus-lines-list .bus-line-group').first().innerText(),/Internos/);
  }finally{await combinedCtx.close()}
  // A URL municipal legada deve abrir O MESMO mapa unificado, sem segundo campo.
  const busValidCtx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await busValidCtx.addInitScript(()=>{
    try{localStorage.setItem('ruhoje:restaurant:v1','setorial-i')}catch{}
  });
  try{
    const validPage=await busValidCtx.newPage();
    await validPage.route('https://tile.openstreetmap.org/**',route=>route.abort());
    await validPage.route('**/externo/catalog/manifest.json',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({gtfsVersion:'synthetic-qa',routes:1,stops:1,
        stopTimeRows:4,feedStartDate:'20260101',feedEndDate:'20261231'})
    }));
    await validPage.route('**/externo/catalog/routes.json',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify([{id:'R1',code:'101',name:'BH Centro'}])
    }));
    await validPage.route('**/externo/catalog/stops.json',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify({'14791950':['Ponto de teste municipal',-19.870,-43.960]})
    }));
    await validPage.route('**/externo/catalog/patterns.json',route=>route.fulfill({
      status:200,contentType:'application/json',
      body:JSON.stringify([{id:'p-qa',route:'R1',headsign:'Centro',
        stops:['14791950'],tripCount:2}])
    }));
    await validPage.goto(url+'?aba=onibus&tipo=externo&ponto=14791950',
      {waitUntil:'domcontentloaded'});
    await validPage.locator('#restaurant-dialog').evaluate(el=>el.close());
    const inner=validPage.frameLocator('#interno-frame');
    await inner.locator('.municipal-detail-title').getByText('Ponto de teste municipal')
      .waitFor({timeout:15000});
    assert.equal(await validPage.locator('#externo-frame').count(),0);
    assert.equal(await validPage.locator('#interno-frame').isVisible(),true);
    assert.equal(await inner.locator('#map-point-legend').count(),1);
    await inner.locator('[data-municipal-list]').click();
    await inner.locator('[data-line-filter-toggle]').waitFor({state:'visible'});
    assert.match(await inner.locator('#bus-lines-list .bus-line-group').first().innerText(),/Internos/);
    assert.equal(await inner.locator('input#line-q').count(),1);
  }finally{await busValidCtx.close();}
  // Primeira visita por link direto não deve bloquear Festas com o seletor de RU.
  const firstVisit=await browser.newContext({serviceWorkers:'block'});
  try{
    const direct=await firstVisit.newPage();
    await direct.goto(url+'?festas-demo=1&aba=festas',{waitUntil:'domcontentloaded'});
    await direct.locator('.festas-page .festa-card--compact').waitFor({state:'visible'});
    assert.equal(await direct.locator('#restaurant-dialog').evaluate(el=>el.open),false);
  }finally{await firstVisit.close();}
  console.log('E2E mobile aprovado: 375/390/412 px, consulta sob demanda, links diretos, histórico e Interno.');


  // Prévia local real: 4 fontes oficiais (5 RUs, Saúde/Direito compartilham
  // fonte) e 2 datas. Sem mock no navegador: exercita o relay HTTP do Node,
  // as rotas limpas, a seleção de RU e o parser do app em conjunto.
  const localRequests=[];
  const previewServer=createPreviewServer({fetchFn:async upstream=>{
    const u=new URL(upstream);
    const id=u.searchParams.get('id'),date=u.searchParams.get('data');
    localRequests.push({id,date});
    assert.equal(u.origin,'https://hub-fump-proxy.hubufmg.workers.dev');
    assert.ok(['1','2','5','6'].includes(id));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date));
    return new Response(JSON.stringify({id:Number(id),cardapios:[{
      data:date,refeicoes:[{tipoRefeicao:'Almoço',pratos:[{
        tipoPrato:'Prato protéico 1',descricaoPrato:`Prato fonte ${id} em ${date}`
      },...(['1','6'].includes(id)?[{
        tipoPrato:id==='6'?'Prato protéico 1':'Prato protéico 3',descricaoPrato:'Bife de milho'
      }]:[])]}]
    }]}),{status:200,headers:{
      'Content-Type':'application/json','X-Menu-Fetched-At':new Date().toISOString()
    }});
  }});
  await new Promise(resolve=>previewServer.listen(0,'127.0.0.1',resolve));
  const previewOrigin=`http://127.0.0.1:${previewServer.address().port}`;
  const previewContext=await browser.newContext({serviceWorkers:'block'});
  try{
    const preview=await previewContext.newPage();
    await preview.goto(previewOrigin+'/',{waitUntil:'domcontentloaded'});
    const ruOptions=[
      ['RU Setorial I Campus Pampulha','6'],
      ['RU Setorial II Campus Pampulha','1'],
      ['RU Saúde Campus Saúde','2'],
      ['RU Direito Faculdade de Direito','2'],
      ['RU ICA Montes Claros','5']
    ];
    for(const [label,id] of ruOptions){
      if(!(await preview.locator('#restaurant-dialog').evaluate(e=>e.open)))
        await preview.locator('#restaurant-trigger').click();
      await preview.getByRole('button',{name:label,exact:true}).click();
      await preview.getByText(`Prato fonte ${id} em ${today}`,{exact:true}).waitFor({timeout:12000});
      assert.equal(await preview.locator('.meal-card').count(),1);
      if(['1','6'].includes(id)){
        assert.equal(await preview.locator('.menu-group--vegetarian').getByText('Bife de milho',{exact:true}).count(),1,
          `Bife de milho precisa ser vegetariano no RU fonte ${id}`);
        assert.equal(await preview.locator('.menu-group--main').getByText('Bife de milho',{exact:true}).count(),0);
      }
    }
    const nextDay=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
    await preview.locator(`.date-card[data-iso="${nextDay}"]`).click();
    await preview.getByText(`Prato fonte 5 em ${nextDay}`,{exact:true}).waitFor({timeout:12000});
    for(const id of ['1','2','5','6'])
      assert.ok(localRequests.some(req=>req.id===id&&req.date===today),
        `Prévia não consultou hoje para fonte ${id}`);
    assert.ok(localRequests.some(req=>req.id==='5'&&req.date===nextDay),
      'Prévia não consultou a data selecionada');
    assert.equal(await preview.locator('#connection-notice').isVisible(),false);
  }finally{
    await previewContext.close();
    await new Promise(resolve=>previewServer.close(resolve));
  }
  console.log('E2E prévia local aprovado: 5 RUs (4 fontes), troca de RU e dias, parser e proxy Node.');

  console.log('E2E Interno aprovado: Leaflet local, 49 pontos offline, mapa canônico e contingência sem tiles.');

  console.log('E2E aprovado: FUMP como fonte única, ausência de Firestore/localStorage antigo, prefetch D+1 e migração PWA.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
