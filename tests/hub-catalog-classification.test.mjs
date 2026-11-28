import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  categoryFromSourceType,knownDishCategory,publishedCategory,unregisteredCategory
} from '../public/assets/dish-category.js';
import {parseMenuJson} from '../public/assets/fump-parse.js';

const ingredients=JSON.parse(readFileSync(new URL('../public/data/pratos-ingredientes.json',import.meta.url),'utf8'));
const history=JSON.parse(readFileSync(new URL('../public/data/cardapios.json',import.meta.url),'utf8'));
const missingTypes=['Tipo de item não cadastrado',''];
const validCategories=new Set(['acompanhamento','guarnicao','vegetariana','proteina','molho','salada','sobremesa','bebida']);

test('todos os 126 pratos do catálogo de ingredientes têm fallback de categoria auditado',()=>{
  assert.equal(ingredients.count,126,'Detectar acréscimos ao catálogo que exigem revisão');
  assert.equal(ingredients.dishes.length,ingredients.count);
  const groups={};
  for(const dish of ingredients.dishes){
    const expected=knownDishCategory(dish.name);
    assert.ok(validCategories.has(expected),'Faltou classificar '+dish.name);
    groups[expected]=(groups[expected]||0)+1;
    for(const type of missingTypes){
      // Fonte FUMP sem tipo reconhecível: aplicar o catálogo ao nome exato.
      assert.equal(categoryFromSourceType(type,dish.name),expected,dish.name+' / '+type);
      assert.equal(publishedCategory('',dish.name,type),expected,dish.name+' / '+type+' (render)');
    }
  }
  assert.deepEqual(groups,{
    guarnicao:26,proteina:27,acompanhamento:7,vegetariana:11,
    sobremesa:12,molho:7,bebida:1,salada:35
  });
});

