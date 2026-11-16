import {dateInBrasilia} from './fump-api.mjs';

const today = dateInBrasilia();
const targets = [
  {name:'FUMP_HTTPS_443',url:'https://fump.ufmg.br/cardapio-do-dia/',kind:'html'},
  {name:'FUMP_API_LIST_3003',url:'https://fump.ufmg.br:3003/cardapios/restaurantes',kind:'json'},
  {name:'FUMP_API_RU6_3003',url:`https://fump.ufmg.br:3003/cardapios/cardapio?id=6&dataInicio=${today}&dataFim=${today}`,kind:'json'},
];

for (const target of targets) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const started = Date.now();
  try {
    const response = await fetch(target.url,{
      signal:controller.signal,
      headers:{Accept:target.kind==='json'?'application/json':'text/html'},
      redirect:'follow'
    });
    const body = await response.text();
    let shape = 'BODY_PRESENT';
    if (target.kind === 'json') {
      try {
        const json = JSON.parse(body);
        shape = Array.isArray(json) ? `ARRAY_LENGTH=${json.length}` :
          `CARDAPIOS=${Array.isArray(json?.cardapios)?json.cardapios.length:'N/A'}`;
      } catch { shape = 'INVALID_JSON'; }
    } else {
      shape = `HTML_BYTES=${Buffer.byteLength(body)}`;
    }
    console.log(`${target.name} status=HTTP_${response.status} elapsedMs=${Date.now()-started} ${shape}`);
  } catch (error) {
    const cause = error?.cause?.code || error?.code || error?.name || 'UNKNOWN';
    console.log(`${target.name} status=ERROR cause=${String(cause).replace(/[^A-Z0-9_-]/gi,'_')} elapsedMs=${Date.now()-started}`);
  } finally {
    clearTimeout(timer);
  }
}
