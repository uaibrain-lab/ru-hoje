import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditPhaseZero} from '../scripts/hub-phase0-readonly-audit.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('auditoria Fase 0 garante contratos críticos sem acessar rede ou mutar produção',()=>{
  const report=auditPhaseZero();
  assert.equal(report.mode,'read-only');
  assert.equal(report.phase,0);
  assert.equal(report.checks.length,8);
  assert.deepEqual(report.failed,[],JSON.stringify(report.checks.filter(x=>!x.pass)));
  assert.equal(report.passed,8);
});

test('auditoria falha caso alguém habilite POST no Worker oficial',()=>{
  const report=auditPhaseZero(path=>path==='worker/fump-proxy.mjs'
    ? read(path).replace("if (request.method!=='GET')","if (request.method==='DELETE')")
    : read(path));
  assert.ok(report.failed.includes('FUMP_FIXED_UPSTREAM'));
});

test('auditoria falha se regras permitirem gravações públicas de cardápios',()=>{
  const report=auditPhaseZero(path=>path==='firestore.rules'
    ? read(path).replace('allow list, create, update, delete: if false;',
      'allow list, create, update, delete: if true;')
    : read(path));
  assert.ok(report.failed.includes('FIRESTORE_MENU_DENY_WRITE'));
});

test('auditoria falha se mudança futura perder o backup de rotas do Interno',()=>{
  const report=auditPhaseZero(path=>path==='backups/interno/rotas-paradas-horarios-2026-11-17.json'
    ? read(path).replace('Escola de Música (Ida)','Escola de Música removida')
    : read(path));
  assert.ok(report.failed.includes('INTERNO_DATA_SNAPSHOT_MATCH'));
});

test('auditoria falha se surgirem sorteios adicionais por agendamento',()=>{
  const report=auditPhaseZero(path=>path==='.github/workflows/hub-production-raffles.yml'
    ? read(path).replace("cron: '10 21 * * 3-5'","cron: '10 21 * * *'")
    : read(path));
  assert.ok(report.failed.includes('RAFFLE_SINGLE_SCHEDULE_GATED'));
});

test('auditoria não exige chaves, Firestore Admin ou acesso ao navegador',()=>{
  const script=read('scripts/hub-phase0-readonly-audit.mjs');
  assert.doesNotMatch(script,/\bfetch\s*\(|https\.request\(|https\.get\(|writeFile|mkdirSync|firebase-admin|Firestore\(/);
});
