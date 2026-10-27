// Configuração preparada; o executor de sorteios continua desativado.
export default Object.freeze({
  projectId: 'hubufmg',
  databaseId: '(default)',
  enabled: false,
  workflow: 'hub-production-raffles.yml',
  privateResultCollection: 'resultPrivate',
  publicResultCollection: 'results',
  requireServerDeadline: true,
  requireIdempotency: true,
});
