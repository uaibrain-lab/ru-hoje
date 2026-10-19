/** Auditoria conservadora para impedir publicação de conteúdo evidente da interface. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const IDS=new Set(['setorial-i','setorial-ii','saude','direito','ica']);
const MEALS=new Set(['almoco','jantar','cafe']);
const CONTAMINATION=[
  /valorizamos sua privacidade/i,
  /\b(?:aceitar tudo|aceitar todos|rejeitar tudo|personalizar|configurar cookies|gerenciar cookies|ir para o menu|ir para a busca|ir para o rodap[eé])\b/i,
  /\b(?:card[aá]pios dos rus|pol[ií]tica de privacidade|pol[ií]tica de cookies|assist[eê]ncia estudantil da ufmg)\b/i,
  /\b(?:fump\.ufmg\.br|https?:\/\/|whatsapp|todos os direitos reservados)\b/i,
];
export function auditSnapshot(snapshot) {
  const issues=[];
  if(!snapshot||snapshot.schemaVersion!==1||!snapshot.days||typeof snapshot.days!=='object')return ['Schema inválido'];
  for(const [date,day] of Object.entries(snapshot.days)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))issues.push(`Data inválida: ${date}`);
    for(const [ru,restaurant] of Object.entries(day?.restaurants||{})){
      if(!IDS.has(ru))issues.push(`${date}: restaurante desconhecido: ${ru}`);
      for(const [meal,data] of Object.entries(restaurant?.meals||{})){
        const prefix=`${date}/${ru}/${meal}`;
        if(!MEALS.has(meal))issues.push(`${prefix}: refeição desconhecida`);
        if(ru==='setorial-ii'&&meal==='jantar')issues.push(`${prefix}: Setorial II não serve jantar regular`);
        if(!Array.isArray(data?.items)||data.items.length===0){issues.push(`${prefix}: sem itens`);continue;}
        if(data.items.length>40)issues.push(`${prefix}: itens demais (${data.items.length}), revisão necessária`);
        const names=new Set();
        for(const item of data.items){
          const name=String(item?.name||'').trim();
          if(!name)issues.push(`${prefix}: item vazio`);
          if(CONTAMINATION.some(rx=>rx.test(name)))issues.push(`${prefix}: item contaminado: ${name.slice(0,90)}`);
          const n=name.toLocaleLowerCase('pt-BR');
          if(names.has(n))issues.push(`${prefix}: item duplicado: ${name.slice(0,70)}`);
          names.add(n);
        }
      }
    }
  }
  return issues;
}
const self=path.resolve(fileURLToPath(import.meta.url));
if(process.argv[1]&&path.resolve(process.argv[1])===self){
  const input=process.argv[2];
  if(!input){console.error('Uso: node scripts/audit-menus.mjs caminho/para/cardapios.json');process.exitCode=2;}
  else{
    const parsed=JSON.parse(await fs.readFile(input,'utf8'));
    const issues=auditSnapshot(parsed);
    console.log(JSON.stringify({file:input,ok:issues.length===0,issues},null,2));
    if(issues.length)process.exitCode=1;
  }
}
