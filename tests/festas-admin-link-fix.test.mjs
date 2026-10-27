import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTicketUrl,httpsUrl} from '../public/assets/festas-core.js';
test('link de ingresso sem protocolo recebe HTTPS',()=>{
  assert.equal(normalizeTicketUrl('sympla.com.br/evento'),'https://sympla.com.br/evento');
  assert.equal(normalizeTicketUrl('www.instagram.com/festa'),'https://www.instagram.com/festa');
  assert.equal(normalizeTicketUrl('https://example.org/a'),'https://example.org/a');
  assert.equal(normalizeTicketUrl('http://example.org/a'),'https://example.org/a');
});
test('esquemas inseguros, credenciais e entradas inválidas são bloqueados',()=>{
  for(const raw of ['javascript:alert(1)','data:text/plain,foo','ftp://example.com',
    'example.com@attacker.com','https://user:pass@example.com','localhost','http://127.0.0.1/x',
    'https://example.com/a b','example','https://example.com\n.evil.com'])
    assert.equal(normalizeTicketUrl(raw),'',raw);
});
test('sanitizador de links exibidos continua estrito',()=>{
  assert.equal(httpsUrl('example.com'),'');
  assert.equal(httpsUrl('http://example.com'),'');
  assert.equal(httpsUrl('https://example.com'),'https://example.com/');
});
