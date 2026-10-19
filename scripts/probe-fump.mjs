/**
 * Diagnóstico não invasivo de conectividade com a página pública da FUMP.
 * Não preenche formulários, não executa coleta de cardápios, não grava em nuvem.
 * Saída: diagnostics/fump-network/diagnostic.json e screenshot opcional.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import dns from 'node:dns/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const SOURCE = 'https://fump.ufmg.br/cardapio-do-dia/';
const OUT_DIR = path.resolve('diagnostics/fump-network');
const REQUEST_TIMEOUT = 14000;
const output = {
  schemaVersion: 1,
  source: SOURCE,
  timestamp: new Date().toISOString(),
  environment: {platform: process.platform, release: os.release(), node: process.version, arch: process.arch},
  dns: {},
  https: {},
  browser: {},
};
const shortError = (e) => ({code: String(e?.code ?? 'UNKNOWN'), message: String(e?.message ?? e).slice(0, 750)});
const ms = t => Math.round(performance.now() - t);

async function resolveDns() {
  const name = new URL(SOURCE).hostname;
  const queries = {
    lookup: () => dns.lookup(name, {all: true}),
    a: () => dns.resolve4(name),
    aaaa: () => dns.resolve6(name),
  };
  for (const [key, query] of Object.entries(queries)) {
    const t = performance.now();
    try { output.dns[key] = {ok: true, elapsedMs: ms(t), result: await Promise.race([
      query(), new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('DNS_TIMEOUT'), {code: 'DNS_TIMEOUT'})), 6000)),
    ])}; }
    catch (e) { output.dns[key] = {ok: false, elapsedMs: ms(t), error: shortError(e)}; }
  }
}

function requestWithFamily(family) {
  return new Promise(resolve => {
    const t = performance.now();
    const phases = {};
    let finished = false;
    const record = {family, ok: false, phases};
    const done = () => {if (finished) return; finished = true; record.elapsedMs = ms(t); resolve(record);};
    const req = https.request(SOURCE, {
      method: 'GET', family, timeout: REQUEST_TIMEOUT,
      headers: {'User-Agent': 'RUHoje-Diagnostic/1.0 (authorized CATM UFMG; GitHub Actions network check)', 'Accept': 'text/html'},
    }, res => {
      record.status = res.statusCode;
      record.contentType = String(res.headers['content-type'] || '').slice(0, 100);
      record.redirectLocation = String(res.headers.location || '').slice(0, 250) || null;
      record.ok = Number(res.statusCode) >= 200 && Number(res.statusCode) < 400;
      let read = 0;
      res.on('data', chunk => {read += chunk.length; if(read > 4096) res.destroy();});
      res.on('end', done);
      res.on('close', done);
    });
    req.on('socket', socket => {
      socket.on('lookup', (err, address, ipFamily) => {
        phases.lookupMs = ms(t); phases.lookupCode = err?.code || null;
        phases.address = address || null; phases.addressFamily = ipFamily || null;
      });
      socket.on('connect', () => {phases.tcpMs = ms(t);});
      socket.on('secureConnect', () => {phases.tlsMs = ms(t); phases.tlsAuthorized = socket.authorized; phases.tlsAuthorizationError = socket.authorizationError || null;});
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('REQUEST_TIMEOUT'), {code: 'REQUEST_TIMEOUT'})));
    req.on('error', err => {record.error = shortError(err); done();});
    req.end();
  });
}

async function probeChromium() {
  const t = performance.now();
  let browser;
  try {
    browser = await chromium.launch({headless: true});
    const context = await browser.newContext({locale:'pt-BR', timezoneId:'America/Sao_Paulo'});
    const page = await context.newPage();
    const reqErrors = [];
    page.on('requestfailed', request => {
      if (reqErrors.length < 12) reqErrors.push({url: request.url().slice(0, 240), error: request.failure()?.errorText?.slice(0, 180) || 'request failed'});
    });
    const response = await page.goto(SOURCE, {waitUntil:'commit', timeout:REQUEST_TIMEOUT});
    output.browser.committed = true;
    output.browser.httpStatus = response?.status() ?? null;
    output.browser.finalUrl = page.url().slice(0, 250);
    try {
      await page.locator('select').first().waitFor({state: 'attached', timeout: 8000});
      const form = await page.evaluate(() => ({
        title: document.title.slice(0, 130),
        selects: document.querySelectorAll('select').length,
        inputs: document.querySelectorAll('input').length,
        hasSubmit: [...document.querySelectorAll('button,input[type="submit"]')].some(el => /consultar card[aá]pio/i.test(el.textContent || el.value || '')),
      }));
      output.browser.form = form;
      output.browser.ok = response?.ok() === true && form.selects >= 1 && form.hasSubmit;
      if (output.browser.ok) await page.screenshot({path: path.join(OUT_DIR, 'fump-form.png'), fullPage: false, timeout: 4000}).catch(() => {});
    } catch (e) {
      output.browser.formError = shortError(e);
      output.browser.ok = false;
    }
    output.browser.requestFailures = reqErrors;
    await context.close();
  } catch (e) {
    output.browser.ok = false;
    output.browser.error = shortError(e);
  } finally {
    output.browser.elapsedMs = ms(t);
    await browser?.close().catch(() => {});
  }
}

await fs.mkdir(OUT_DIR, {recursive: true});
try {
  await resolveDns();
  const responses = await Promise.allSettled([requestWithFamily(4), requestWithFamily(6)]);
  output.https.ipv4 = responses[0].status === 'fulfilled' ? responses[0].value : {error: shortError(responses[0].reason)};
  output.https.ipv6 = responses[1].status === 'fulfilled' ? responses[1].value : {error: shortError(responses[1].reason)};
  await probeChromium();
} catch (e) {
  output.unexpectedError = shortError(e);
} finally {
  output.summary = output.browser.ok ? 'BROWSER_FORM_OK' :
    (output.https.ipv4?.ok || output.https.ipv6?.ok) ? 'HTTPS_REACHABLE_BROWSER_FAILED' :
    'HTTPS_NOT_CONFIRMED';
  await fs.writeFile(path.join(OUT_DIR, 'diagnostic.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({summary: output.summary, dns: output.dns, https: output.https, browser: output.browser}, null, 2));
  console.log(`Diagnóstico salvo em ${OUT_DIR}`);
  if (!output.browser.ok) process.exitCode = 1;
}
