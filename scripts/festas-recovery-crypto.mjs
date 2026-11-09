// Reempacotamento criptografado, sem imprimir nem enviar a chave privada em texto puro.
import {createHash, createPublicKey, publicEncrypt, privateDecrypt, randomBytes, createCipheriv, createDecipheriv, constants} from 'node:crypto';
const domain=Buffer.from('hubufmg-festas-key-recovery-v1','utf8');
const pubParts=j=>({kty:j?.kty,n:j?.n,e:j?.e});
const equals=(a,b)=>a?.kty==='RSA'&&b?.kty==='RSA'&&a.n===b.n&&a.e===b.e;
export function publicFingerprint(jwk){
  return createHash('sha256').update(JSON.stringify(pubParts(jwk)),'utf8').digest('hex');
}
function checkSource(source,expectedPublic){
  if(!source||source.kty!=='RSA'||!source.d||!equals(source,expectedPublic))throw Error('CHAVE_ORIGINAL_NAO_CORRESPONDE_A_PUBLICADA');
}
export function sealPrivateKey(source,expectedPublic,recipientPublic){
  checkSource(source,expectedPublic);
  if(recipientPublic?.kty!=='RSA'||!recipientPublic.n||!recipientPublic.e||recipientPublic.d)throw Error('DESTINATARIO_INVALIDO');
  const key=createPublicKey({key:recipientPublic,format:'jwk'});
  if((key.asymmetricKeyDetails?.modulusLength||0)<3072)throw Error('RSA_DESTINATARIO_MENOR_QUE_3072');
  const aes=randomBytes(32),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',aes,iv);cipher.setAAD(domain);
  const data=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(source),'utf8')),cipher.final()]);
  const wrapped=publicEncrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},aes);
  return {schemaVersion:1,scheme:'RSA-OAEP-SHA256+AES-256-GCM',purpose:'hubufmg-festas-recover-original-private-key',
    recipientPublicSha256:publicFingerprint(recipientPublic),originalPublicSha256:publicFingerprint(expectedPublic),
    wrappedKey:wrapped.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:data.toString('base64')};
}
export function unsealPrivateKey(envelope,recipientPrivatePem,expectedPublic){
  if(envelope?.schemaVersion!==1||envelope?.scheme!=='RSA-OAEP-SHA256+AES-256-GCM'||envelope?.purpose!=='hubufmg-festas-recover-original-private-key')throw Error('FORMATO_RECUPERACAO_INVALIDO');
  const key=privateDecrypt({key:recipientPrivatePem,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64'));
  const dec=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
  dec.setAAD(domain);dec.setAuthTag(Buffer.from(envelope.tag,'base64'));
  const plain=Buffer.concat([dec.update(Buffer.from(envelope.ciphertext,'base64')),dec.final()]);
  const source=JSON.parse(plain.toString('utf8'));
  checkSource(source,expectedPublic);
  if(envelope.originalPublicSha256!==publicFingerprint(expectedPublic))throw Error('CHAVE_PUBLICA_DIVERGENTE');
  return source;
}
