import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMenus} from '../scripts/parser.mjs';
const legitimate=`Almoço
Isca de Frango Colorida
Bife de milho (Prato protéico 3)
Batata ao Forno (Guarnição)
Arroz Branco (Acompanhamento 1)
Feijão Carioca (Acompanhamento 2)
Salada de Alface Crespa (Entrada 1)
Salada de Cenoura com Vagem (Entrada 2)
Doce de Amendoim em Tablete [Sobremesa (uma porção)]
Refresco [Refresco (um copo)]
Molho de Hortelã`;
test('ignora banner de cookies e menu institucional se misturados aos pratos',()=>{
  const contaminated=legitimate.replace('Isca de Frango Colorida',
    'Valorizamos sua privacidade\nPersonalizar\nAceitar tudo\nIr para o Menu\nCARDÁPIOS DOS RUS\nIsca de Frango Colorida');
  const result=extractMenus(contaminated);
  assert.equal(result.almoco.items.length,10);
  assert.ok(result.almoco.items.every(x=>!/privacidade|personalizar|aceitar tudo|ir para o menu|cardápios dos rus/i.test(x.name)));
});
test('não aceita oito links sem ingredientes como cardápio',()=>{
  assert.deepEqual(extractMenus('Almoço\nInstitucional\nPesquisar\nServiços\nBiblioteca\nAtendimento\nProgramas de assistência\nAcessibilidade\nContato da equipe\nGuia para estudantes'),{});
});
