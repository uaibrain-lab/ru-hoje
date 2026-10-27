// Regras puras compartilhadas pelo navegador e testes. Nenhum dado pessoal em logs.
export const MAX_EVENTS = 40;
export function clean(value, max = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
export function cleanRules(value, max=1800){return String(value ?? '').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,' ').trim().slice(0,max);}
export function handle(value) {
  const s = clean(value, 36).replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) ? s : '';
}
export function httpsUrl(value) {
  const s = clean(value, 1000);
  if (!s) return '';
  try {const u = new URL(s);return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';}
  catch {return '';}
}
export function maskHandle(raw) {
  const s = handle(raw);
  if (!s) return '@••••';
  // Exibir no máximo dois caracteres e nunca a parte final: redução de reidentificação.
  return '@' + s.slice(0, Math.min(2, s.length)) + '••••';
}
export function emailValid(v) {return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v,160));}
export function drawAtMs(event) {
  const value=event?.drawAtTimestamp;
  if(value && typeof value.toMillis==='function')return value.toMillis();
  if(value instanceof Date)return value.getTime();
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string'&&value.trim()){
    const parsed=Date.parse(value);if(Number.isFinite(parsed))return parsed;
  }
  return NaN;
}
export function validateProfile(p) {
  if (clean(p.name,100).length < 3) throw new Error('Informe seu nome completo.');
  if (clean(p.course,100).length < 2) throw new Error('Informe seu curso.');
  if (!emailValid(p.email)) throw new Error('Informe um e-mail válido.');
  if (!handle(p.instagram)) throw new Error('Informe um @ de Instagram válido.');
  if (p.acceptTerms !== true) throw new Error('Leia e aceite as regras e a política de privacidade para participar.');
  return {name:clean(p.name,100),course:clean(p.course,100),email:clean(p.email,160),instagram:handle(p.instagram),marketingConsent:p.marketingConsent===true,acceptedAt:new Date().toISOString()};
}

// Rótulos predefinidos de divulgação; nenhum marcador concede acesso a dados pessoais.
export const EVENT_TAGS = Object.freeze(['Open Bar','Open Food','Festa à fantasia']);
// Tags personalizadas são texto limitado, nunca HTML. Mesmo as pré-definidas passam pela limpeza.
export function normalizeTags(values, limit=8){
  if(!Array.isArray(values))return [];
  const seen=new Set(),out=[];
  for(const raw of values){
    const tag=clean(raw,28).replace(/\s+/g,' ');
    if(tag.length<2 || /[<>\[\]{}]/.test(tag) || seen.has(tag.toLocaleLowerCase('pt-BR')))continue;
    seen.add(tag.toLocaleLowerCase('pt-BR'));out.push(tag);
    if(out.length===Math.max(1,Math.min(30,limit)))break;
  }
  return out;
}
export function maskName(value){
  const words=clean(value,100).split(/\s+/).filter(Boolean);
  return words.length ? words.map(word=>word.slice(0,Math.min(2,word.length))+'•'.repeat(Math.max(3,word.length-2))).join(' ') : '••••';
}
export function csvSafe(value){
  const v=clean(value,256).replace(/[\r\n]+/g,' ');
  const safe=/^[=+\-@\t]/.test(v)?"'"+v:v;
  return '"'+safe.replace(/"/g,'""')+'"';
}
export function drawEligible(values,winnerCount,alternateCount,crypt=globalThis.crypto){
  const winners=Number(winnerCount),alternates=Number(alternateCount);
  if(!Number.isInteger(winners)||winners<1||winners>100||!Number.isInteger(alternates)||alternates<0||alternates>100)throw new Error('Número de ganhadores ou suplentes inválido.');
  const participants=[...new Map(values.map(p=>[handle(p.instagram),p])).values()];
  const selected=secureShuffle(participants,crypt);
  return {winners:selected.slice(0,winners),alternates:selected.slice(winners,winners+alternates),total:participants.length};
}

export function validateEvent(e) {
  const name=clean(e.name,100),place=clean(e.place,130),organizer=clean(e.organizer,100);
  if(name.length<3||place.length<2||organizer.length<2)throw new Error('Informe festa, local e atlética organizadora.');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(e.startsAt||'')||Number.isNaN(Date.parse(e.startsAt)))throw new Error('Data e horário inválidos.');
  const ticketUrl=httpsUrl(e.ticketUrl),posterUrl=httpsUrl(e.posterUrl);
  if(e.ticketUrl&&!ticketUrl)throw new Error('O link dos ingressos deve usar HTTPS.');
  if(e.posterUrl&&!posterUrl)throw new Error('A URL da imagem deve usar HTTPS.');
  const winnerCount=Number(e.winnerCount||0),alternateCount=Number(e.alternateCount||0);
  if(!Number.isInteger(winnerCount)||winnerCount<0||winnerCount>100||!Number.isInteger(alternateCount)||alternateCount<0||alternateCount>100)throw new Error('Ganhadores e suplentes: 0 a 100.');
  const raffleStatus=['disabled','open','closed','drawn'].includes(e.raffleStatus)?e.raffleStatus:'disabled';
  const drawAt=clean(e.drawAt||'',16),rulesText=cleanRules(e.rulesText,1800);
  if(raffleStatus!=='disabled'&&(!winnerCount||!/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.test(drawAt)||!rulesText))throw new Error('Para ativar o sorteio informe regras, horário e ao menos um ganhador.');
  return {name,place,organizer,description:clean(e.description,700),startsAt:e.startsAt,ticketUrl,posterUrl,
    tags:normalizeTags(e.tags),winnerCount,alternateCount,raffleStatus,drawAt,rulesText,
    published:e.published===true,partnerLabel:'Publicidade · Parceria CATM'};
}

