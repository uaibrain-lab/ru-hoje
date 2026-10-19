const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) {
  console.error('Configuração pendente: secret FIREBASE_SERVICE_ACCOUNT_JSON não definido no GitHub Actions.');
  process.exit(1);
}
let obj;
try {obj = JSON.parse(raw);} catch {console.error('O secret deve conter JSON válido.');process.exit(1);}
if (!obj.project_id || !obj.client_email || !obj.private_key) {
  console.error('Credenciais Firebase incompletas.');process.exit(1);
}
if (obj.project_id !== 'cardapioufmg') {
  console.error('O secret pertence a outro projeto Firebase. Esperado: cardapioufmg.');
  process.exit(1);
}
if (/uaibrain/i.test(obj.project_id)) {
  console.error('Segurança: não reutilize o projeto do UaiBrain. Use um Firebase exclusivo para RU Hoje.');
  process.exit(1);
}
console.log('Secret Firebase encontrado e com estrutura válida; projeto distinto de UaiBrain.');
