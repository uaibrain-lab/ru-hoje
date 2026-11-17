# Backup dos dados do Interno UFMG

Este diretório preserva, **em nosso próprio repositório**, uma cópia completa dos dados estruturados atualmente usados pelo módulo Interno do Hub UFMG.

## Arquivos

- `rotas-paradas-horarios-2026-11-17.json`: extraído em 17/11/2026 do objeto `const D` incorporado a `public/interno/index.html`, no repositório `uaibrain-lab/ru-hoje`, revisão de referência `4af10ca789b0b2aa41d21323bea72500b71c71cd`. Inclui **49 paradas** com IDs, nomes, coordenadas, categorias e linhas atendidas, e **13 variantes de linhas** com trajetos, itinerários e horários. É um **snapshot histórico do Hub**, não uma garantia de que horários futuros sejam iguais.
- `LICENSE-INTERNOROTAS`: aviso MIT e copyright do autor original, preservado na redistribuição.

## Origem e atribuição

Projeto original: **Interno Rotas — UFMG**, https://github.com/internorotas/ufmg

Licença do projeto original: **MIT**, copyright (c) 2023 internorotas. O Hub conserva os créditos. Para auditoria da fonte upstream, o GitHub indicava `main` em `938d4ac7d79e38cbf3b30e0039999476836b5e7d` em 17/11/2026. **Essa revisão upstream não foi afirmada como idêntica** ao snapshot integrado, que pode conter transformações ou ajustes locais.

## Operação

- O navegador **não consulta a API do repositório original** para paradas, linhas ou horários; os dados já estão incorporados à página `public/interno/index.html`.
- O backup JSON não é baixado pelo visitante nem substitui o arquivo de produção. Se o projeto original desaparecer, **o Hub continua usando sua cópia local** dos dados até uma eventual atualização manual.
- O teste `tests/interno-backup-integrity.test.mjs` exige que o backup seja idêntico aos dados incorporados ao site; se algum mantenedor alterar linhas ou paradas, o CI exigirá atualizar o snapshot conscientemente.
- Para restaurar os dados: recuperar este JSON, ler `linhas.categoriasDias` e `paradas`, e reconstituir o objeto `const D` de `public/interno/index.html` após revisar o diff. Não sobrescrever silenciosamente dados novos.
- **Dependências diferentes do dataset:** o mapa-base é carregado por tiles públicos do OpenStreetMap, a biblioteca Leaflet 1.9.4 por CDN e a fonte tipográfica pelo Google Fonts. Este backup **não armazena imagens dos tiles** nem elimina dependência desses serviços. Não copiar tiles em massa: respeitar a política dos servidores OSM e as respectivas licenças.

## Proteção adicional recomendada

Este snapshot já fica independente do repositório original, mas depende da disponibilidade do nosso repositório `ru-hoje`. Para proteção contra exclusão acidental **dos dois repositórios**, manter também uma cópia offline (`git clone --mirror`/`git bundle`) ou um segundo repositório privado independente sob outra conta/organização, preservando o histórico e a licença.