export function secureShuffle(values, cryptoObject = globalThis.crypto) {
  const a=values.slice();
  if(!cryptoObject?.getRandomValues)throw new Error('Fonte criptográfica segura indisponível.');
  for(let i=a.length-1;i>0;i--){
    const mod=i+1,range=4294967296,limit=range-(range%mod);
    let n;do {n=cryptoObject.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);
    const j=n%mod;[a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
const enc=new TextEncoder(),dec=new TextDecoder();
const to64=b=>{const array=new Uint8Array(b);let out='';for(const x of array)out+=String.fromCharCode(x);return btoa(out);};
const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function encryptPrivate(profile,publicJwk,subtle=globalThis.crypto?.subtle,rand=globalThis.crypto) {
  if(!subtle || !rand?.getRandomValues)throw new Error('Criptografia indisponível.');
  if(!publicJwk || publicJwk.kty!=='RSA')throw new Error('Chave pública do cadastro ainda não configurada.');
  const key=await subtle.importKey('jwk',publicJwk,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const aes=await subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
  const iv=rand.getRandomValues(new Uint8Array(12));
  const ciphertext=await subtle.encrypt({name:'AES-GCM',iv},aes,enc.encode(JSON.stringify(profile)));
  const raw=await subtle.exportKey('raw',aes);
  const wrapped=await subtle.encrypt({name:'RSA-OAEP'},key,raw);
  return {version:1,algorithm:'RSA-OAEP-SHA256+AES-256-GCM',iv:to64(iv),wrappedKey:to64(wrapped),ciphertext:to64(ciphertext)};
}
export async function decryptPrivate(blob,privateJwk,subtle=globalThis.crypto?.subtle){
  if(!subtle || !privateJwk || privateJwk.kty!=='RSA')throw new Error('Chave privada não carregada.');
  const key=await subtle.importKey('jwk',privateJwk,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
  const raw=await subtle.decrypt({name:'RSA-OAEP'},key,from64(blob.wrappedKey));
  const aes=await subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
  return JSON.parse(dec.decode(await subtle.decrypt({name:'AES-GCM',iv:from64(blob.iv)},aes,from64(blob.ciphertext))));
}