test('o histórico inclui mais 76 nomes além do catálogo de ingredientes, sem deixar lacunas',()=>{
  const normalize=name=>String(name||'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
    .replace(/[\u2010-\u2015-]/g,' ').replace(/\s+/g,' ');
  const fromIngredients=new Set(ingredients.dishes.map(item=>normalize(item.name)));
  const fromHistory=new Map();
  for(const day of Object.values(history.days)){
    for(const ru of Object.values(day.restaurants||{})){
      for(const meal of Object.values(ru.meals||{})){
        for(const item of meal.items||[]){
          fromHistory.set(normalize(item.name),item.name);
        }
      }
    }
  }
  assert.equal(fromHistory.size,142);
  let historyOnly=0;
  for(const [name,displayName] of fromHistory){
    assert.ok(validCategories.has(knownDishCategory(displayName)),displayName+' ausente da classificação');
    if(!fromIngredients.has(name))historyOnly++;
  }
  assert.equal(historyOnly,76,'Nenhum nome do histórico pode ficar sem categoria');
});

test('todas as categorias catalogadas prevalecem sobre a FUMP',()=>{
  assert.equal(knownDishCategory('Charuto de repolho'),'vegetariana');
  assert.equal(categoryFromSourceType('Prato protéico 1','Charuto de repolho'),'vegetariana');
  assert.equal(publishedCategory('vegetariana','Charuto de repolho','Prato protéico 1'),'vegetariana');
  assert.equal(categoryFromSourceType('Prato protéico 3','Charuto de repolho'),'vegetariana');
  assert.equal(categoryFromSourceType('Tipo de item não cadastrado','Charuto de repolho'),'vegetariana');
  assert.equal(publishedCategory('outros','Molho de manjericão','Tipo de item não cadastrado'),'molho');
  assert.equal(publishedCategory('outros','Molho de salsão',''),'molho');
  assert.equal(publishedCategory('outros','Escondidinho de frango',''),'proteina');
  assert.equal(categoryFromSourceType('Entrada 1','Salada de legumes'),'guarnicao');
  assert.equal(categoryFromSourceType('Tipo de item não cadastrado','Salada de legumes'),'guarnicao');
});

test('o catálogo prevalece também sobre grupos auxiliares',()=>{
  assert.equal(categoryFromSourceType('Prato protéico 1','Assado de Grão-de-Bico'),'vegetariana');
  assert.equal(publishedCategory('proteina','Assado de Grão-de-Bico','Prato protéico 1'),'vegetariana');
  assert.equal(categoryFromSourceType('Entrada 2','Frango Xadrez'),'proteina');
  assert.equal(categoryFromSourceType('Prato protéico 3','Carne de porco frita'),'proteina');
  assert.equal(publishedCategory('guarnicao','Quibe de Cenoura'),'vegetariana'); // exceção comprovada em 19/11/2026
  // A exceção comprovada do bife de milho permanece válida.
  assert.equal(categoryFromSourceType('Prato protéico 1','Bife de milho'),'vegetariana');
});

test('nomes exatos corrigem erros conhecidos e não contaminam nomes parecidos',()=>{
  assert.equal(knownDishCategory('SALADA SÍRIA'),'salada');
  assert.equal(categoryFromSourceType('Tipo de item não cadastrado','Salada Síria'),'salada');
  assert.equal(knownDishCategory('Bife de milho'),'vegetariana');
  assert.equal(categoryFromSourceType('Prato protéico 1','Bife de milho'),'vegetariana');
  assert.equal(categoryFromSourceType('Prato protéico 1','Soja refogada com legumes'),'vegetariana');
  assert.equal(unregisteredCategory('Strogonoff de soja'),'vegetariana');
  assert.equal(categoryFromSourceType('Prato protéico 1','Bife de milho com carne'),'proteina');
  assert.equal(knownDishCategory('Bife de milho com carne'),'');
  assert.equal(categoryFromSourceType('Prato protéico 1','Prato desconhecido'),'proteina');
  assert.equal(categoryFromSourceType('Prato protéico 3','Prato desconhecido'),'vegetariana');
  assert.equal(categoryFromSourceType('Acompanhamento 1','Prato desconhecido'),'acompanhamento');
});

test('quibe assado com lentilha é vegetariano mesmo com tipo genérico conflitante',()=>{
  for(const type of ['Prato protéico 1','Prato protéico 2','Prato protéico 3','Tipo de item não cadastrado','Guarnição','']){
    assert.equal(categoryFromSourceType(type,'Quibe assado com lentilha'),'vegetariana',type);
    assert.equal(publishedCategory('proteina','Quibe assado com lentilha',type),'vegetariana',type);
  }
  assert.equal(publishedCategory('proteina',' QUIBE ASSADO COM LENTILHA '),'vegetariana');
  assert.equal(categoryFromSourceType('Prato protéico 1','Quibe assado com carne'),'proteina');
  const parsed=parseMenuJson({id:6,cardapios:[{data:'2026-11-17',refeicoes:[
    {tipoRefeicao:'Almoço',pratos:[{tipoPrato:'Prato protéico 1',descricaoPrato:'Quibe assado com lentilha'}]}
  ]}]},{iso:'2026-11-17',sourceId:'6'});
  assert.equal(parsed.meals.almoco.items[0].category,'vegetariana');
});

test('espinafre com ricota e hambúrguer de grão-de-bico são sempre opções vegetarianas',()=>{
  const names=['Espinafre com ricota e abobrinha','Hambúrguer de grão-de-bico'];
  for(const name of names){
    for(const type of ['Prato protéico 1','Prato protéico 2','Prato protéico 3',
      'Guarnição','Tipo de item não cadastrado','']){
      assert.equal(categoryFromSourceType(type,name),'vegetariana',name+' / '+type);
      assert.equal(publishedCategory('proteina',name,type),'vegetariana',name+' / '+type);
    }
    assert.equal(knownDishCategory(name),'vegetariana');
  }
  // Correção por nome exato: não estender a preparações parecidas.
  assert.equal(categoryFromSourceType('Prato protéico 1',
    'Hambúrguer de grão-de-bico com carne'),'proteina');
  assert.equal(categoryFromSourceType('Prato protéico 1',
    'Espinafre com ricota, abobrinha e frango'),'proteina');

  const parsed=parseMenuJson({id:6,cardapios:[{data:'2026-11-17',refeicoes:[{
    tipoRefeicao:'Almoço',pratos:names.map(descricaoPrato=>({
      tipoPrato:'Prato protéico 1',descricaoPrato
    }))
  }]}]},{iso:'2026-11-17',sourceId:'6'});
  assert.deepEqual(parsed.meals.almoco.items.map(item=>item.category),
    ['vegetariana','vegetariana']);
});

test('o parser FUMP já devolve as categorias corrigidas para pratos conhecidos',()=>{
  const parsed=parseMenuJson({id:6,cardapios:[{data:'2026-11-17',refeicoes:[
    {tipoRefeicao:'Almoço',pratos:[
      {tipoPrato:'Prato protéico 1',descricaoPrato:'Bife de milho'},
      {tipoPrato:'Prato protéico 1',descricaoPrato:'Charuto de repolho'},
      {tipoPrato:'Tipo de item não cadastrado',descricaoPrato:'Strogonoff de soja'},
      {tipoPrato:'Tipo de item não cadastrado',descricaoPrato:'Molho de manjericão'},
      {tipoPrato:'Prato protéico 1',descricaoPrato:'Frango grelhado'}
    ]}
  ]}]},{iso:'2026-11-17',sourceId:'6'});
  assert.deepEqual(parsed.meals.almoco.items.map(x=>x.category),
    ['vegetariana','vegetariana','vegetariana','molho','proteina']);
});
