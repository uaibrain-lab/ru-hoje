/** Diagnóstico somente-leitura de rede e formulário oficial da FUMP.
 * Executar: node scripts/probe-fump-local.mjs
 * Não grava Firestore, não autentica, não envia dados a terceiros.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'fump.ufmg.br';
const URL = 'https://fump.ufmg.br/cardapio-do-dia/';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'diagnostics');
const report = { source: URL, at: new Date().toISOString(), network: {}, http: {}, chromium: {}, errors: [] };
await fs.mkdir(OUT, {recursive:true});

const ms = t => Math.round(performance.now() - t);
function errinfo(err) { return { code: String(err?.code || err?.name || 'ERROR'), message: String(err?.message || err).slice(0, 350) }; }
function tcpProbe(timeoutMs = 10000) {
  return new Promise(resolve => {
    const started = performance.now();
    const socket = net.createConnection({host: HOST, port: 443});
    let done = false;
    const finish = value => { if (done) return; done = true; socket.destroy(); resolve({ ...value, elapsedMs: ms(started) }); };
    socket.setTimeout(timeoutMs, () => finish({ok: false, error: {code: 'TCP_TIMEOUT', message: `Sem resposta em ${timeoutMs} ms`}}));
    socket.once('connect', () => finish({ok: true, remoteAddress: socket.remoteAddress}));
    socket.once('error', e => finish({ok: false, error: errinfo(e)}));
  });
}
function tlsProbe(timeoutMs = 10000) {
  return new Promise(resolve => {
    const started = performance.now();
    const socket = tls.connect({host: HOST, port: 443, servername: HOST, rejectUnauthorized: true});
    let done = false;
    const finish = value => { if (done) return; done = true; socket.destroy(); resolve({ ...value, elapsedMs: ms(started) }); };
    socket.setTimeout(timeoutMs, () => finish({ok: false, error: {code: 'TLS_TIMEOUT', message: `Sem TLS em ${timeoutMs} ms`}}));
    socket.once('secureConnect', () => finish({ok: true, authorized: socket.authorized, protocol: socket.getProtocol(), remoteAddress: socket.remoteAddress}));
    socket.once('error', e => finish({ok: false, error: errinfo(e)}));
  });
}

try { report.network.dns = {ok: true, addresses: (await dns.lookup(HOST, {all:true})).map(({address, family}) => ({address, family}))}; }
catch(e) { report.network.dns = {ok:false, error:errinfo(e)}; }
report.network.tcp443 = await tcpProbe();
report.network.tls443 = await tlsProbe();

try {
  const t = performance.now();
  const response = await fetch(URL, {signal: AbortSignal.timeout(16000), headers: {Accept:'text/html'}});
  const body = (await response.text()).slice(0, 1500000);
  report.http = {ok: response.ok, status: response.status, elapsedMs: ms(t), finalHost: new URL(response.url).hostname,
    contentType: response.headers.get('content-type'), bytesRead: body.length,
    selectCount: (body.match(/<select\b/ig)||[]).length,
    formCount: (body.match(/<form\b/ig)||[]).length,
    hasConsultButton: /Consultar\s+Card[aá]pio/i.test(body),
    hasWafChallenge: /Just a moment|Checking your browser|Attention Required/i.test(body)};
} catch(e) {report.http = {ok:false,error:errinfo(e)};}

let browser;
try {
  const {chromium} = await import('playwright');
  const t = performance.now();
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({locale:'pt-BR', timezoneId:'America/Sao_Paulo', ignoreHTTPSErrors:false});
  const page = await context.newPage();
  const failed = [];
  page.on('requestfailed', req => {
    try {failed.push({host:new URL(req.url()).host, kind:req.resourceType(), error:req.failure()?.errorText?.slice(0,150) || ''});}
    catch {};
  });
  try {
    const resp = await page.goto(URL, {waitUntil:'commit',timeout:20000});
    const status = resp?.status() || null;
    let selectorPresent = false;
    try {await page.locator('select').first().waitFor({state:'attached', timeout:12000}); selectorPresent = true;}
    catch {}
    const form = await page.evaluate(() => ({
      title: document.title.slice(0,120),
      selectCount: document.querySelectorAll('select').length,
      selects: [...document.querySelectorAll('select')].slice(0,6).map(s => ({name:s.name, id:s.id, labels:[...s.options].map(o=>(o.textContent||'').trim().slice(0,70)).slice(0,30)})),
      inputs:[...document.querySelectorAll('input')].slice(0,12).map(i => ({name:i.name, id:i.id, type:i.type, placeholder:i.placeholder})),
      buttons:[...document.querySelectorAll('button')].slice(0,12).map(b => (b.textContent||'').trim().slice(0,100))
    }));
    report.chromium = {ok:selectorPresent, status, elapsedMs:ms(t), form, failedRequests:failed.slice(0,20)};
    await page.screenshot({path:path.join(OUT,'fump-local-form.png'),fullPage:true, timeout:5000}).catch(()=>{});
  } catch (e) {report.chromium = {ok:false, elapsedMs:ms(t), error:errinfo(e), failedRequests:failed.slice(0,20)};}
  await context.close();
} catch(e) {report.chromium = {ok:false, error:errinfo(e)};}
finally {if(browser) await browser.close().catch(()=>{});}

await fs.mkdir(OUT,{recursive:true});
const target = path.join(OUT,'fump-local-probe.json');
await fs.writeFile(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
console.log(`\nRelatório: ${target}`);
process.exitCode = report.chromium.ok ? 0 : 2;
