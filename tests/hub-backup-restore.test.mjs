import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyHubBundle} from '../scripts/verify-hub-bundle.mjs';

test('backup independente restaura em diretório isolado; corrupção do SHA256 falha fechado',()=>{
  const root=mkdtempSync(join(tmpdir(),'hub-bundle-test-'));
  try {
    const origin=join(root,'source');mkdirSync(origin);
    const git=(...args)=>execFileSync('git',args,{cwd:origin,encoding:'utf8'});
    git('init','-q','-b','main');
    git('config','user.name','Teste Hub');
    git('config','user.email','test@example.invalid');
    for(const f of [
      'public/index.html','public/service-worker.js',
      'backups/interno/rotas-paradas-horarios-2026-11-17.json',
      'backups/interno/LICENSE-INTERNOROTAS','firestore.rules'
    ]){
      mkdirSync(dirname(join(origin,f)),{recursive:true});
      writeFileSync(join(origin,f),'fixture seguro para '+f);
    }
    git('add','.');git('commit','-qm','Fixture de restauração');
    const bundle=join(root,'hub.bundle');
    git('bundle','create',bundle,'--all');
    const hash=createHash('sha256').update(readFileSync(bundle)).digest('hex');
    const sidecar=bundle+'.sha256';
    writeFileSync(sidecar,hash+'  hub.bundle\n');
    const output=verifyHubBundle(bundle);
    assert.equal(output.status,'VERIFIED_RESTORABLE');
    assert.equal(output.sha256,hash);
    assert.equal(output.commit,git('rev-parse','HEAD').trim());
    writeFileSync(sidecar,'0'.repeat(64)+'  hub.bundle\n');
    assert.throws(()=>verifyHubBundle(bundle),/BUNDLE_SHA256_DIVERGENTE/);
    writeFileSync(sidecar,hash+'  arquivo-trocado.bundle\n');
    assert.throws(()=>verifyHubBundle(bundle),/MANIFESTO_SHA256_INVALIDO/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
