/**
 * Simula restauração completa de um bundle Git local, sem rede e sem tocar
 * no repositório original. Recebe apenas caminhos de arquivos locais.
 *
 * node scripts/verify-hub-bundle.mjs --bundle "C:\\...\\Hub-UFMG.bundle"
 */
import {readFileSync,existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const run=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:90_000});

export function verifyHubBundle(bundle) {
  const path=resolve(String(bundle||''));
  if(!existsSync(path)||!path.endsWith('.bundle'))
    throw new Error('BUNDLE_AUSENTE_OU_EXTENSAO_INVALIDA');
  const sidecar=path+'.sha256';
  if(!existsSync(sidecar))throw new Error('MANIFESTO_SHA256_AUSENTE');
  const manifest=readFileSync(sidecar,'utf8').trim();
  const match=/^([0-9a-fA-F]{64})\s{2,}(.+)$/.exec(manifest);
  if(!match||match[2]!==basename(path))throw new Error('MANIFESTO_SHA256_INVALIDO');
  const digest=createHash('sha256').update(readFileSync(path)).digest('hex');
  if(digest!==match[1].toLowerCase())throw new Error('BUNDLE_SHA256_DIVERGENTE');
  // git bundle verify exige um diretório Git, e não funciona
  // diretamente da pasta Documents onde guardamos o .bundle.
  const root=mkdtempSync(join(tmpdir(),'hub-restore-check-'));
  try {
    const verifier=join(root,'empty');
    mkdirSync(verifier);
    run(verifier,'init','-q');
    run(verifier,'bundle','verify',path);
    const target=join(root,'restored');
    run(root,'clone','--no-checkout','--quiet',path,target);
    const commit=run(target,'rev-parse','HEAD').trim();
    if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('BUNDLE_SEM_COMMIT_VALIDO');
    for(const required of ['public/index.html','public/service-worker.js',
      'backups/interno/rotas-paradas-horarios-2026-11-17.json',
      'backups/interno/LICENSE-INTERNOROTAS','firestore.rules']){
      const restored=run(target,'show','HEAD:'+required);
      if(!restored.trim())throw new Error('BUNDLE_ARQUIVO_VAZIO: '+required);
    }
    return {status:'VERIFIED_RESTORABLE',commit,sha256:digest};
  }finally {rmSync(root,{recursive:true,force:true});}
}

if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const i=process.argv.indexOf('--bundle');
  try {
    const result=verifyHubBundle(i>=0?process.argv[i+1]:null);
    console.log('HUB_BUNDLE_RESTAURACAO_OK='+JSON.stringify(result));
  }catch(error){
    console.error('HUB_BUNDLE_RESTAURACAO_FALHOU='+String(error?.message||'UNKNOWN'));
    process.exitCode=1;
  }
}
