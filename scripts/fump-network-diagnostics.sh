#!/usr/bin/env bash
# Diagnostico somente leitura: separa DNS, TCP, TLS, IPv4/IPv6 e Node fetch.
set +e
HOST="fump.ufmg.br"
TODAY="$(TZ=America/Sao_Paulo date +%F)"
PAGE="https://${HOST}/cardapio-do-dia/"
LIST="https://${HOST}:3003/cardapios/restaurantes"
MENU="https://${HOST}:3003/cardapios/cardapio?id=6&dataInicio=${TODAY}&dataFim=${TODAY}"

echo "FUMP_DIAG date_br=${TODAY} utc=$(date -u +%FT%TZ) runner=$(uname -s)"
echo "=== DNS IPv4 ==="
getent ahostsv4 "${HOST}" || true
echo "=== DNS IPv6 ==="
getent ahostsv6 "${HOST}" || true

echo "=== CURL: testar conexão, TLS e HTTP em IPv4 e IPv6 ==="
for family in 4 6; do
  for name_url in "PAGE|${PAGE}" "API_LIST|${LIST}" "API_RU6|${MENU}"; do
    name="${name_url%%|*}"
    url="${name_url#*|}"
    echo "--- CURL_${name}_IPV${family} ---"
    curl "-${family}" -sS -o /dev/null \
      --connect-timeout 8 --max-time 18 \
      -w "http=%{http_code} remote_ip=%{remote_ip} connect_s=%{time_connect} tls_s=%{time_appconnect} total_s=%{time_total} tls_verify=%{ssl_verify_result}\n" \
      "${url}"
    echo "curl_exit=$?"
  done
done

echo "=== OPENSSL: certificado e cadeia TLS nas portas 443 e 3003 ==="
for port in 443 3003; do
  echo "--- OPENSSL_PORT_${port} ---"
  timeout 18 openssl s_client -connect "${HOST}:${port}" -servername "${HOST}" \
    -showcerts -verify_return_error </dev/null 2>&1 |
    grep -E '^(CONNECTED|depth=|verify error:|Verification error:|Verify return code:|subject=|issuer=|New,|Protocol|Ciphersuite|no peer certificate|connect:)' |
    head -40
  echo "openssl_exit=${PIPESTATUS[0]}"
done

echo "=== NODE fetch: DNS padrão versus IPv4 first ==="
for order in verbatim ipv4first; do
  echo "--- NODE_DNS_ORDER_${order} ---"
  FUMP_DNS_ORDER="${order}" node --input-type=module <<'NODE'
import dns from 'node:dns';
dns.setDefaultResultOrder(process.env.FUMP_DNS_ORDER);
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const targets = [
  ['PAGE', 'https://fump.ufmg.br/cardapio-do-dia/'],
  ['API_LIST', 'https://fump.ufmg.br:3003/cardapios/restaurantes'],
  ['API_RU6', `https://fump.ufmg.br:3003/cardapios/cardapio?id=6&dataInicio=${today}&dataFim=${today}`],
];
for (const [name, url] of targets) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {Accept: 'application/json, text/html;q=0.9'},
      redirect: 'follow',
    });
    const body = await response.text();
    let shape = `bytes=${Buffer.byteLength(body)}`;
    try {
      const json = JSON.parse(body);
      shape = Array.isArray(json)
        ? `array_length=${json.length}`
        : `cardapios=${Array.isArray(json?.cardapios) ? json.cardapios.length : 'N/A'}`;
    } catch {}
    console.log(`NODE_${name} status=HTTP_${response.status} ${shape} elapsed_ms=${Date.now()-started}`);
  } catch (error) {
    const chain = [];
    for (let current = error, depth = 0; current && depth < 5; current = current.cause, depth++) {
      chain.push([
        String(current.name || 'Error').replace(/[^A-Za-z0-9_-]/g, '_'),
        String(current.code || '').replace(/[^A-Za-z0-9_-]/g, '_'),
      ].filter(Boolean).join(':'));
    }
    console.log(`NODE_${name} error=${chain.join(' <- ')} message=${String(error.message || '').replace(/[^A-Za-z0-9_ .:/-]/g, '_').slice(0,160)} elapsed_ms=${Date.now()-started}`);
  } finally {
    clearTimeout(timer);
  }
}
NODE
done

echo "FUMP_DIAG_FINISHED"
exit 0
