// CONFIGURAÇÃO PÚBLICA EXCLUSIVA DO PROJETO DE PRODUÇÃO.
// Não coloque chaves privadas ou credenciais de serviço neste arquivo.
window.RU_CONFIG = Object.freeze({
  firebaseProjectId: "hubufmg",
  // Opcional: URL HTTP(S) de um JSON público atualizado por outro coletor.
  publicFeedUrl: ""
});

/* FESTAS_CONFIG_V2_START — valores públicos de desenvolvimento */
window.RU_CONFIG = Object.freeze({...window.RU_CONFIG, firebaseWeb: {apiKey: "AIzaSyDmGIZZL09KeUdMpt6_ruV1XqsrBerQqqQ", authDomain: "hubufmg.firebaseapp.com", projectId: "hubufmg", appId: "1:858219271468:web:3b4a6e2fe3d0997b178889", messagingSenderId: "858219271468", ...(window.RU_CONFIG?.firebaseWeb || {})}, eventEmulator: false});
/* FESTAS_CONFIG_V2_END */
