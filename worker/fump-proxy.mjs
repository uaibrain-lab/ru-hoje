/**
 * Hub UFMG - proxy estritamente de leitura para os quatro endpoints públicos FUMP.
 *
 * Workers Free. Sem credenciais, Firestore, HTML scraping ou URLs arbitrárias.
 * O proxy remove a limitação CORS do navegador, mas a infraestrutura Cloudflare
 * ainda precisa conseguir alcançar a FUMP (teste real obrigatório).
 */
const API_ORIGIN = 'https://fump.ufmg.br:3003';
const ALLOWED_ORIGINS = new Set([
  'https://hubufmg.web.app',
  'https://hubufmg.firebaseapp.com',
]);
const IDS = new Set(['1','2','5','6']);
const MAX_BODY = 500_000;
const ONE_DAY_MS = 86_400_000;

function isoInBrazil(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).map(x => [x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function isIso(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(value+'T12:00:00Z');
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0,10) === value;
}
function dateInWindow(iso, now) {
  if (!isIso(iso)) return false;
  const first = isoInBrazil(now);
  const last = new Date(first+'T12:00:00Z');
  last.setUTCDate(last.getUTCDate()+14);
  return iso >= first && iso <= last.toISOString().slice(0,10);
}
function corsHeaders(origin) {
  const headers = new Headers({
    'Vary':'Origin',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
  });
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Access-Control-Allow-Methods','GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers','Accept, Content-Type');
    headers.set('Access-Control-Max-Age','7200');
  }
  return headers;
}
function json(data, status, origin, cacheSeconds=0) {
  const headers=corsHeaders(origin);
  headers.set('Content-Type','application/json; charset=utf-8');
  headers.set('Cache-Control',cacheSeconds ? `public,max-age=${cacheSeconds}` : 'no-store');
  return new Response(JSON.stringify(data),{status,headers});
}
function validSourcePayload(data, id, date) {
  if (!data || !Array.isArray(data.cardapios)) return false;
  if (data.id != null && String(data.id)!==id) return false;
  for (const entry of data.cardapios) {
    if (!entry || !Array.isArray(entry.refeicoes)) return false;
    for (const field of ['data','dataCardapio','dataReferencia']) {
      if (entry[field] == null) continue;
      const value=String(entry[field]);
      const match=value.match(/^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/);
      const br=value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);
      const found=match?.[1] || (br ? `${br[3]}-${br[2]}-${br[1]}` : null);
      if (!found || found !== date) return false;
    }
    for(const meal of entry.refeicoes) {
      if (!meal || !Array.isArray(meal.pratos)) return false;
    }
  }
  return true;
}

