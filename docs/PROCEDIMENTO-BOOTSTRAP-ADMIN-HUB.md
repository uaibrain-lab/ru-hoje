# Bootstrap do primeiro administrador — Hub UFMG

Este procedimento não deve ser automatizado nem executado sem confirmação explícita da identidade Google do proprietário.

1. Publicar primeiro somente uma versão de Preview autorizada do Hosting.
2. O proprietário entra com Google usando `hubufmg.web.app` ou o Preview confirmado.
3. Registrar o UID exibido pela sessão autenticada, sem registrar token, senha ou cookie.
4. Confirmar esse UID por canal humano antes de qualquer escrita.
5. Criar, via Console ou Admin SDK restrito, `eventAdminAccess/owner` com exatamente `{ uid: <UID confirmado>, enabled: true }`.
6. Conferir acesso Google e negar acesso anônimo.
7. Para revogar, atualizar `enabled=false` ou substituir o UID confirmado; nunca colocar a autorização no `localStorage`.

O documento não é criado nesta etapa. Nenhum administrador QA é copiado.
