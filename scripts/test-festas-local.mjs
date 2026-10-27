// Teste visual local, 100% sem escrita no Firebase. Usa os mesmos dados simulados de smoke.mjs.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','public');
const MIME={'.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const name=path.resolve(ROOT,'.'+pathname,(pathname==='/'?'index.html':''));
  if(!name.startsWith(ROOT+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
  try{const body=await fs.readFile(name);res.writeHead(200,{'Content-Type':MIME[path.extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/?festas-demo=1`;
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://firestore.googleapis.com/**', route=>route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({fields:{payload:{stringValue:JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),days:{}})}}})}));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#bandeco-main').isVisible(),true);
  // O primeiro acesso do Bandeco exige selecionar um RU antes de navegar.
  // Aguardar a abertura evita corrida entre DOMContentLoaded e os modulos JS.
  const restaurantDialog=page.locator('#restaurant-dialog');
  await restaurantDialog.waitFor({state:'visible',timeout:10000});
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();
  await restaurantDialog.waitFor({state:'hidden'});
  // v2.6.0: barra inferior fixa no celular e seção Sobre integral.
  // A aba Interno é um quarto destino público da mesma navegação.
  assert.deepEqual(
    await page.locator('.bandeco-tabs > button[aria-controls]').evaluateAll(buttons=>buttons.map(button=>button.id)),
    ['tab-menu','tab-interno','tab-festas','tab-sobre']
  );
  assert.equal(await page.locator('#sidebar-collapse').isVisible(),false);
  assert.equal(await page.locator('.bandeco-tabs').evaluate(el=>getComputedStyle(el).position),'fixed');
  await page.locator('#tab-sobre').click();
  assert.equal(await page.locator('#sobre-page').isVisible(),true);
  assert.match(await page.locator('#sobre-page').innerText(),/lazer como um direito social/);
  assert.equal(await page.locator('#bandeco-main').isHidden(),true);
  await page.locator('#tab-festas').click();
  assert.equal(await page.locator('#sobre-page').isHidden(),true);
  await page.getByText('Festa parceira (demonstração)',{exact:true}).waitFor({timeout:10000});
  assert.equal(await page.locator('#bandeco-main').isHidden(),true);
  assert.equal(await page.locator('.festa-card').count(),1);
  assert.equal(await page.locator('#signup-marketing').isChecked(),false);
  assert.equal(await page.locator('.festa-card .festa-ad').count(),0);
  for(let n=0;n<5;n++)await page.locator('.identity img').click();
  await page.locator('#admin-lock').click();
  await page.locator('#admin-events-list .festa-admin-event-row').waitFor();
  assert.equal(await page.locator('#admin-events-list .icon-btn[aria-label="Ocultar festa"]').count(),1);
  assert.equal(await page.locator('#admin-events-list .icon-btn.danger').count(),1);
  await page.locator('#admin-events-list .icon-btn[aria-label="Ocultar festa"]').click();
  await page.getByRole('heading',{name:'Ocultar festa?'}).waitFor();
  await page.locator('#admin-save-retry').click();
  await page.locator('#admin-hidden-wrap').waitFor({state:'visible'});
  assert.equal(await page.locator('#admin-hidden-wrap summary').innerText(),'Ocultas');
  await page.locator('#admin-hidden-wrap summary').click();
  assert.equal(await page.locator('#admin-hidden-list .icon-btn[aria-label="Exibir festa"]').count(),1);
  await page.locator('#admin-hidden-list .icon-btn[aria-label="Exibir festa"]').click();
  await page.getByRole('heading',{name:'Exibir festa?'}).waitFor();
  await page.locator('#admin-save-retry').click();
  await page.locator('#admin-events-list .icon-btn[aria-label="Ocultar festa"]').waitFor();
  await page.locator('#admin-create-event').click();
  assert.equal(await page.locator('#admin-posterUrl').count(),0);
  assert.equal(await page.locator('#admin-tag-composer').isHidden(),true);
  await page.locator('#admin-show-tag').click();
  await page.locator('#admin-new-tag').fill('Artes e música');
  await page.locator('#admin-add-tag').click();
  assert.equal(await page.locator('#admin-tag-composer').isHidden(),true);
  assert.equal(await page.locator('#admin-tags input[value="Artes e música"]').isChecked(),true);
  await page.locator('#admin-name').fill('Uma festa para testar');
  await page.locator('#admin-place').fill('Belo Horizonte');
  await page.locator('#admin-organizer').fill('Organização ilustrativa');
  await page.locator('#admin-startsAt').fill('2026-11-14T21:30');
  await page.locator('#admin-ticketUrl').fill('https://example.org/ingressos');
  await page.locator('#admin-tags input[value="Open Bar"]').check();
  await page.locator('#admin-tags input[value="Open Food"]').check();
  await page.locator('.festa-raffle-admin summary').click();
  await page.locator('#admin-raffleStatus').selectOption('open');
  await page.locator('#admin-winnerCount').fill('2');
  await page.locator('#admin-alternateCount').fill('1');
  await page.locator('#admin-drawAt').fill('2099-11-14T18:00');
  await page.locator('#admin-rulesText').fill('Siga o CATM e aguarde o resultado.');
  await page.locator('#admin-published').check();
  await page.locator('#admin-editor button[type=submit]').click();
  await page.getByRole('heading',{name:'Festa criada com sucesso!'}).waitFor();
  await page.locator('#admin-save-ok').click();
  await page.locator('#admin-dialog > .festa-dialog-inner > .festa-dialog-title [data-close]').click();
  await page.locator('.festa-card h3').getByText('Uma festa para testar',{exact:true}).waitFor();
  assert.equal(await page.locator('.festa-card').count(),2);
  const card=page.locator('.festa-card').filter({hasText:'Uma festa para testar'});
  assert.equal(await card.getByText(/Open Food/).count(),1);
  assert.equal(await card.getByText(/Open Bar/).count(),1);
  assert.equal(await card.getByText(/Artes e música/).count(),1);
  assert.equal(await card.getByText('INGRESSOS 🔥').count(),1);
  assert.equal(await card.getByText('vaga(s)').count(),0);
  assert.equal(await card.getByText('Suplentes').count(),0);
  for(const [i,ig] of ['aluno1','aluno2','aluno3','aluno4'].entries()){
    await card.getByRole('button',{name:'Sorteio'}).click();
    await page.locator('#signup-event-terms').check();
    await page.locator('#signup-rules-next').click();
    await page.locator('#signup-ig').fill('@'+ig);
    await page.locator('#signup-continue').click();
    await page.locator('#signup-name').fill('Pessoa de Teste '+i);
    await page.locator('#signup-email').fill(`aluno${i}@example.org`);
    assert.equal(await page.locator('#signup-marketing').isChecked(),false);
    await page.locator('#signup-submit').click();
    await page.getByText('Inscrição confirmada!',{exact:false}).waitFor();
    await page.locator('#signup-dialog [data-close]').click();
  }
  assert.match(await card.textContent(),/4 inscrito/);
  await page.locator('#admin-lock').click();
  await page.locator('#admin-tab-forms').click();
  await page.getByText('4 cadastros',{exact:false}).waitFor();
  await page.locator('#admin-tab-events').click();
  await page.getByRole('button',{name:'Editar Uma festa para testar'}).click();
  await page.locator('#admin-drawAt').fill('2020-01-01T12:00');
  await page.locator('#admin-editor button[type=submit]').click();
  await page.getByRole('heading',{name:'Alterações salvas!'}).waitFor();
  await page.locator('#admin-save-ok').click();
  await page.locator('#admin-dialog > .festa-dialog-inner > .festa-dialog-title [data-close]').click();
  await card.getByRole('button',{name:'Resultados!'}).waitFor({timeout:5000});
  await card.getByRole('button',{name:'Resultados!'}).click();
  const result=await page.locator('#result-body').innerText();
  assert.match(result,/Ganhadores/);
  assert.match(result,/Suplentes/);
  assert.doesNotMatch(result,/Pessoa de Teste [0-3]/);
  await page.locator('#result-dialog [data-close]').click();
  await page.locator('#tab-menu').click();
  assert.equal(await page.locator('#bandeco-main').isVisible(),true);
  assert.deepEqual(errors,[],'Nenhum erro de JavaScript no fluxo local');
  console.log('Festas E2E LOCAL aprovado: cardápio intacto, abas, cadeado, criação simulada, publicidade separada, sem gravação remota.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
