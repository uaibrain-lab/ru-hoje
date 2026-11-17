# Hub UFMG — lote das Fases 3, 4 e 5 (com avanços nas Fases 7 e 8)
Data: 17/11/2026 · Projeto: hubufmg

**Política de publicação:** integrar todas as mudanças aprovadas em uma única PR;
publicar apenas uma vez o Firebase Hosting e Firestore Rules. **O Cloudflare
Worker v276 já está publicado; este lote não muda nem republica o Worker.**

## Fase 3 — Menos persistência, menos consultas

- Cardápios são consultados apenas na FUMP por meio do Worker. Nenhum prato é
  persistido em localStorage, Firestore ou JSON estático do cliente.
- Histórico de consultas em localStorage foi removido. A chave antiga
  ruhoje:prefetch-checks:v2 é lida **somente para migrar o contador diário**
  e em seguida apagada. A chave atual ruhoje:prefetch-quota:v3 contém apenas
  uma data e a quantidade de tentativas de pré-carregamento realizadas.
- Status recentes permanecem em memória, sem ressuscitar respostas obsoletas
  entre visitas. Preferência de RU e outras opções legítimas permanecem locais.
- Pré-busca em segundo plano ocorre somente para o RU selecionado, até três
  datas seguintes com atendimento regular. Não consulta automaticamente os
  outros RUs. Preserva limite de 12 tentativas/dia/dispositivo, pausas após
  erros e controle de rede ruim/aba em segundo plano.
- Controle por dispositivo **não substitui limite central da Cloudflare**:
  localStorage pode ser alterado por qualquer visitante. Não o tratar como
  fronteira de segurança nem como mecanismo anti-DDoS.

## Fase 4 — Leitura e escrita de cardápios desativadas no Firestore

- Regras de publicMenus/current, menuSyncState/current e
  menuSyncRequests/current foram alteradas para allow read, write: if false.
- O executor com Admin SDK (quando autorizado) continua tecnicamente apto a
  ler esses documentos; o cliente visitante não pode usá-los nem publicá-los.
- Todas as regras de eventos, inscrições, perfis cifrados, administração e
  resultados dos sorteios permanecem como estavam.
- Nenhuma mudança de autenticação, Cloudflare Worker ou endpoint público.
- Esta fase requer publicar **Firestore Rules**; somente o deploy de Hosting
  não aplica a proteção de leitura ao banco. Os dados não foram apagados.

## Fase 5 — Interno com Leaflet hospedado no Hub

- Leaflet 1.9.4 JavaScript e CSS foram copiados para
  public/assets/vendor/leaflet-1.9.4.{js,css}, com licença BSD-2-Clause em
  LICENSE-LEAFLET. Imagens pequenas usadas pelo CSS estão embutidas como
  data:image/png;base64, sem links para CDN.
- O Interno deixa de depender de cdnjs e Google Fonts. Usa fonte do sistema.
- Service Worker v277 guarda Leaflet CSS/JS como componentes CORE do PWA,
  preservando a biblioteca offline após instalação.
- OpenStreetMap é somente a camada visual de tiles. URL padrão oficial:
  https://tile.openstreetmap.org/{z}/{x}/{y}.png
  A atribuição OpenStreetMap fica visível. Não fazemos pré-busca, download
  em massa, proxy de tiles nem cache de tiles no Service Worker.
- Se os tiles falharem, as 49 paradas, linhas e horários permanecem
  renderizáveis com vetor e um aviso discreto. O backup próprio de dados em
  backups/interno continua idêntico ao objeto incorporado na página.
- Isso **não torna o fundo cartográfico disponível offline**. Os tiles dependem
  do provedor externo e não podemos copiar sua base sem respeitar a política OSM.

## Fase 7 — Diagnóstico independente de snapshots (parcial)

- scripts/hub-live-readonly-probe.mjs deixou de consultar o Firestore legado
  e agora valida Hosting, app, Service Worker, Interno e respostas oficiais
  para as quatro IDs FUMP; não escreve ou armazena pratos.
- Um erro FUMP é marcado como degradação da fonte externa, não como autorização
  para exibir cardápio antigo.
- Diagnóstico pode ser executado manualmente ou pela workflow já existente,
  mas monitoramento com SLA, alertas independentes e recuperação remota
  automática ainda **não está concluído**.

## Fase 8 — Backup de código independente do GitHub (primeira camada)

- scripts/HUB-BACKUP-GIT-LOCAL.ps1 cria e verifica um git bundle completo e
  hash SHA-256 em Documents/Hub-UFMG-Backups.
- O snapshot Git é **manual/opcional**; por padrão o deploy não executa backup de código já versionado no GitHub.
- Recuperação do repositório: git clone "caminho\Hub-UFMG-data.bundle" "destino".
- **Limite**: esse pacote preserva código e histórico Git; não guarda dados
  Firestore de participantes, credenciais ou configurações secretas de provedores,
  nem é um backup em outro dispositivo. Para recuperação de desastre completa,
  precisamos de uma cópia em outra mídia/conta e política de backup de
  Firestore com controle de acesso, custos e proteção dos dados pessoais.

## Validação e publicação unificada

Antes de publicar, GitHub Actions deve aprovar unitários, E2E com tiles
propositalmente bloqueados, navegação do PWA offline e rotas antigas.

Na máquina Windows autenticada, após a PR aprovada e mesclada:

~~~powershell
& {
  $ErrorActionPreference = "Stop"
  Set-Location "D:\Downloads\Hub-UFMG"
  git pull --ff-only origin main
  if($LASTEXITCODE -ne 0){throw "GIT_PULL_FALHOU"}
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\HUB-BATCH-DEPLOY-VERIFICAR.ps1"
  if($LASTEXITCODE -ne 0){throw "BATCH_DEPLOY_FALHOU"}
}
~~~

A publicação única audita contratos de segurança, publica o Worker atualizado,
Firebase Hosting **e** Firestore Rules e verifica a v277 pública, app atualizado,
módulo Interno e arquivos locais do Leaflet. **Não executa sorteios**;
o snapshot Git local só ocorre se explicitamente solicitado. Não foi possível aplicar alterações diretamente ao Firebase
pelo GitHub; a implantação requer CLI local com autenticação.

## Etapas ainda pendentes

- **Fase 6**: migrar sorteios para executor autônomo e gratuito, mantendo janela
  de inscrição encerrada, idempotência e transações de escrita. Não ativar dois
  executores simultâneos. Exige homologação isolada antes de alterar produção.
- **Fase 7 completa**: alertas e recuperação com fontes de verificação
  independentes; GitHub Actions programado não é garantia eterna.
- **Fase 8 completa**: backup em local distinto com restauração testada,
  incluindo estado sensível do Firestore de forma segura.
- Publicação real e testes pós-deploy com usuários precisam ser confirmados;
  aprovação no GitHub não significa produção atualizada.
