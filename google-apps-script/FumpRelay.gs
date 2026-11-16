/**
 * Hub UFMG — relay read-only da API oficial da FUMP.
 *
 * O GitHub Actions não está conseguindo abrir conexões para fump.ufmg.br
 * (443/3003) a partir dos runners hospedados. Este Web App usa UrlFetchApp
 * na infraestrutura Google e devolve SOMENTE respostas dos dois endpoints
 * oficiais permitidos. Não grava Firestore, não guarda cardápios e não aceita
 * URLs arbitrárias.
 *
 * Configure Script Property FUMP_RELAY_TOKEN com 64 caracteres hexadecimais.
 * Implante como Web App: executar como você; acesso "qualquer pessoa".
 */
const FUMP_RELAY_VERSION = 1;
const FUMP_RELAY_API = 'https://fump.ufmg.br:3003';
const FUMP_RELAY_ALLOWED_IDS = new Set(['1', '2', '5', '6']);
const FUMP_RELAY_MAX_BODY = 2_000_000;

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 4096) {
      return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'INVALID_REQUEST'});
    }
    const request = JSON.parse(e.postData.contents);
    const expected = PropertiesService.getScriptProperties().getProperty('FUMP_RELAY_TOKEN') || '';
    if (!/^[a-f0-9]{64}$/i.test(expected) || !constantTimeEqual_(String(request.token || ''), expected)) {
      return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'UNAUTHORIZED'});
    }

    let url;
    if (request.resource === 'restaurants') {
      url = FUMP_RELAY_API + '/cardapios/restaurantes';
    } else if (request.resource === 'menu') {
      const id = String(request.id || '');
      const date = String(request.date || '');
      if (!FUMP_RELAY_ALLOWED_IDS.has(id)) {
        return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'RU_NOT_ALLOWED'});
      }
      if (!validRelayDate_(date)) {
        return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'DATE_INVALID'});
      }
      const today = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
      const max = addRelayDays_(today, 6);
      if (date < today || date > max) {
        return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'DATE_OUT_OF_RANGE'});
      }
      url = FUMP_RELAY_API + '/cardapios/cardapio?id=' + encodeURIComponent(id) +
        '&dataInicio=' + encodeURIComponent(date) + '&dataFim=' + encodeURIComponent(date);
    } else {
      return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'RESOURCE_NOT_ALLOWED'});
    }

    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {Accept: 'application/json'},
      followRedirects: false,
      muteHttpExceptions: true,
      validateHttpsCertificates: true,
      timeoutSeconds: 25
    });
    const status = response.getResponseCode();
    if (status !== 200) {
      return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'UPSTREAM_HTTP_' + status});
    }
    const contentType = String(response.getHeaders()['Content-Type'] || response.getHeaders()['content-type'] || '');
    if (contentType && !/json/i.test(contentType)) {
      return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'UPSTREAM_NOT_JSON'});
    }
    const body = response.getContentText();
    if (!body || body.length > FUMP_RELAY_MAX_BODY) {
      return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'UPSTREAM_BODY_INVALID'});
    }

    let data;
    try { data = JSON.parse(body); } catch (_) {
      return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'UPSTREAM_INVALID_JSON'});
    }

    if (request.resource === 'restaurants') {
      if (!Array.isArray(data)) return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'RESTAURANT_LIST_SCHEMA'});
    } else {
      if (!data || !Array.isArray(data.cardapios)) {
        return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'MENU_SCHEMA'});
      }
      if (data.id != null && String(data.id) !== String(request.id)) {
        return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'RU_ID_MISMATCH'});
      }
      for (const day of data.cardapios) {
        for (const field of ['data','dataCardapio','dataReferencia']) {
          if (day && day[field] != null) {
            const returned = parseRelayDate_(day[field]);
            if (!returned || returned !== request.date) {
              return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:'MENU_DATE_MISMATCH'});
            }
          }
        }
      }
    }

    return relayJson_({
      ok:true,
      version:FUMP_RELAY_VERSION,
      fetchedAt:new Date().toISOString(),
      upstreamStatus:status,
      data:data
    });
  } catch (error) {
    // Never log request body, URL query, token or menu contents.
    console.error('FUMP_RELAY_ERROR ' + safeRelayCode_(error));
    return relayJson_({ok:false,version:FUMP_RELAY_VERSION,code:safeRelayCode_(error)});
  }
}

function relayJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function validRelayDate_(value) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}

function addRelayDays_(iso, days) {
  const date = new Date(iso + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0,10);
}

function parseRelayDate_(value) {
  const text = String(value);
  const iso = text.match(/^(\\d{4}-\\d{2}-\\d{2})(?:T|\\s|$)/);
  if (iso) return iso[1];
  const br = text.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})(?:\\s|$)/);
  if (br) return br[3] + '-' + br[2] + '-' + br[1];
  return null;
}

function safeRelayCode_(error) {
  return String(error && error.message || 'INTERNAL_ERROR')
    .replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64).toUpperCase();
}
