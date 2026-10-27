// Ajusta scripts e configuração existentes SEM descartar valores locais. Somente local.
import fs from 'node:fs/promises';
const pkg='package.json';const data=JSON.parse(await fs.readFile(pkg,'utf8'));
data.scripts??={};
Object.assign(data.scripts,{
  'test:festas':'node scripts/test-festas-local.mjs',
  'test:festas:security':'firebase emulators:exec --config firebase.emulators.json --project demo-bandeco --only auth,firestore "node scripts/test-festas-security-emulator.mjs"',
  'keys:festas':'node scripts/generate-festas-keys.mjs'
});
await fs.writeFile(pkg,JSON.stringify(data,null,2)+'\n');
const ignore='.gitignore';let ignored='';try{ignored=await fs.readFile(ignore,'utf8');}catch{}
if(!ignored.split(/\r?\n/).includes('private/'))await fs.appendFile(ignore,'\n# Chave privada de inscrições. NUNCA versionar.\nprivate/\n');
const config='public/config.js';let text=await fs.readFile(config,'utf8');
if(!text.includes('FESTAS_CONFIG_V2_START')){
  text+='\n/* FESTAS_CONFIG_V2_START — valores públicos de desenvolvimento */\n'+
  'window.RU_CONFIG = Object.freeze({...window.RU_CONFIG, firebaseWeb: {apiKey: "", authDomain: "cardapioufmg.firebaseapp.com", projectId: "cardapioufmg", appId: "", ...(window.RU_CONFIG?.firebaseWeb || {})}, eventEmulator: window.RU_CONFIG?.eventEmulator === true});\n'+
  '/* FESTAS_CONFIG_V2_END */\n';
  await fs.writeFile(config,text);
}
console.log('Configuração local atual preservada; scripts e chaves de desenvolvimento preparados.');
