// CONFIGURAÇÃO PÚBLICA EXCLUSIVA DO PROJETO DE HOMOLOGAÇÃO.
// Não coloque chaves privadas ou credenciais de serviço neste arquivo.
window.RU_CONFIG = Object.freeze({
  firebaseProjectId: "bandeco-homologacao",
  // Opcional: URL HTTP(S) de um JSON público atualizado por outro coletor.
  publicFeedUrl: ""
});

/* FESTAS_CONFIG_V2_START — valores públicos de desenvolvimento */
window.RU_CONFIG = Object.freeze({...window.RU_CONFIG, firebaseWeb: {apiKey: "AIzaSyBdXXPyhl8dU4qcuUD1bNJYlJJPKPoa6oA", authDomain: "bandeco-homologacao.firebaseapp.com", projectId: "bandeco-homologacao", appId: "1:342397522942:web:c0e118b3abb66d867ea6af", messagingSenderId: "342397522942", ...(window.RU_CONFIG?.firebaseWeb || {})}, eventEmulator: false});
/* FESTAS_CONFIG_V2_END */
