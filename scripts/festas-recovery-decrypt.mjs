// Uso: node scripts/festas-recovery-decrypt.mjs "C:\caminho\festas-chave-recuperacao.enc.json"
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {unsealPrivateKey} from './festas-recovery-crypto.mjs';
const input=process.argv[2];
if(!input)throw Error('Informe o caminho do JSON criptografado do artifact.');
const dir=join(homedir(),'Documents','HUB-UFMG-SEGREDOS');
const recipientPem=await readFile(join(dir,'destinatario-recuperacao-privada.pem'),'utf8');
const published=JSON.parse(await readFile('public/assets/festas-public-key.json','utf8')).key;
const envelope=JSON.parse(await readFile(input,'utf8'));
const original=unsealPrivateKey(envelope,recipientPem,published);
await mkdir(dir,{recursive:true,mode:0o700});
const target=join(dir,'festas-chave-privada.json');
await writeFile(target,JSON.stringify(original,null,2),{flag:'wx',mode:0o600});
console.log('Chave ORIGINAL recuperada localmente, verificada contra a chave publica atual.');
console.log('Arquivo privado: '+target);
console.log('Guarde copia segura fora da pasta do projeto. Nunca envie este arquivo no chat/GitHub.');
