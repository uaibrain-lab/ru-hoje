import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PROJECT, DOCUMENT, safeContext, assertWriteGate, sanitizeIncoming, mergeSnapshots, decideWrite, todayBR} from '../scripts/ocupa-qa-menu-core.mjs';

const syncSource = fs.readFileSync(new URL('../scripts/ocupa-qa-menu-sync.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../../.github/workflows/ocupa-qa-cardapios-publish.yml', import.meta.url), 'utf8');
const provider = JSON.parse(fs.readFileSync(new URL('../iam/ocupa-qa-cardapios-publish-provider.json', import.meta.url), 'utf8'));
const role = JSON.parse(fs.readFileSync(new URL('../iam/ocupa-qa-cardapios-publisher-role.json', import.meta.url), 'utf8'));

const errorOf = fn => { try { fn(); return ''; } catch (e) { return String(e.message); } };
const env = extra => ({GITHUB_ACTIONS:'true', GITHUB_REPOSITORY:'uaibrain-lab/ru-hoje', OCUPA_QA_ALLOWED_REPO:'uaibrain-lab/ru-hoje', ...extra});
const valid = () => {
  const date = todayBR(new Date());
  return {schemaVersion:1, generatedAt:new Date().toISOString(), source:'https://fump.ufmg.br/cardapio-do-dia/', days:{[date]:{restaurants:{'setorial-i':{sourceRestaurantId:'6',meals:{almoco:{items:[{name:'Arroz'}]}}},'setorial-ii':{sourceRestaurantId:'1',meals:{almoco:{items:[{name:'Feijão'}]}}}}}}};
};

