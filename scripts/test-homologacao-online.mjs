import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const url = process.env.RU_QA_URL || 'https://bandeco-homologacao--qa-v259-u5ekbz1b.web.app/';
const widths = [360, 390, 768, 1440];
const diagnosticsDir = new URL('../diagnostics/', import.meta.url);
const results = [];
const browser = await chromium.launch({headless: true});

for (const width of widths) {
  const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
  const page = await context.newPage();
  const requests = new Set();
  const httpFailures = [];
  const consoleErrors = [];
  page.on('request', request => requests.add(request.url()));
  page.on('response', response => { if (response.status() >= 400) httpFailures.push({url: response.url(), status: response.status()}); });
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => consoleErrors.push(error.message));
  await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000});
  await page.locator('#restaurant-dialog').waitFor({state: 'visible', timeout: 15000});
  const initial = await page.evaluate(() => ({
    title: document.title,
    robots: document.querySelector('meta[name="robots"]')?.content || '',
    banner: document.querySelector('.homologation-banner')?.textContent?.trim() || '',
    projectId: window.RU_CONFIG?.firebaseWeb?.projectId || '',
    currentHost: location.hostname,
    optionCount: document.querySelectorAll('#restaurant-options button').length
  }));
  const firstOption = page.locator('#restaurant-options button').first();
  if (await firstOption.count()) await firstOption.click();
  await page.waitForTimeout(500);
  const afterSelect = await page.locator('#current-restaurant').textContent();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await page.screenshot({path: fileURLToPath(new URL(`online-${width}.png`, diagnosticsDir)), fullPage: true});
  const productionRequests = [...requests].filter(requestUrl => /cardapioufmg|firebaseio\.com\/|googleapis\.com\/firestore/i.test(requestUrl));
  const expectedMenuMiss = httpFailures.length === 1 && httpFailures[0].status === 404 && httpFailures[0].url.endsWith('/documents/publicMenus/current');
  const effectiveConsoleErrors = expectedMenuMiss && consoleErrors.every(error => error.includes('404')) ? [] : consoleErrors;
  results.push({width, initial, afterSelect: afterSelect?.trim() || '', overflow, consoleErrors: effectiveConsoleErrors, expectedMenuMiss, httpFailures, requestCount: requests.size, productionRequests});
  await context.close();
}

await browser.close();
await fs.mkdir(diagnosticsDir, {recursive: true});
await fs.writeFile(new URL('homologacao-online.json', diagnosticsDir), JSON.stringify({url, testedAt: new Date().toISOString(), results}, null, 2));
if (results.some(result => result.initial.projectId !== 'bandeco-homologacao' || result.initial.robots !== 'noindex,nofollow,noarchive' || result.initial.optionCount !== 5 || result.overflow || result.productionRequests.length || result.consoleErrors.length || !result.afterSelect)) {
  process.exitCode = 1;
}
console.log(JSON.stringify({url, results}, null, 2));
