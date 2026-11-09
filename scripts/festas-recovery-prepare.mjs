// Execute no proprio computador: node scripts/festas-recovery-prepare.mjs
// Esta chave e APENAS para receber a antiga, que ja esta salva no GitHub Secrets.
import {generateKeyPairSync} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const dir=join(homedir(),'Documents','HUB-UFMG-SEGREDOS');
const priv=join(dir,'destinatario-recuperacao-privada.pem');
const pub=join(dir,'destinatario-recuperacao-PUBLICA.json');
await mkdir(dir,{recursive:true,mode:0o700});
if(existsSync(priv)||existsSync(pub))throw Error('RECUPERACAO_JA_PREPARADA: proteja os arquivos existentes, nao sobrescreva.');
const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:0x10001});
const pubJwk=keys.publicKey.export({format:'jwk'});
await writeFile(priv,keys.privateKey.export({format:'pem',type:'pkcs8'}),{flag:'wx',mode:0o600});
await writeFile(pub,JSON.stringify(pubJwk,null,2),{flag:'wx',mode:0o644});
console.log('Chave de recebimento criada. O arquivo PRIVADO permanece SOMENTE em: '+priv);
console.log('Arquivo PUBLICO que voce pode compartilhar para a recuperacao: '+pub);
console.log('NAO ENVIE O .pem PRIVADO, nem gere novamente o par original das Festas.');
