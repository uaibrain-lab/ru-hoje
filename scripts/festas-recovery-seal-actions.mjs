// Para uso EXCLUSIVO em workflow temporario de recuperacao, com destinatario fixado
// previamente pelo proprietario do projeto. Nunca escreve JWK privada em logs/artifacts.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {sealPrivateKey,publicFingerprint} from './festas-recovery-crypto.mjs';
if(process.env.GITHUB_ACTIONS!=='true' || process.env.GITHUB_REPOSITORY!=='uaibrain-lab/ru-hoje' || process.env.GITHUB_REF_NAME!=='integracao/firebase-live-20261109')throw Error('AMBIENTE_RECUPERACAO_NAO_AUTORIZADO');
const raw=process.env.HUB_PROD_PRIVATE_KEY_JWK;
if(!raw)throw Error('SEGREDO_ORIGINAL_NAO_CONFIGURADO');
const original=JSON.parse(raw);
const installed=JSON.parse(await readFile('public/assets/festas-public-key.json','utf8')).key;
const receiver=JSON.parse(await readFile('config/festas-recovery-recipient-public.json','utf8'));
if(publicFingerprint(receiver)!=='9446476484bde686c215349c69e597fed5969847b27b537bde9e075df4be1959')throw Error('DESTINATARIO_PUBLICO_DIVERGENTE');
const envelope=sealPrivateKey(original,installed,receiver);
const dir='out-festas-recovery-encrypted';
await mkdir(dir,{recursive:true,mode:0o700});
await writeFile(dir+'/festas-chave-recuperacao.enc.json',JSON.stringify(envelope,null,2),{flag:'wx',mode:0o600});
console.log('Chave ORIGINAL cifrada para o destinatario fixado; artifact contem SOMENTE ciphertext.');
