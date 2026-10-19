/**
 * Gate de integridade entre a coleta HTTP e o publicador do RU Hoje.
 * Não escreve por padrão. A opção --out escreve SOMENTE no JSON estático local
 * da workspace e NÃO realiza chamadas Firebase/GitHub/HTTP.
 *
 * Esta auditoria valida a consistência interna da coleta. A equivalência com
 * a FUMP deve ser verificada em produção antes de autorizar a publicação.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RU_SOURCES, SOURCE_PAGE, assertIsoDate, dateInBrasilia, addDate,
  checkRestaurantList, parseMenuJson,
} from './fump-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = path.join(ROOT, 'diagnostics/fump-api');
const ALLOWED_OUT = path.join(ROOT, 'public/data/cardapios.json');
const fail = msg => { throw new Error(`Coleta não publicável: ${msg}`); };
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isoTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /Z$/.test(value);
const canonical = obj => JSON.stringify(obj);

async function readJson(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch (e) { fail(`arquivo ausente/inacessível: ${path.basename(file)} (${e.code ?? 'erro'})`); }
  try { return JSON.parse(text); }
  catch { fail(`JSON inválido: ${path.basename(file)}`); }
}

/** Reconstrói e compara o candidato com as respostas brutas oficiais. */
export async function auditApiDiagnostics(dir = DEFAULT_DIR, { requireToday = false, todayIso = dateInBrasilia() } = {}) {
  const [summary, candidate, restaurants] = await Promise.all([
    readJson(path.join(dir, 'summary.json')),
    readJson(path.join(dir, 'candidate.json')),
    readJson(path.join(dir, 'raw-restaurantes.json')),
  ]);
  checkRestaurantList(restaurants);
  if (summary?.mode !== 'diagnostico-sem-publicacao' || !Array.isArray(summary.rows)) fail('sumário desconhecido');
  if (!Array.isArray(summary.failures) || summary.failures.length) fail('existem falhas de coleta');
  if (candidate?.schemaVersion !== 1 || candidate?.source !== SOURCE_PAGE || !isoTime(candidate.generatedAt)) fail('snapshot fora do esquema');
  if (!candidate.days || typeof candidate.days !== 'object' || Array.isArray(candidate.days)) fail('dias fora do esquema');
  const rows = summary.rows;
  if (!rows.length || rows.length > RU_SOURCES.length * 7) fail('quantidade de linhas inesperada');
  if (summary.success + summary.empty !== rows.length || summary.success < 1) fail('contagens inconsistentes ou nenhuma refeição');

  const dateSet = new Set(rows.map(row => assertIsoDate(row.iso)));
  const dates = [...dateSet].sort();
  if (!dates.length || dates.length > 7) fail('quantidade de dias inesperada');
  if (requireToday && dates[0] !== todayIso) fail(`primeiro dia ${dates[0]} não corresponde a hoje em Brasília`);
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] !== addDate(dates[i - 1], 1)) fail('dias não consecutivos');
  }
  if (rows.length !== dates.length * RU_SOURCES.length) fail('nem todas as quatro fontes foram consultadas em todos os dias');

  const seen = new Set();
  const expectedDays = {};
  let captured = 0;
  let empty = 0;
  for (const row of rows) {
    const source = RU_SOURCES.find(item => item.sourceId === String(row.sourceId));
    if (!source) fail(`ID de fonte inesperado: ${row.sourceId}`);
    const signature = `${row.iso}/${source.sourceId}`;
    if (seen.has(signature)) fail(`fonte duplicada: ${signature}`);
    seen.add(signature);
    if (row.meta?.ignored !== 0) fail(`pratos/refeições ignorados em ${signature}`);

    const raw = await readJson(path.join(dir, `raw-${row.iso}-id${source.sourceId}.json`));
    const { meals, meta } = parseMenuJson(raw, { iso: row.iso, sourceId: source.sourceId });
    if (meta.ignored !== 0) fail(`dados inesperados no JSON bruto de ${signature}`);
    if (row.meta?.cardapios !== meta.cardapios) fail(`metadados inconsistentes em ${signature}`);

    const keys = Object.keys(meals).sort();
    if (!keys.length) {
      if (row.status !== 'sem cardapio') fail(`fonte vazia marcada como preenchida: ${signature}`);
      empty++;
      continue;
    }
    if (row.status !== 'capturado-nao-validado') fail(`fonte preenchida com status desconhecido: ${signature}`);
    captured++;
    for (const appId of source.appIds) {
      const ru = candidate.days?.[row.iso]?.restaurants?.[appId];
      if (!ru || String(ru.sourceRestaurantId) !== source.sourceId || !isoTime(ru.fetchedAt)) {
        fail(`RU sem metadados da origem: ${row.iso}/${appId}`);
      }
      const actualKeys = Object.keys(ru.meals || {}).sort();
      if (canonical(actualKeys) !== canonical(keys)) fail(`refeições divergentes: ${row.iso}/${appId}`);
      for (const key of keys) {
        const real = ru.meals[key];
        if (!isoTime(real?.fetchedAt)) fail(`timestamp da refeição inválido: ${row.iso}/${appId}/${key}`);
        if (canonical(real.items) !== canonical(meals[key].items)) fail(`pratos divergentes do JSON bruto: ${row.iso}/${appId}/${key}`);
      }
      const expected = expectedDays[row.iso] ||= { restaurants: {} };
      expected.restaurants[appId] = {
        meals: Object.fromEntries(keys.map(key => [key, {items:meals[key].items, fetchedAt:ru.meals[key].fetchedAt}])),
        fetchedAt: ru.fetchedAt,
        sourceRestaurantId: source.sourceId,
      };
    }
  }
  if (captured !== summary.success || empty !== summary.empty) fail('soma de fontes capturadas e vazias não confere');

  // Compara só o conteúdo (não a ordem incidental de inserção das chaves JSON).
  const normal = obj => {
    if (Array.isArray(obj)) return obj.map(normal);
    if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, normal(v)]));
    return obj;
  };
  if (canonical(normal(candidate.days)) !== canonical(normal(expectedDays))) {
    fail('snapshot contém RUs, datas ou campos que não provêm das respostas validadas');
  }
  const size = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
  if (size > 700_000) fail(`snapshot excessivo: ${size} bytes`);
  return { snapshot: candidate, report: { dates, sourcesPerDay: RU_SOURCES.length, captured, empty, bytes: size, checkedAt: new Date().toISOString() } };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some(arg => !['--input', '--out', '--require-today', '--stage-local-json'].includes(arg) && !argv.some((x,i) => ['--input','--out'].includes(x) && argv[i+1]===arg))) {
    fail('uso: --input diagnostics/fump-api [--require-today] [--out public/data/cardapios.json --stage-local-json]');
  }
  const val = key => { const i = argv.indexOf(key); return i < 0 ? null : argv[i + 1]; };
  const dir = val('--input') ? path.resolve(val('--input')) : DEFAULT_DIR;
  const { snapshot, report } = await auditApiDiagnostics(dir, { requireToday: argv.includes('--require-today') });
  console.log(`Auditoria aprovada: ${report.captured} fontes preenchidas, ${report.empty} vazias, ${report.dates.length} dia(s), ${report.bytes} bytes.`);
  const out = val('--out');
  if (out) {
    if (!argv.includes('--stage-local-json') || path.resolve(out) !== ALLOWED_OUT) {
      fail('a escrita requer --stage-local-json e só é permitida em public/data/cardapios.json');
    }
    const tmp = `${ALLOWED_OUT}.tmp-${process.pid}`;
    try {
      await fs.writeFile(tmp, JSON.stringify(snapshot,null,2)+'\n', { flag: 'wx' });
      await fs.rename(tmp, ALLOWED_OUT);
    } finally { await fs.rm(tmp,{force:true}); }
    console.log('Candidato preparado APENAS no filesystem local. Nenhuma publicação Firebase efetuada.');
  } else console.log('Modo somente leitura: public/data/cardapios.json permaneceu intacto.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}
