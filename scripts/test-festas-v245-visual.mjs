// Evidência visual v2.4.5: somente laboratório local e dados fictícios.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const PROJECT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ROOT=path.join(PROJECT,'public');
const OUT=path.join(PROJECT,'diagnostics','visual-v245');
const MIME={'.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'};
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
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`overflow horizontal em ${name}`);
  await page.mouse.move(2,2);await page.waitForTimeout(60);await page.screenshot({path:path.join(OUT,name),fullPage:true});
}
async function openAdmin(page){
  for(let n=0;n<5;n++)await page.locator('.identity img').click();
  await page.locator('#admin-lock').click();await page.locator('#admin-panel').waitFor({state:'visible'});
}
async function posterBytes(page,type){
  if(type==='png')return fs.readFile(path.join(ROOT,'assets','icons','icon-512.png'));
  const data=await page.evaluate(async format=>{
    const image=new Image();image.src='/assets/icons/icon-512.png';await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL(format,.88);
  },type==='jpeg'?'image/jpeg':'image/webp');
  return Buffer.from(data.split(',')[1],'base64');
}
async function upload(page,type){
  await page.locator('#admin-poster-file').setInputFiles({name:`cartaz.${type==='jpeg'?'jpg':type}`,mimeType:`image/${type}`,buffer:await posterBytes(page,type)});
  await page.getByText('Arte otimizada e pronta', {exact:false}).waitFor();
}
async function fillEvent(page,name,type){
  await page.locator('#admin-name').fill(name);await page.locator('#admin-place').fill('Belo Horizonte');await page.locator('#admin-organizer').fill('Organização ilustrativa');await page.locator('#admin-startsAt').fill('2026-11-14T21:30');await page.locator('#admin-ticketUrl').fill('https://example.org/ingressos');
  await page.locator('#admin-tags input[value="Open Bar"]').check();await page.locator('#admin-tags input[value="Open Food"]').check();await page.locator('#admin-published').check();await upload(page,type);
}
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const [width,height] of [[360,800],[390,844],[430,932],[768,1024],[1440,900]]){
    const {page,context}=await openPage(width,height);await shot(page,`cardapio-${width}.png`);
    const nav=page.locator('#bandeco-navigation');const rect=await nav.boundingBox();
    if(width<851)assert.ok(rect.width>=Math.min(width-24,540)-1,`navegação móvel inesperada em ${width}px`);else assert.ok(rect.width<width*.5,`sidebar esperada em ${width}px`);
    await page.locator('#tab-festas').click();await page.getByText('Festa parceira (demonstração)',{exact:true}).waitFor();
    assert.equal(await page.locator('.bandeco-tabs > button[aria-current="page"]').count(),1);assert.equal(await page.locator('#tab-festas').getAttribute('aria-current'),'page');assert.ok(await page.locator('#tab-festas').evaluate(el=>el.classList.contains('is-active')));await shot(page,`festas-${width}.png`);
    await page.locator('#tab-sobre').click();assert.equal(await page.locator('.bandeco-tabs > button[aria-current="page"]').count(),1);assert.equal(await page.locator('#tab-sobre').getAttribute('aria-current'),'page');await shot(page,`sobre-${width}.png`);await context.close();
  }
  const {page,context}=await openPage(390,844);await page.locator('#tab-festas').click();await page.getByText('Festa parceira (demonstração)',{exact:true}).waitFor();
  await openAdmin(page);await page.locator('#admin-create-event').click();await page.locator('#admin-show-tag').click();await page.locator('#admin-new-tag').fill('Artes e música');await page.locator('#admin-add-tag').click();await fillEvent(page,'Festa cartaz PNG','png');await shot(page,'painel-admin-upload-mobile.png');await page.locator('#admin-editor button[type=submit]').click();await page.getByRole('heading',{name:'Festa criada com sucesso!'}).waitFor();await page.locator('#admin-save-ok').click();await page.locator('#admin-dialog > .festa-dialog-inner > .festa-dialog-title [data-close]').click();
  const pngCard=page.locator('.festa-card').filter({hasText:'Festa cartaz PNG'});await pngCard.getByRole('button',{name:'Abrir cartaz completo'}).click();await page.locator('#poster-dialog').waitFor({state:'visible'});await shot(page,'cartaz-completo-mobile.png');await page.locator('#poster-dialog [data-close]').click();
  await openAdmin(page);await page.getByRole('button',{name:'Editar Festa cartaz PNG'}).click();await upload(page,'jpeg');await page.locator('#admin-editor button[type=submit]').click();await page.getByRole('heading',{name:'Alterações salvas!'}).waitFor();await page.locator('#admin-save-ok').click();
  await page.locator('#admin-create-event').click();await fillEvent(page,'Festa cartaz WebP','webp');await page.locator('#admin-editor button[type=submit]').click();await page.getByRole('heading',{name:'Festa criada com sucesso!'}).waitFor();await page.locator('#admin-save-ok').click();await page.locator('#admin-dialog > .festa-dialog-inner > .festa-dialog-title [data-close]').click();await page.locator('.festa-card h3').getByText('Festa cartaz WebP',{exact:true}).waitFor();await shot(page,'dois-eventos-mobile.png');
  const webpCard=page.locator('.festa-card').filter({hasText:'Festa cartaz WebP'});await webpCard.getByRole('button',{name:'Sorteio'}).count().catch(()=>{});
  // Cria um evento aberto real na demo para provar regras, formulário e pluralização.
  await openAdmin(page);await page.getByRole('button',{name:'Editar Festa cartaz WebP'}).click();await page.locator('.festa-raffle-admin summary').click();await page.locator('#admin-raffleStatus').selectOption('open');await page.locator('#admin-winnerCount').fill('1');await page.locator('#admin-alternateCount').fill('1');await page.locator('#admin-drawAt').fill('2099-11-14T18:00');await page.locator('#admin-rulesText').fill('Siga o CATM e aguarde o resultado.');await page.locator('#admin-editor button[type=submit]').click();await page.getByRole('heading',{name:'Alterações salvas!'}).waitFor();await page.locator('#admin-save-ok').click();await page.locator('#admin-dialog > .festa-dialog-inner > .festa-dialog-title [data-close]').click();
  await webpCard.getByRole('button',{name:'Sorteio'}).click();await shot(page,'modal-regras-mobile.png');await page.locator('#signup-event-terms').check();await page.locator('#signup-rules-next').click();await page.locator('#signup-ig').fill('@aluno1');await page.locator('#signup-continue').click();await page.locator('#signup-name').fill('Pessoa de Teste');await page.locator('#signup-email').fill('aluno@example.org');await shot(page,'formularios-plural-mobile.png');await page.locator('#signup-submit').click();await page.getByText('Inscrição confirmada!',{exact:false}).waitFor();await page.locator('#signup-dialog [data-close]').click();
  await openAdmin(page);await page.locator('#admin-tab-forms').click();await page.getByText('1 cadastro · 1 inscrição',{exact:false}).waitFor();await shot(page,'ingressos-sorteio-mobile.png');await page.locator('#admin-tab-events').click();await page.getByRole('button',{name:'Editar Festa cartaz WebP'}).click();await page.locator('#admin-drawAt').fill('2020-01-01T12:00');await page.locator('#admin-editor button[type=submit]').click();await page.getByRole('heading',{name:'Alterações salvas!'}).waitFor();await page.locator('#admin-save-ok').click();await page.locator('#admin-dialog > .festa-dialog-inner > .festa-dialog-title [data-close]').click();await webpCard.getByRole('button',{name:'Resultados!'}).click();await shot(page,'ingressos-resultados-mobile.png');await page.locator('#result-dialog [data-close]').click();await context.close();
  const dark=await openPage(390,844,'dark');await dark.page.locator('#tab-festas').click();await shot(dark.page,'festas-dark-390.png');await dark.context.close();
  const desktop=await openPage(1440,900);await desktop.page.locator('#tab-festas').click();await shot(desktop.page,'sidebar-ativa-desktop.png');await desktop.page.locator('#sidebar-collapse').click();await shot(desktop.page,'sidebar-recolhida-desktop.png');await desktop.context.close();
  assert.deepEqual(errors,[],'Nenhum erro JavaScript visual');
  console.log(`VISUAL V2.4.5 APROVADO: ${await fs.readdir(OUT).then(files=>files.length)} capturas reais em ${OUT}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
