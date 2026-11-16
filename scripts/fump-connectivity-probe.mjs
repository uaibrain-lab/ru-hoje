import {lookup} from 'node:dns/promises';
import {chromium} from 'playwright';
import {dateInBrasilia} from './fump-api.mjs';

const today = dateInBrasilia();
const apiUrl = `https://fump.ufmg.br:3003/cardapios/cardapio?id=6&dataInicio=${today}&dataFim=${today}`;

try {
  const ips = await lookup('fump.ufmg.br',{all:true,verbatim:true});
  console.log(`FUMP_DNS ${ips.map(x=>x.address.includes(':')?'IPv6':'IPv4').join(',')} count=${ips.length}`);
} catch(error) {
  console.log(`FUMP_DNS_ERROR code=${error?.code || error?.name || 'UNKNOWN'}`);
}

const targets = [
  {name:'FUMP_HTTPS_443',url:'https://fump.ufmg.br/cardapio-do-dia/',kind:'html'},
  {name:'FUMP_API_LIST_3003',url:'https://fump.ufmg.br:3003/cardapios/restaurantes',kind:'json'},
  {name:'FUMP_API_RU6_3003',url:apiUrl,kind:'json'},
];

for (const target of targets) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const started = Date.now();
  try {
    const response = await fetch(target.url,{
      signal:controller.signal,
      headers:{Accept:target.kind==='json'?'application/json':'text/html'},
      redirect:'follow'
    });
    const body = await response.text();
    let shape = 'BODY_PRESENT';
    if (target.kind === 'json') {
      try {
        const json = JSON.parse(body);
        shape = Array.isArray(json) ? `ARRAY_LENGTH=${json.length}` :
          `CARDAPIOS=${Array.isArray(json?.cardapios)?json.cardapios.length:'N/A'}`;
      } catch { shape = 'INVALID_JSON'; }
    } else {
      shape = `HTML_BYTES=${Buffer.byteLength(body)}`;
    }
    console.log(`NODE_${target.name} status=HTTP_${response.status} elapsedMs=${Date.now()-started} ${shape}`);
  } catch (error) {
    const cause = error?.cause?.code || error?.code || error?.name || 'UNKNOWN';
    const detail = String(error?.cause?.message || error?.message || '').replace(/[^A-Za-z0-9_ .:/-]/g,'_').slice(0,180);
    console.log(`NODE_${target.name} status=ERROR cause=${String(cause).replace(/[^A-Z0-9_-]/gi,'_')} detail=${detail} elapsedMs=${Date.now()-started}`);
  } finally {
    clearTimeout(timer);
  }
}

let browser;
try {
  browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage({ignoreHTTPSErrors:false});
  for (const target of [
    {name:'CHROMIUM_FUMP_HTTPS_443',url:'https://fump.ufmg.br/cardapio-do-dia/',kind:'html'},
    {name:'CHROMIUM_FUMP_API_RU6_3003',url:apiUrl,kind:'json'}
  ]) {
    const started = Date.now();
    try {
      const response = await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:25000});
      let shape = 'BODY_PRESENT';
      if(target.kind==='json') {
        const json=await page.evaluate(()=>JSON.parse(document.body.innerText));
        shape=`CARDAPIOS=${Array.isArray(json?.cardapios)?json.cardapios.length:'N/A'}`;
      } else {
        shape=`TITLE=${(await page.title()).slice(0,80)}`;
      }
      console.log(`${target.name} status=HTTP_${response?.status() ?? 'NO_RESPONSE'} elapsedMs=${Date.now()-started} ${shape}`);
    } catch(error) {
      const detail=String(error?.message || error).replace(/[^A-Za-z0-9_ .:/-]/g,'_').slice(0,180);
      console.log(`${target.name} status=ERROR detail=${detail} elapsedMs=${Date.now()-started}`);
    }
  }
} catch(error) {
  console.log(`CHROMIUM_LAUNCH_ERROR ${String(error?.message || error).replace(/[^A-Za-z0-9_ .:/-]/g,'_').slice(0,180)}`);
} finally {
  await browser?.close().catch(()=>{});
}
