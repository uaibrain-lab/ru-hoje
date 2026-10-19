/**
 * Diagnóstico READ-ONLY do formulário oficial da FUMP.
 * Não importa nem modifica scripts/sync.mjs e não grava em public/.
 * Uso:
 *   node scripts/inspect-fump-result.mjs --ru setorial-i --date 2026-10-19
 *   node scripts/inspect-fump-result.mjs --all --date 2026-10-19
 * Saída: diagnostics/form-results/*.json e *.png
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { chromium } from 'playwright';
import { RU_LIST, matchRU, mealOption } from './form-recognition.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'diagnostics', 'form-results');
const ORIGIN = 'https://fump.ufmg.br';
const URL_SOURCE = ORIGIN + '/cardapio-do-dia/';
const ARG = process.argv.slice(2);
const getArg = (flag, d) => ARG.includes(flag) ? ARG[ARG.indexOf(flag) + 1] : d;
const dateBR = (iso) => `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`;
const defaultDate = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Sao_Paulo'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const ISO = getArg('--date', defaultDate());
const only = getArg('--ru', 'setorial-i');
const IDS = ARG.includes('--all') ? RU_LIST : [only];

if (!/^\d{4}-\d{2}-\d{2}$/.test(ISO) || new Date(`${ISO}T12:00:00Z`).toISOString().slice(0,10) !== ISO) throw Error('Data inválida --date YYYY-MM-DD');
if (!IDS.every(id=>RU_LIST.includes(id))) throw Error(`Restaurante inválido. Opções: ${RU_LIST.join(', ')}`);

const sleep = ms=>new Promise(r=>setTimeout(r,ms));

async function fieldInfo(page) {
  return page.evaluate(() => ({
    selects:[...document.querySelectorAll('select')].map(s=>({id:s.id,name:s.name,options:[...s.options].map(o=>({label:(o.textContent||'').trim(),value:o.value,disabled:o.disabled})),value:s.value})),
    dates:[...document.querySelectorAll('input')].filter(x=>x.type==='date'||/\b(data|date)\b/i.test(`${x.name} ${x.id}`)).map(x=>({name:x.name,id:x.id,type:x.type,value:x.value})),
    buttons:[...document.querySelectorAll('button,input[type="submit"]')].map(x=>({name:x.name,text:(x.innerText||x.value||'').trim().slice(0,100),type:x.type})),
  }));
}

async function resultSnapshot(page) {
  return page.evaluate(() => {
    const selector = '[id*="cardapio" i],[class*="cardapio" i],[id*="resultado" i],[class*="resultado" i],[id*="menu" i],[class*="menu" i],article,main';
    const nodes=[...new Set([...document.querySelectorAll(selector)])].filter(n=>!['FORM','SCRIPT','STYLE'].includes(n.tagName));
    return nodes.slice(0,100).map(n=>({
      tag:n.tagName.toLowerCase(),
      id:n.id||'',
      classes:typeof n.className==='string'?n.className.slice(0,160):'',
      parentTag:n.parentElement?.tagName?.toLowerCase()||'',
      parentId:n.parentElement?.id||'',
      childElements:n.childElementCount,
      text:(n.innerText||'').trim().slice(0,9000),
      htmlSample:n.outerHTML.slice(0,1600).replace(/<input\b[^>]*>/gi,'<input redacted>').replace(/(value|nonce|token|csrf|authorization)\s*=\s*(["']).*?\2/gi,'$1="[redacted]"'),
    })).filter(x=>x.text.length>15).sort((a,b)=>a.text.length-b.text.length).slice(0,32);
  });
}

async function collectOne(browser,ru,meal) {
  const page=await browser.newPage({locale:'pt-BR',timezoneId:'America/Sao_Paulo',viewport:{width:1365,height:900},serviceWorkers:'block'});
  const started=new Date().toISOString();
  const result={date:ISO,ru,meal,started,source:URL_SOURCE,steps:[],forms:{},network:[],snapshot:[],errors:[]};
  const pending=[];
  page.on('response', response=>{
    const request=response.request();
    let u;try{u=new URL(response.url());}catch{return;}
    if(u.origin!==ORIGIN) return;
    const type=request.resourceType();
    if(!['document','xhr','fetch'].includes(type)) return;
    const rec={kind:type,method:request.method(),path:u.pathname,status:response.status(),contentType:response.headers()['content-type']??'',length:0,sample:''};
    result.network.push(rec);
    if (['xhr','fetch'].includes(type)) pending.push((async()=>{
      try {
        const text=await response.text();
        rec.length=text.length;
        if(text.length < 150000) rec.sample=text.slice(0,18000);
      }catch(e){rec.readError=String(e).slice(0,200);}
    })());
  });
  try {
    const response=await page.goto(URL_SOURCE,{waitUntil:'commit',timeout:25000});
    result.steps.push({name:'navigate',status:response?.status()});
    await page.locator('select[name="restaurante"], select#restaurante').first().waitFor({state:'attached',timeout:15000});
    await page.waitForFunction(()=>{
      const s=document.querySelector('select[name="restaurante"],select#restaurante');
      return s && [...s.options].some(o=>/setorial|sa[uú]de|direito|\bica\b|montes claros/i.test(o.textContent||''));
    },null,{timeout:12000});
    result.forms.initial=await fieldInfo(page);
    const sel=page.locator('select[name="restaurante"], select#restaurante').first();
    const opts=await sel.locator('option').evaluateAll(els=>els.map(o=>({label:(o.textContent||'').trim(),value:o.value,disabled:o.disabled})));
    const matches=opts.filter(o=>!o.disabled&&o.value&&matchRU(o.label,ru));
    result.steps.push({name:'select-restaurant-options',matching:matches.map(o=>o.label),count:opts.length});
    if(matches.length!==1) throw Error(`Esperada UMA opção inequívoca para ${ru}, encontradas ${matches.length}. Ver forms.initial.`);
    const chosen=matches[0];
    await sel.selectOption(chosen.value);
    await sleep(450);
    result.forms.afterRestaurant=await fieldInfo(page);
    const dates=page.locator('input[name="data"],input#data,input[type="date"]');
    if(await dates.count()!==1) throw Error(`Campo data ambíguo/ausente (${await dates.count()})`);
    const dateField=dates.first();
    const type=await dateField.getAttribute('type');
    const dateVal=type==='date'?ISO:dateBR(ISO);
    await dateField.evaluate((input,value)=>{
      const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
      descriptor.set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      input.dispatchEvent(new Event('blur',{bubbles:true}));
    },dateVal);
    if(await dateField.inputValue()!==dateVal) throw Error('Formulário não aceitou a data informada');
    const mealField=page.locator('select[name="tipoRefeicao"],select#tipoRefeicao').first();
    if(await mealField.count()!==1) throw Error('Campo de refeição ausente');
    const mealOpts=await mealField.locator('option').evaluateAll(els=>els.map(o=>({label:o.textContent.trim(),value:o.value,disabled:o.disabled})));
    const available=mealOpts.filter(o=>o.value&&!o.disabled&&mealOption(o.label,meal));
    result.steps.push({name:'select-meal-options',matches:available.map(o=>o.label),count:mealOpts.length});
    if(available.length!==1) {
      result.unavailable=available.length===0;
      if(available.length===0) {result.steps.push({name:'meal-unavailable'});return result;}
      throw Error('Refeição ambígua');
    }
    await mealField.selectOption(available[0].value);
    result.forms.beforeSubmit=await fieldInfo(page);
    const before=await resultSnapshot(page);
    result.beforeCandidates=before.map(x=>({tag:x.tag,id:x.id,classes:x.classes,text:x.text.slice(0,500)}));
    const submit=page.getByRole('button',{name:/Consultar Card[aá]pio/i});
    if(await submit.count()!==1) throw Error(`Botão consultar ambíguo/ausente (${await submit.count()})`);
    await submit.click({timeout:10000});
    // Não depender de networkidle; algumas páginas têm requisições recorrentes.
    await page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});
    await sleep(1700);
    await Promise.allSettled(pending);
    result.forms.afterSubmit=await fieldInfo(page);
    result.snapshot=await resultSnapshot(page);
    result.steps.push({name:'submitted',currentURL:page.url(),candidateCount:result.snapshot.length,networkResponses:result.network.length});
    await fs.mkdir(OUT,{recursive:true});
    await page.screenshot({path:path.join(OUT,`${ISO}-${ru}-${meal}.png`),fullPage:true,timeout:8000}).catch(e=>result.errors.push('Screenshot: '+e.message));
  }catch(error){result.errors.push(String(error?.message||error));}
  finally {result.finished=new Date().toISOString();await page.close().catch(()=>{});}
  return result;
}

await fs.mkdir(OUT,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const summary=[];
try {
  for(const ru of IDS) for(const meal of ['almoco','jantar']){
    const result=await collectOne(browser,ru,meal);
    summary.push({ru,meal,errors:result.errors,steps:result.steps,status:result.unavailable?'unavailable':result.errors.length?'error':'captured'});
    await fs.writeFile(path.join(OUT,`${ISO}-${ru}-${meal}.json`),JSON.stringify(result,null,2)+'\n');
    console.log(`${ru}/${meal}: ${summary.at(-1).status}`);
  }
}finally{await browser.close();}
await fs.writeFile(path.join(OUT,`summary-${ISO}.json`),JSON.stringify(summary,null,2)+'\n');
console.log(`Diagnósticos salvos em ${OUT}`);
if(summary.some(r=>r.status==='error')) process.exitCode=1;
