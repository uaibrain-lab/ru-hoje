/** Atualiza somente o fallback local com a coleta oficial já diagnosticada. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeSnapshots} from './merge-snapshots.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fallbackPath = path.join(root, 'public', 'data', 'cardapios.json');
const candidatePath = path.join(root, 'diagnostics', 'fump-api', 'candidate.json');
const summaryPath = path.join(root, 'diagnostics', 'fump-api', 'summary.json');
const [fallback, candidate, summary] = await Promise.all([
  fs.readFile(fallbackPath, 'utf8').then(JSON.parse),
  fs.readFile(candidatePath, 'utf8').then(JSON.parse),
  fs.readFile(summaryPath, 'utf8').then(JSON.parse),
]);
if (!Array.isArray(summary.failures) || summary.failures.length) throw new Error('COLETA_OFICIAL_COM_FALHAS');
const byDate = new Map();
for (const row of summary.rows || []) {
  if (!byDate.has(row.iso)) byDate.set(row.iso, new Set());
  byDate.get(row.iso).add(String(row.sourceId));
}
const verifiedCompleteDates = [...byDate.entries()]
  .filter(([, sources]) => sources.size === 4)
  .map(([date]) => date)
  .sort();
if (!verifiedCompleteDates.length) throw new Error('NENHUMA_DATA_COMPLETA');
for (const date of verifiedCompleteDates) candidate.days[date] ||= {restaurants: {}};
const merged = mergeSnapshots(fallback, {...candidate, verifiedCompleteDates});
merged.verifiedCompleteDates = verifiedCompleteDates;
await fs.writeFile(fallbackPath, JSON.stringify(merged, null, 2) + '\n');
console.log(JSON.stringify({fallbackPath, generatedAt: merged.generatedAt, days: Object.keys(merged.days).length, verifiedCompleteDates: verifiedCompleteDates.length}));
