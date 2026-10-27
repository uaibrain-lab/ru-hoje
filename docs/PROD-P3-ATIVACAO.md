# Plano de ativação coordenada — PROD-P3

## Componentes preparados

- `scripts/hub-production-menu-sync.mjs`: sincronizador FUMP exclusivo de `hubufmg`.
- `scripts/hub-production-request-processor.mjs`: cooldown global, claim transacional, retry limitado e publicação compartilhada.
- `.github/workflows/hub-production-cardapios.yml`: cron diário, desativado por variável.
- `.github/workflows/hub-production-request-processor.yml`: verificação a cada 30 minutos, desativada por variável.
- `config/raffles.production.js`: contrato de sorteios preparado e `enabled=false`.
- `docs/PROCEDIMENTO-BOOTSTRAP-ADMIN-HUB.md`: bootstrap manual do primeiro administrador.

## Ordem segura futura

1. Confirmar repositório, ID numérico, owner, branch protegida e workflow.
2. Criar duas identidades WIF separadas: sincronização e processador; não reutilizar QA.
3. Conceder apenas o papel mínimo de impersonação para contas de serviço de produção.
4. Publicar o código e os workflows; manter `HUB_PROD_SYNC_ENABLED=false` e `HUB_PROD_PUBLISH_ENABLED=false`.
5. Executar dry-run somente leitura e verificar logs sanitizados.
6. Confirmar o UID Google do proprietário e provisionar `eventAdminAccess/owner`.
7. Executar uma rodada controlada do sincronizador.
8. Somente após a confirmação do processador, publicar Preview/Hosting conforme autorização própria.
9. Habilitar solicitações comunitárias por alteração transacional de `acceptingRequests`, nunca pelo navegador.
10. Manter sorteios desativados até gate independente.

Não executar IAM/WIF, workflow, Hosting live ou alteração de `acceptingRequests` sem autorização específica.
