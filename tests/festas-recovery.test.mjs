import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {sealPrivateKey,unsealPrivateKey,publicFingerprint} from '../scripts/festas-recovery-crypto.mjs';
const pair=()=>generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:0x10001});
test('recuperação preserva JWK original cifrada para novo destinatario',()=>{
 const source=pair(),dest=pair();
 const original=source.privateKey.export({format:'jwk'}),published=source.publicKey.export({format:'jwk'});
 const recipient=dest.publicKey.export({format:'jwk'});
 const encrypted=sealPrivateKey(original,published,recipient);
 const text=JSON.stringify(encrypted);
 assert.doesNotMatch(text,/"d":/);
 assert.doesNotMatch(text,/PRIVATE KEY/);
 assert.equal(encrypted.recipientPublicSha256,publicFingerprint(recipient));
 const recovered=unsealPrivateKey(encrypted,dest.privateKey.export({type:'pkcs8',format:'pem'}),published);
 assert.equal(recovered.d,original.d);
});
test('recuperação recusa destinatario, fonte ou chave incorreta',()=>{
 const a=pair(),b=pair(),c=pair();
 const orig=a.privateKey.export({format:'jwk'}),pub=a.publicKey.export({format:'jwk'});
 const recipient=b.publicKey.export({format:'jwk'}),wrong=c.publicKey.export({format:'jwk'});
 assert.throws(()=>sealPrivateKey(orig,wrong,recipient),/CHAVE_ORIGINAL/);
 const envelope=sealPrivateKey(orig,pub,recipient);
 assert.throws(()=>unsealPrivateKey(envelope,c.privateKey.export({type:'pkcs8',format:'pem'}),pub));
 assert.throws(()=>unsealPrivateKey({...envelope,tag:'AAAAAAAAAAAAAAAAAAAAAA=='},b.privateKey.export({type:'pkcs8',format:'pem'}),pub));
});
