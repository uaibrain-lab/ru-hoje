// Execute localmente: node scripts/generate-festas-keys.mjs
// A chave privada jamais deve ser publicada, enviada para Git ou Firebase.
import {webcrypto} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const pair=await webcrypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
const pub=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
const priv=await webcrypto.subtle.exportKey('jwk',pair.privateKey);
await fs.mkdir('private',{recursive:true});
const file=path.resolve('private/festas-chave-privada.json');
try{await fs.writeFile(file,JSON.stringify(priv,null,2),{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')throw new Error('Já existe chave privada: não substituí-la!');throw e;}
await fs.writeFile('public/assets/festas-public-key.json',JSON.stringify({key:pub},null,2));
console.log('Chaves geradas: pública em public/assets/festas-public-key.json; PRIVADA somente em private/festas-chave-privada.json');