test('produção é rejeitada', () => assert.equal(errorOf(() => safeContext({GOOGLE_CLOUD_PROJECT:'cardapioufmg'})), 'PROJETO_DIVERGENTE_GOOGLE_CLOUD_PROJECT'));
test('emulator é rejeitado no publisher', () => assert.equal(errorOf(() => safeContext({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'})), 'EMULADOR_ATIVO'));
test('credencial JSON é rejeitada', () => assert.equal(errorOf(() => safeContext({FIREBASE_SERVICE_ACCOUNT_JSON:'x'})), 'CREDENCIAL_JSON_NAO_PERMITIDA'));
test('flags de escrita desligadas bloqueiam apply', () => assert.equal(errorOf(() => assertWriteGate(['--mode=apply','--ack=PUBLICAR_SOMENTE_OCUPA_QA'], env({OCUPA_QA_SYNC_ENABLED:'false',OCUPA_QA_PUBLISH_ENABLED:'false'}))), 'FLAGS_QA_DESATIVADAS'));
test('repositório errado é rejeitado', () => assert.equal(errorOf(() => assertWriteGate(['--mode=apply','--ack=PUBLICAR_SOMENTE_OCUPA_QA'], env({GITHUB_REPOSITORY:'outro/repo',OCUPA_QA_SYNC_ENABLED:'true',OCUPA_QA_PUBLISH_ENABLED:'true'}))), 'REPOSITORIO_GITHUB_NAO_AUTORIZADO'));
test('ACK ausente bloqueia apply', () => assert.equal(errorOf(() => assertWriteGate(['--mode=apply'], env({OCUPA_QA_SYNC_ENABLED:'true',OCUPA_QA_PUBLISH_ENABLED:'true'}))), 'ACK_QA_AUSENTE'));
test('snapshot fora da janela é rejeitado', () => assert.equal(errorOf(() => sanitizeIncoming({...valid(),generatedAt:'2000-01-01T00:00:00.000Z'})), 'GERACAO_FORA_JANELA'));
test('almoço Setorial I ausente é rejeitado', () => { const s=valid(); delete s.days[todayBR(new Date())].restaurants['setorial-i']; assert.equal(errorOf(() => sanitizeIncoming(s)), 'ALMOCOS_ATUAIS_DOS_DOIS_SETORIAIS_AUSENTES'); });
test('almoço Setorial II ausente é rejeitado', () => { const s=valid(); delete s.days[todayBR(new Date())].restaurants['setorial-ii']; assert.equal(errorOf(() => sanitizeIncoming(s)), 'ALMOCOS_ATUAIS_DOS_DOIS_SETORIAIS_AUSENTES'); });
test('fonte RU trocada é rejeitada', () => { const s=valid(); s.days[todayBR(new Date())].restaurants['setorial-i'].sourceRestaurantId='1'; assert.equal(errorOf(() => sanitizeIncoming(s)), 'RU_FONTE_DIVERGENTE'); });
test('item inválido é rejeitado', () => { const s=valid(); s.days[todayBR(new Date())].restaurants['setorial-i'].meals.almoco.items=[{name:'<script>'}]; assert.equal(errorOf(() => sanitizeIncoming(s)), 'NOME_PRATO_INVALIDO'); });
test('limite de payload está no publicador', () => assert.match(syncSource, /DOCUMENTO_ACIMA_850KB/));
test('projeto e documento são fixos', () => { assert.equal(PROJECT, 'bandeco-homologacao'); assert.equal(DOCUMENT, 'publicMenus/current'); assert.match(syncSource, /\{PROJECT,DOCUMENT/); });
test('update exige lastUpdateTime', () => assert.match(syncSource, /lastUpdateTime:\s*old\.updateTime/));
test('backup externo é obrigatório antes da escrita', () => assert.match(syncSource, /BACKUP_PRIVADO_OBRIGATORIO/));
test('verificação administrativa e pública existe', () => { assert.match(syncSource, /VERIFICACAO_ADMIN_DIVERGENTE/); assert.match(syncSource, /VERIFICACAO_PUBLICA_DIVERGENTE/); });
test('snapshot remoto mais novo não é substituído', () => assert.equal(errorOf(() => mergeSnapshots({...valid(),generatedAt:'2999-01-01T00:00:00.000Z'}, valid())), 'FONTE_REMOTA_MAIS_NOVA'));
test('sem alteração real não há escrita', () => { const s=valid(); assert.equal(decideWrite(s,s,{getTime:()=>Date.parse(s.generatedAt)+1000}).write,false); });
test('alteração de conteúdo planeja escrita', () => { const old=valid(); const fresh=valid(); fresh.days[todayBR(new Date())].restaurants['setorial-i'].meals.almoco.items[0].name='Arroz integral'; assert.equal(decideWrite(old,fresh).write,true); });
test('não há criação nem exclusão no sincronizador', () => { assert.doesNotMatch(syncSource, /\.create\s*\(/); assert.doesNotMatch(syncSource, /\.delete\s*\(/); });
test('workflow e provider são somente manuais e restritos', () => { assert.match(workflow,/workflow_dispatch/); assert.doesNotMatch(workflow,/schedule:/); assert.doesNotMatch(workflow,/pull_request:/); assert.equal(provider.poolId,'ocupa-qa-publisher'); assert.equal(provider.attributeCondition.includes("assertion.event_name=='workflow_dispatch'"),true); assert.deepEqual(role.includedPermissions,['datastore.entities.get','datastore.entities.update']); });
test('pool antigo não é reutilizado pelo publisher', () => assert.doesNotMatch(workflow,/bandeco-qa-github\/providers\/ocupa-qa-cardapios-publish/));
test('conta do executor não é reutilizada', () => assert.doesNotMatch(workflow,/bandeco-qa-runner@/));
test('conta do probe não é reutilizada', () => assert.doesNotMatch(workflow,/ocupa-qa-cardapios@bandeco-homologacao/));
test('provider dedicado aparece no workflow', () => assert.match(workflow,/workloadIdentityPools\/ocupa-qa-publisher\/providers\/ocupa-qa-cardapios-publish/));
test('auth probe exige publish desligado', () => assert.match(workflow,/test '\$\{\{ inputs\.publish \}\}' = 'false'/));
test('auth probe exige confirmação desligada', () => assert.match(workflow,/test '\$\{\{ inputs\.confirm \}\}' = 'false'/));
test('auth probe não executa sincronizador', () => { assert.match(workflow,/if: \$\{\{ !inputs\.auth_probe && !inputs\.publish \}\}/); assert.match(workflow,/OCUPA_P5F2A_WIF_OK=1/); });
test('auth usa token curto e não exporta ambiente', () => { assert.match(workflow,/access_token_lifetime: 300s/); assert.match(workflow,/export_environment_variables: false/); });
test('publisher não usa secrets ou credenciais persistidas', () => { assert.doesNotMatch(workflow,/secrets\./); assert.match(workflow,/create_credentials_file: false/); });
test('publisher não tem cron nem apply no probe', () => { assert.doesNotMatch(workflow,/schedule:/); assert.match(workflow,/!inputs\.auth_probe/); });