export async function handleRequest(request,{
  fetchFn=fetch,cache=globalThis.caches?.default,ctx=null,now=new Date()
}={}) {
  const origin=request.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({error:'ORIGIN_NOT_ALLOWED'},403,origin);
  const url=new URL(request.url);
  if (request.method==='OPTIONS') {
    const headers=corsHeaders(origin);
    headers.set('Cache-Control','no-store');
    return new Response(null,{status:204,headers});
  }
  if (request.method!=='GET') return json({error:'METHOD_NOT_ALLOWED'},405,origin);
  const isRestaurants=url.pathname==='/api/restaurants';
  const isMenu=url.pathname==='/api/menu';
  if (!isRestaurants && !isMenu) return json({error:'NOT_FOUND'},404,origin);
  const id=url.searchParams.get('id');
  const date=url.searchParams.get('data');
  if ((isRestaurants && url.searchParams.size!==0) ||
      (isMenu && (!IDS.has(id) || !dateInWindow(date,now) || url.searchParams.size!==2))) {
    return json({error:'INVALID_SOURCE_OR_DATE'},400,origin);
  }

  // Cache compartilhado no POP Cloudflare; não contém cabeçalho CORS
  // para permitir várias origens legítimas sobre a mesma resposta.
  const cacheKey=new Request(isRestaurants ? `${url.origin}/api/restaurants`
    : `${url.origin}/api/menu?id=${id}&data=${date}`,{method:'GET'});
  if(cache){
    try {
      const hit=await cache.match(cacheKey);
      if(hit){
        const body=await hit.text();
        const headers=corsHeaders(origin);
        headers.set('Content-Type','application/json; charset=utf-8');
        headers.set('Cache-Control','public,max-age=60');
        headers.set('X-Menu-Cache','HIT');
        return new Response(body,{status:200,headers});
      }
    } catch { /* cache indisponível não impede acesso à origem */ }
  }

  const target = new URL(isRestaurants ? '/cardapios/restaurantes' : '/cardapios/cardapio',API_ORIGIN);
  if(isMenu){
    target.searchParams.set('id',id);
    target.searchParams.set('dataInicio',date);
    target.searchParams.set('dataFim',date);
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  let raw;
  try {
    const upstream=await fetchFn(target.href,{
      method:'GET',
      headers:{Accept:'application/json'},
      // workerd não implementa redirect:'error': lança TypeError antes da rede.
      // 'manual' preserva o status 3xx para rejeição explícita abaixo.
      redirect:'manual',
      signal:controller.signal
    });
    if(upstream.status>=300 && upstream.status<400) {
      return json({error:'UPSTREAM_REDIRECT_BLOCKED',status:upstream.status},502,origin);
    }
    if(!upstream.ok) return json({error:'UPSTREAM_HTTP',status:upstream.status},502,origin);
    const contentType=upstream.headers.get('Content-Type')||'';
    if(contentType && !/json/i.test(contentType)) return json({error:'UPSTREAM_NOT_JSON'},502,origin);
    const body=await upstream.text();
    if(!body || body.length>MAX_BODY) return json({error:'UPSTREAM_BODY_INVALID'},502,origin);
    try { raw=JSON.parse(body); }
    catch { return json({error:'UPSTREAM_INVALID_JSON'},502,origin); }
    if(!(isRestaurants ? Array.isArray(raw) : validSourcePayload(raw,id,date))) {
      return json({error:'UPSTREAM_SCHEMA_INVALID'},502,origin);
    }
  } catch (error) {
    // Diagnóstico estritamente de transporte: nenhuma URL, payload ou credencial
    // é registrada. O Worker devolve códigos seguros para diferenciar timeout,
    // TLS e bloqueio de rede sem mascarar falha como cardápio vazio.
    const name=String(error?.name||'Error').replace(/[^A-Za-z0-9_]/g,'').slice(0,32);
    const causeCode=String(error?.cause?.code||error?.code||'')
      .replace(/[^A-Za-z0-9_]/g,'').slice(0,48);
    const message=String(error?.message||'')
      .replace(/https?:\/\/\S+/g,'[URL]').replace(/[\r\n]/g,' ')
      .slice(0,120);
    const diagnostic={name,code:causeCode,message};
    console.warn('FUMP_UPSTREAM_CONNECT_FAILURE',JSON.stringify(diagnostic));
    return json({error:'UPSTREAM_CONNECT_FAILED',diagnostic},503,origin);
  } finally { clearTimeout(timeout); }

  const body=JSON.stringify(raw);
  const seconds=isRestaurants ? 1800 : (raw.cardapios.length ? 240 : 30);
  if(cache){
    const put=cache.put(cacheKey,new Response(body,{
      status:200,
      headers:{
        'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':`public,max-age=${seconds}`
      }
    }));
    if(ctx?.waitUntil) ctx.waitUntil(Promise.resolve(put).catch(()=>{}));
    else await Promise.resolve(put).catch(()=>{});
  }
  const headers=corsHeaders(origin);
  headers.set('Content-Type','application/json; charset=utf-8');
  headers.set('Cache-Control',`public,max-age=${seconds}`);
  headers.set('X-Menu-Cache','MISS');
  return new Response(body,{status:200,headers});
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request,{ctx});
  }
};
