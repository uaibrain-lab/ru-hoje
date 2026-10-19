import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMenus, identifyRestaurant, inferMealOption, mergeMenus } from './parser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = path.join(ROOT,'public','data','cardapios.json');
const DIAG_DIR = path.join(ROOT,'diagnostics');
const SOURCE = 'https://fump.ufmg.br/cardapio-do-dia/';
const SETTINGS = {
  days: Math.max(1,Math.min(10,Number(process.argv.find((a,i)=>process.argv[i-1]==='--days') || '2'))),
  timeout: 18000,
};
const RU_IDs = ['setorial-i','setorial-ii','saude','direito','ica'];
const dateParts = (d=new Date()) => {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d)) p[part.type]=part.value;
  return `${p.year}-${p.month}-${p.day}`;
};
const addDays = (iso,n) => {const d=new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const shownDate = (iso) => `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`;
const nap = ms=>new Promise(r=>setTimeout(r,ms));
function supportedDateCheck(text,iso) {
  // Se há uma data marcada "Data:" no resultado, devemos validá-la.
  const m=text.match(/(?:^|\n)\s*(?:data|card[aá]pio do dia\s*[-–:]?)\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  return !m || `${m[3]}-${m[2]}-${m[1]}`===iso;
}
function selectControls(form) {
  const r=[];const m=[];
  for (const s of form.selects) {
    const ruEntries = s.options.filter(o => identifyRestaurant(o.text).length);
    const meals = s.options.filter(o => inferMealOption(o.text));
    if (ruEntries.length >= 2) r.push({...s, options:ruEntries});
    if (meals.length >= 2) m.push({...s, options:meals});
  }
  return {restaurant: r[0], meal: m.find(x=>x.index!==r[0]?.index)};
}
async function inspect(page) {
  return await page.evaluate(() => ({
    title:document.title,
    selects:[...document.querySelectorAll('select')].map((s,index)=>({index,id:s.id,name:s.name,outer:s.outerHTML.slice(0,350),options:[...s.options].map(o=>({text:o.textContent.trim(),value:o.value,disabled:o.disabled}))})),
    dates:[...document.querySelectorAll('input')].map((s,index)=>({index,type:s.type,name:s.name,id:s.id,placeholder:s.placeholder,value:s.value,readonly:s.readOnly,outer:s.outerHTML.slice(0,240)}))
      .filter(s=>/date|data|calendar|dt|dd\/mm|datepicker/i.test([s.type,s.name,s.id,s.placeholder,s.outer].join(' '))),
    buttons:[...document.querySelectorAll('button,input[type=submit]')].map(s=>({text:(s.textContent||s.value||'').trim(),outer:s.outerHTML.slice(0,210)})).slice(0,30),
  }));
}
async function changeSelect(page,index,value) {
  const sel=page.locator('select').nth(index);
  await sel.selectOption(value,{timeout:6000});
  await nap(200);
}
async function changeDate(page,iso) {
  const form=await inspect(page);
  const candidate=form.dates.find(s=>s.type==='date') || form.dates.find(s=>/data|date|dia|calendar|dd\/mm/i.test([s.name,s.id,s.placeholder,s.outer].join(' ')));
  if (!candidate) throw new Error('Não foi identificado o campo de data; recusando reutilizar cardápio de outro dia.');
  const textDate=shownDate(iso);
  const value=candidate.type==='date' ? iso : textDate;
  await page.locator('input').nth(candidate.index).evaluate((input,v) => {
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(input,v);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.dispatchEvent(new Event('blur',{bubbles:true}));
  },value);
  const stored=await page.locator('input').nth(candidate.index).inputValue();
  if (stored !== value) throw new Error(`Data não foi fixada no formulário: ${stored} != ${value}`);
}
async function clickSubmit(page) {
  const submit = page.getByRole('button',{name:/consultar card[aá]pio/i}).first();
  if (await submit.count()) await submit.click({timeout:5000});
  else {
    const alternative=page.locator('input[type=submit], button[type=submit]').first();
    if (!(await alternative.count())) throw new Error('Botão Consultar Cardápio não encontrado');
    await alternative.click({timeout:5000});
  }
  await page.waitForLoadState('domcontentloaded',{timeout:6000}).catch(()=>{});
  await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
  await nap(650);
}
async function collectResponse(page,iso,ruId,mealVal=null) {
  const responses=[];
  page.on('response',async response=> {
    const type=response.request().resourceType();
    if(!['xhr','fetch'].includes(type) || response.status()!==200) return;
    try {
      const ct=response.headers()['content-type'] || '';
      if (!/json|text|html/.test(ct)) return;
      const s=await response.text();
      if(s.length<120000) responses.push(s.replace(/<[^>]*>/g,'\n'));
    } catch {}
  });
  // A FUMP pode manter recursos secundários pendentes no runner do GitHub.
  // O commit confirma a navegação; a presença do formulário continua obrigatória.
  await page.goto(SOURCE,{waitUntil:'commit',timeout:SETTINGS.timeout});
  const restaurantSelect=page.locator('select[name="restaurante"],select#restaurante').first();
  await restaurantSelect.waitFor({state:'attached',timeout:6000});
  await page.waitForFunction(() => {
    const select=document.querySelector('select[name="restaurante"],select#restaurante');
    return select && [...select.options].some(option =>
      /setorial|sa[uú]de|direito|\bica\b|montes claros/i.test(option.textContent || '')
    );
  },null,{timeout:12000});
  const form=await inspect(page);
  const controls=selectControls(form);
  if (!controls.restaurant) throw new Error(`Não identifiquei o seletor de restaurante (${form.selects.length} selects)`);
  const opt=controls.restaurant.options.find(o=>identifyRestaurant(o.text).includes(ruId));
  if (!opt) return { menus:{}, reason:`Restaurante ${ruId} não está entre as opções publicadas`, form };
  await changeSelect(page,controls.restaurant.index,opt.value);
  await changeDate(page,iso);
  // Alguns formulários apenas carregam as opções de refeição depois de selecionar o RU.
  const current=selectControls(await inspect(page));
  if (mealVal) {
    if (current.meal?.options.some(o=>o.value===mealVal)) await changeSelect(page,current.meal.index,mealVal);
    else throw new Error(`Opção de refeição ${mealVal} não disponível`);
  }
  await clickSubmit(page);
  const resultContainer=page.locator('#resultado');
  await resultContainer.waitFor({state:'attached',timeout:6000});
  await page.waitForFunction(() => {
    const result=document.querySelector('#resultado');
    return result && result.innerText.trim().length > 0;
  },null,{timeout:7000}).catch(()=>{});
  const candidates=[];
  const resultText=(await resultContainer.innerText().catch(()=>'' )).trim();
  if (resultText) candidates.push(resultText);
  // O formulário pode oferecer uma única refeição e retornar pratos sem título.
  // Somente forçar a refeição quando o select atual permite identificá-la.
  const chosenMealValue = mealVal ?? (current.meal ? await page.locator('select').nth(current.meal.index).inputValue().catch(()=>null) : null);
  const forcedMeal = chosenMealValue && current.meal
    ? (inferMealOption(current.meal.options.find(o=>o.value===chosenMealValue)?.text) || null)
    : null;
  const result={};
  for (const candidate of [...candidates,...responses]) {
    if (!supportedDateCheck(candidate,iso)) continue;
    mergeMenus(result,extractMenus(candidate,forcedMeal));
  }
  return {menus:result,form,options:current.meal?.options || [], capturedText:candidates.at(-1)?.slice(0,12000) || ''};
}
async function saveDiag(page,metadata) {
  await fs.mkdir(DIAG_DIR,{recursive:true});
  await fs.writeFile(path.join(DIAG_DIR,'last-run.json'),JSON.stringify(metadata,null,2));
  if (page && !page.isClosed()) await page.screenshot({path:path.join(DIAG_DIR,'fump.png'),fullPage:true,timeout:6000}).catch(()=>{});
}
async function main() {
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({locale:'pt-BR',timezoneId:'America/Sao_Paulo',viewport:{width:1365,height:900}});
  let snapshot;
  try {snapshot=JSON.parse(await fs.readFile(DATA_PATH,'utf8'));} catch {snapshot=null;}
  if (!snapshot || snapshot.schemaVersion!==1) snapshot={schemaVersion:1,generatedAt:null,source:SOURCE,days:{}};
  let success=0, failures=0;
  const diagnostics=[];
  try {
    const today=dateParts();
    for(let offset=0;offset<SETTINGS.days;offset++) {
      const iso=addDays(today,offset);
      for (const id of RU_IDs) {
        const page=await context.newPage();
        let forms=null;
        try {
          const capture=await collectResponse(page,iso,id);
          forms=capture.form;
          const menus={...capture.menus};
          // Somente consulta extra quando o formulário oferece refeições individuais.
          const possibleMeals=capture.options.filter(o=>inferMealOption(o.text));
          for(const opt of possibleMeals) {
            const meal=inferMealOption(opt.text);
            if(menus[meal]) continue;
            const mpage=await context.newPage();
            try {
              const extra=await collectResponse(mpage,iso,id,opt.value);
              mergeMenus(menus,extra.menus);
            } catch(e) {diagnostics.push({date:iso,ru:id,meal,error:e.message});}
            finally {await mpage.close();}
          }
          if (!Object.keys(menus).length) {
            failures++;
            diagnostics.push({date:iso,ru:id,issue:'Nenhum prato validado',form:forms,text:capture.capturedText?.slice(0,1500)});
            if (diagnostics.length===1) await saveDiag(page,diagnostics.at(-1));
            continue;
          }
          const dateData=snapshot.days[iso] ||= {restaurants:{}};
          const restaurant=dateData.restaurants[id] ||= {meals:{},fetchedAt:null};
          const capturedAt=new Date().toISOString();
          // Uma captura mais curta também pode ser a alteração oficial da FUMP.
          // Substituir refeições confirmadas, nunca manter pratos antigos por tamanho.
          for (const [mealId, mealData] of Object.entries(menus)) {
            if (mealData?.items?.length) restaurant.meals[mealId]={...mealData,fetchedAt:capturedAt};
          }
          restaurant.fetchedAt=capturedAt;
          success++;
          console.log(`${iso} ${id}: ${Object.entries(menus).map(([m,v])=>`${m}=${v.items.length}`).join(', ')}`);
        } catch(err) {
          failures++;
          diagnostics.push({date:iso,ru:id,error:err.message,form:forms});
          if (diagnostics.length===1) await saveDiag(page,diagnostics.at(-1));
          console.warn(`Falhou ${iso} ${id}: ${err.message}`);
        } finally {await page.close();}
        await nap(250);
      }
    }
  } finally {await browser.close();}
  await fs.mkdir(DIAG_DIR,{recursive:true});
  await fs.writeFile(path.join(DIAG_DIR,'summary.json'),JSON.stringify({success,failures,diagnostics},null,2));
  if (success===0) {
    console.error('Nenhum cardápio foi validado. Mantendo o último JSON intacto. Ver diagnostics/summary.json');
    process.exitCode=1;
    return;
  }
  const today=dateParts();
  for(const day of Object.keys(snapshot.days)) if (day<addDays(today,-14) || day>addDays(today,10)) delete snapshot.days[day];
  snapshot.generatedAt=new Date().toISOString();
  snapshot.source=SOURCE;
  await fs.writeFile(DATA_PATH,JSON.stringify(snapshot,null,2)+'\n');
  console.log(`Sincronização concluída: ${success} RUs/datas com cardápios; ${failures} falhas. Nenhuma refeição inventada.`);
}
await main();
