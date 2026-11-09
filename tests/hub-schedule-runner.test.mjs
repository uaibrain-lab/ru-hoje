import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const enabled=process.platform!=='win32';
const script=new URL('../scripts/hub-production-scheduled-run.sh',import.meta.url).pathname;
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'hub-sync-automated-'));
 const bin=join(dir,'node'),log=join(dir,'node-args.txt'),attempts=join(dir,'attempts.txt');
 writeFileSync(bin,'#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$HUB_ARGS_LOG"\necho attempt >> "$HUB_ATTEMPTS_LOG"\nif [[ "$HUB_FORCE_FAILURE" == "1" ]]; then exit 2; fi\nexit 0\n');
 chmodSync(bin,0o755);
 writeFileSync(join(dir,'sleep'),'#!/usr/bin/env bash\nexit 0\n');chmodSync(join(dir,'sleep'),0o755);
 const env={...process.env,PATH:dir+':'+process.env.PATH,HUB_ARGS_LOG:log,HUB_ATTEMPTS_LOG:attempts,HUB_PROD_SYNC_ENABLED:'true',HUB_PROD_PUBLISH_ENABLED:'true',HUB_PROD_MODE:'apply',HUB_FORCE_FAILURE:'0'};
 return {dir,log,attempts,env,run:()=>spawnSync('bash',[script],{env,encoding:'utf8',timeout:10000})};
}
test('runner apply autorizado inclui confirmacao e roda uma vez', {skip:!enabled},()=>{
 const f=fixture();try{
 const r=f.run();assert.equal(r.status,0,r.stderr||r.stdout);
 assert.match(readFileSync(f.log,'utf8'),/--mode=apply --days=7 --confirm=PUBLICAR_SOMENTE_HUB_UFMG/);
 assert.equal(readFileSync(f.attempts,'utf8').trim().split('\n').length,1);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('runner impede publicacao com gate desligado', {skip:!enabled},()=>{
 const f=fixture();try{
 f.env.HUB_PROD_PUBLISH_ENABLED='false';const r=f.run();
 assert.notEqual(r.status,0);assert.match(r.stdout,/HUB_PROD_PUBLISH_ENABLED desativado/);assert.equal(existsSync(f.log),false);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('runner dry-run nao requer autorizacao para publicar', {skip:!enabled},()=>{
 const f=fixture();try{
 f.env.HUB_PROD_PUBLISH_ENABLED='false';f.env.HUB_PROD_MODE='dry-run';
 const r=f.run();assert.equal(r.status,0,r.stderr||r.stdout);
 const args=readFileSync(f.log,'utf8');assert.match(args,/--mode=dry-run --days=7/);assert.doesNotMatch(args,/--confirm=/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('runner falha apos 3 tentativas limitadas', {skip:!enabled},()=>{
 const f=fixture();try{
 f.env.HUB_FORCE_FAILURE='1';const r=f.run();assert.notEqual(r.status,0);
 assert.equal(readFileSync(f.attempts,'utf8').trim().split('\n').length,3);assert.match(r.stdout,/falhou apos 3 tentativas/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
