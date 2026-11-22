/**
 * No Hub os dados em /externo/catalog são preservados, mas a antiga interface
 * independente (dois buscadores e painel vazio) não deve ser publicada.
 * Redirecionar deep links legados para a experiência única /?aba=onibus.
 * Executar APÓS stage-externo.mjs e ANTES do smoke test / ZIP.
 */
import {readFile,writeFile} from 'node:fs/promises';
const page=new URL('../public/externo/index.html',import.meta.url);
const original=await readFile(page,'utf8');
if(!original.includes('data-app-mode="free-static"')&&!original.includes('HUB_ONIBUS_LEGACY_ALIAS'))
  throw Error('EXTERNO_UNEXPECTED_PAGE');
const html=`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Ônibus — Hub UFMG</title>
<meta http-equiv="refresh" content="0;url=/?aba=onibus&amp;tipo=externo">
<script>
/* HUB_ONIBUS_LEGACY_ALIAS: destino único, sem tela de ônibus duplicada. */
(()=>{const target=new URL('/',location.origin);target.searchParams.set('aba','onibus');
target.searchParams.set('tipo','externo');const src=new URLSearchParams(location.search);
for(const key of ['ponto','linha'])if(src.has(key))target.searchParams.set(key,src.get(key));
location.replace(target.href);})();
</script></head><body><p>A consulta agora está na
<a href="/?aba=onibus">aba Ônibus do Hub UFMG</a>.</p></body></html>
`;
await writeFile(page,html,'utf8');
console.log('HUB_ONIBUS_LEGACY_ALIAS_OK');
