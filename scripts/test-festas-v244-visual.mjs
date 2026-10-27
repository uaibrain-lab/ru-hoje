// Evidência visual local da RC v2.4.4. Usa somente dados fictícios da demo.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','public');
const OUT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','diagnostics','visual-v244');
const MIME={'.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const name=path.resolve(ROOT,'.'+pathname,(pathname==='/'?'index.html':''));
  if(!name.startsWith(ROOT+path.sep)){res.writeHead(403);res.end('Forbidden');return;}
  try{const body=await fs.readFile(name);res.writeHead(200,{'Content-Type':MIME[path.extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end('Not found');}
});
await fs.rm(OUT,{recursive:true,force:true});await fs.mkdir(OUT,{recursive:true});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/?festas-demo=1`;
let browser;const errors=[];
async function openPage(width,height,theme='light'){
  const context=await browser.newContext({viewport:{width,height},colorScheme:theme,serviceWorkers:'block'});
  await context.addInitScript(pref=>localStorage.setItem('bandeco:theme:v1',pref),theme);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(`${width}x${height}: ${e.message}`));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const dialog=page.locator('#restaurant-dialog');await dialog.waitFor({state:'visible',timeout:10000});
  await page.getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click();await dialog.waitFor({state:'hidden'});
  return {page,context};
}
async function shot(page,name){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`overflow horizontal em ${name}`);
  // Retira o ponteiro da aba clicada para a evidência mostrar seleção, não hover.
  await page.mouse.move(2,2);await page.waitForTimeout(50);
  await page.screenshot({path:path.join(OUT,name),fullPage:true});
}
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const [width,height] of [[360,800],[390,844],[430,932],[768,1024],[1440,900]]){
    const {page,context}=await openPage(width,height,'light');
    await shot(page,`menu-${width}.png`);
    const navRect=await page.locator('#bandeco-navigation').evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,top:r.top};});
    if(width<851)assert.ok(navRect.width>=Math.min(width-24,540)-1,`navegação inferior esperada em ${width}px: ${JSON.stringify(navRect)}`);
    else assert.ok(navRect.width<width*.5,`sidebar lateral esperada em ${width}px: ${JSON.stringify(navRect)}`);
    await page.locator('#tab-festas').click();await page.getByText('Festa parceira (demonstração)',{exact:true}).waitFor();
    assert.equal(await page.locator('.bandeco-tabs > button[aria-current="page"]').count(),1);
    assert.equal(await page.locator('#tab-festas').getAttribute('aria-current'),'page');
    await shot(page,`festas-${width}.png`);
    await page.locator('#tab-sobre').click();assert.equal(await page.locator('#sobre-page').isVisible(),true);
    assert.equal(await page.locator('.bandeco-tabs > button[aria-current="page"]').count(),1);
    assert.equal(await page.locator('#tab-sobre').getAttribute('aria-current'),'page');
    await shot(page,`sobre-${width}.png`);
    await context.close();
  }
  const mobile=await openPage(390,844,'light');
  const {page}=mobile;
  await page.locator('#tab-festas').click();await page.getByText('Festa parceira (demonstração)',{exact:true}).waitFor();
  for(let n=0;n<5;n++)await page.locator('.identity img').click();await page.locator('#admin-lock').click();
  await page.locator('#admin-show-tag').click();await page.locator('#admin-new-tag').fill('Artes e música');await page.locator('#admin-add-tag').click();
  await page.locator('#admin-name').fill('Uma festa para testar');await page.locator('#admin-place').fill('Belo Horizonte');await page.locator('#admin-organizer').fill('Organização ilustrativa');await page.locator('#admin-startsAt').fill('2026-11-14T21:30');await page.locator('#admin-ticketUrl').fill('https://example.org/ingressos');
  await page.locator('#admin-tags input[value="Open Bar"]').check();await page.locator('#admin-tags input[value="Open Food"]').check();await page.locator('.festa-raffle-admin summary').click();await page.locator('#admin-raffleStatus').selectOption('open');await page.locator('#admin-winnerCount').fill('2');await page.locator('#admin-alternateCount').fill('1');await page.locator('#admin-drawAt').fill('2099-11-14T18:00');await page.locator('#admin-rulesText').fill('Siga o CATM e aguarde o resultado.');await page.locator('#admin-published').check();
  await shot(page,'painel-admin-mobile.png');await page.locator('#admin-editor button[type=submit]').click();await page.getByText('Festa salva no laboratório',{exact:false}).waitFor();await page.locator('#admin-dialog [data-close]').click();
  const card=page.locator('.festa-card').filter({hasText:'Uma festa para testar'});await card.getByRole('button',{name:'Sorteio'}).click();await shot(page,'sorteio-regras-mobile.png');await page.locator('#signup-event-terms').check();await page.locator('#signup-rules-next').click();await page.locator('#signup-ig').fill('@aluno1');await page.locator('#signup-continue').click();await page.locator('#signup-name').fill('Pessoa de Teste');await page.locator('#signup-email').fill('aluno@example.org');await shot(page,'inscricao-mobile.png');await page.locator('#signup-submit').click();await page.getByText('Inscrição confirmada!',{exact:false}).waitFor();await page.locator('#signup-dialog [data-close]').click();
  await page.locator('#admin-lock').click();await page.locator('#admin-tab-forms').click();await page.getByText('1 cadastro',{exact:false}).waitFor();await shot(page,'formularios-mobile.png');await page.locator('#admin-tab-events').click();await page.locator('#admin-events').selectOption({label:'● Uma festa para testar'});await page.locator('#admin-drawAt').fill('2020-01-01T12:00');await page.locator('#admin-editor button[type=submit]').click();await page.getByText('Festa salva no laboratório',{exact:false}).waitFor();await page.locator('#admin-dialog [data-close]').click();await card.getByRole('button',{name:'Resultados!'}).click();await shot(page,'resultados-mobile.png');await mobile.context.close();
  const dark=await openPage(390,844,'dark');await dark.page.locator('#tab-festas').click();await dark.page.getByText('Festa parceira (demonstração)',{exact:true}).waitFor();await shot(dark.page,'festas-dark-390.png');await dark.context.close();
  const desktop=await openPage(1440,900,'light');assert.equal(await desktop.page.locator('#sidebar-collapse').isVisible(),true);await desktop.page.locator('#tab-festas').click();await desktop.page.getByText('Festa parceira (demonstração)',{exact:true}).waitFor();await shot(desktop.page,'sidebar-desktop.png');await desktop.page.locator('#sidebar-collapse').click();await shot(desktop.page,'sidebar-recolhida-desktop.png');await desktop.context.close();
  assert.deepEqual(errors,[],'Nenhum erro JavaScript visual');
  console.log(`VISUAL RC V2.4.4 APROVADO: ${await fs.readdir(OUT).then(files=>files.length)} capturas reais em ${OUT}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
