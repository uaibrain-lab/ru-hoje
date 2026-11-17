# Hub UFMG — escopo enxuto e critérios de utilidade

Decisão de 17/11/2026: o objetivo é um Hub gratuito, responsivo, fácil de
operar e confiável **sem manutenção rotineira do usuário**. Não ampliar a
arquitetura apenas para preencher fases do roadmap.

## Núcleo do produto — manter e priorizar

1. **Cardápios FUMP:** informação oficial consultada sob demanda pelo Worker,
   com erro claro se indisponível. Cache curto, sem inventar abertura/fechamento
   a partir da ausência de pratos. Não aceitar escrita de menu por visitantes.
2. **Interno:** mapa de paradas, linhas e horários em dados próprios, com
   dependências estáticas locais e mapa vetorial útil quando os tiles falharem.
   Controlar mudanças do dataset e sua atribuição/licença.
3. **Sorteios:** inscrições protegidas, encerramento pelo relógio oficial do
   Firestore, apuração idempotente e publicação transacional com privacidade.
   Nunca ativar executor alternativo sem homologação e exclusão de duplicidade.
4. **PWA:** funcionar bem no celular, sem cache persistente de pratos vencidos;
   preferências pequenas e justificadas são aceitáveis.
5. **Custo e segurança:** plano gratuito, mínimos acessos externos, sem
   Firestore aberto a mutações genéricas ou ferramentas pagas por padrão.

## Confiabilidade útil, proporcional ao risco

- **Testes e auditorias antes de mudanças grandes**: cobrem quebras reais.
- **Monitoramento somente se houver ação prática:** alertas compreensíveis
  para falhas gerais do Hosting/Worker são úteis. Cron adicional que apenas
  grava logs sem alertar/corrigir deve ser reavaliado; contar requisições
  não equivale a tornar o site mais confiável.
- **Backup dos dados exclusivos:** snapshot de linhas/horários do Interno
  versionado no Git; plano privado e seguro para dados de participantes
  no Firestore antes de migrações destrutivas. O Git bundle não os contém.
- **Recuperação:** restaurar versões pelo Git e publicar novamente quando
  necessário. Evitar mecanismos em paralelo que possam disputar escrita.

## Cortado do escopo

- Agendamento **semanal** de backup do repositório no Windows.
  A ferramenta e os testes da tarefa foram excluídos.
- Backup Git **obrigatório a cada deploy**. O deploy normal não deve depender
  de a máquina conseguir gerar uma cópia de código que já está no GitHub.
  O script de bundle continua disponível manualmente; só é executado no
  deploy com `HUB_BACKUP_BEFORE_DEPLOY=true`.
- Persistência de cardápio no navegador ou banco com edição pelos usuários,
  espelhos automáticos de dados antigos da FUMP e fallback silencioso.
- Workflows de recarga ou monitoramento redundantes sem benefício observável.

## Regra para novas propostas

Antes de adicionar qualquer serviço, rotina ou arquivo obrigatório, avaliar:

1. Resolve um problema **real** já observado ou reduz risco relevante?
2. Protege **dados exclusivos** ou melhora diretamente a experiência?
3. Funciona sem supervisão ou cria outra obrigação ao operador?
4. Usa os limites gratuitos e possui rollback/erro bem definido?
5. Há uma forma mais simples de atingir o mesmo resultado?

Se o benefício não justificar as dependências e a manutenção, **não implementar**.

Esta é uma decisão de simplificação do roadmap, não autorização para apagar
dados Firestore, desligar sorteios em uso ou alterar a produção.
