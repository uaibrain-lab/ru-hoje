import fs from 'node:fs/promises';
import {classifyFreshness, compareContent} from './ocupa-qa-schedule-core.mjs';

const args = new Map(process.argv.slice(2).filter(x => x.startsWith('--')).map(x => {const [k, ...v] = x.slice(2).split('='); return [k, v.join('=')];}));
if (!args.get('file')) throw new Error('ARQUIVO_JSON_OBRIGATORIO');
const input = JSON.parse(await fs.readFile(args.get('file'), 'utf8'));
if (args.has('dry-run')) {
  if (!Number.isInteger(input.plannedWrites) || !input.remoteUpdateTime) throw new Error('DRY_RUN_SEM_METADADOS');
  console.log(JSON.stringify({freshness: input.plannedWrites ? 'OK' : 'SEM_ALTERACOES', comparison: input.plannedWrites ? 'OK' : 'SEM_ALTERACOES', generatedAt: null, updateTime: input.remoteUpdateTime, dates: Number(input.mergedDays || 0), plannedWrites: input.plannedWrites, remoteWrites: 0}));
} else {
  const freshness = classifyFreshness(input);
  const comparison = compareContent(input);
  console.log(JSON.stringify({freshness, comparison, generatedAt: input.generatedAt || null, updateTime: input.updateTime || null, dates: Array.isArray(input.availableDates) ? input.availableDates.length : 0, remoteWrites: 0}));
}
