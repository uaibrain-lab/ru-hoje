/**
 * Classificação de exibição por nome exato normalizado: o catálogo ICA,
 * histórico FUMP e correções verificadas prevalecem em todas as categorias.
 * Nomes inéditos usam o tipo oficial reconhecido; sem evidência, não inferir.
 * O tipo oficial original permanece preservado no parser para auditoria.
 * Não confundir classificação de exibição com certificação nutricional.
 */
const normal = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR').trim()
  .replace(/[\u2010-\u2015-]/g, ' ').replace(/\s+/g, ' ');

// Itens cujo tipo oficial chegou como "Tipo de item não cadastrado".
const UNREGISTERED_OVERRIDES = Object.freeze({
  'frango xadrez': 'proteina',
  'frango ao molho de tomate': 'proteina',
  'molho verde': 'molho',
  'molho de tomate com oregano': 'molho',
  // Itens conhecidos em cardápios sem tipo oficial publicado.
  'assado de grao de bico': 'vegetariana',
  'cassoulet vegetariano': 'vegetariana',
  'bolinho de soja com batata': 'vegetariana',
  'quibe de cenoura': 'vegetariana',
  'asa de frango assada': 'proteina',
  // Variantes exatas já cobertas pela regressão v1.9.6, sem inferência por substring.
  'strogonoff': 'proteina',
  'strogonoff vegano': 'vegetariana',
  'strogonoff vegetariano': 'vegetariana',
});

// Catálogo de receitas alimentado pelo PDF "Ingredientes - ICA".
// Todas as categorias catalogadas têm prioridade sobre a FUMP.
const ICA_CATALOG = Object.freeze({
  // Acompanhamentos
  'arroz a grega': 'acompanhamento',
  'arroz branco': 'acompanhamento',
  'arroz com alho': 'acompanhamento',
  'arroz com brocolis': 'acompanhamento',
  'arroz integral': 'acompanhamento',
  'feijao carioca': 'acompanhamento',
  'feijao com linguica': 'acompanhamento',
  // Guarnições
  'abobora c/ quiabo': 'guarnicao',
  'abobora com quiabo': 'guarnicao',
  'angu ao sugo': 'guarnicao',
  'angu com quiabo': 'guarnicao',
  'batata ao forno': 'guarnicao',
  'batata chips': 'guarnicao',
  'bolinho de arroz': 'guarnicao',
  'canjiquinha': 'guarnicao',
  'chuchu gratinado': 'guarnicao',
  'couve refogada com bacon': 'guarnicao',
  'couve refogada': 'guarnicao',
  'couve-flor gratinada': 'guarnicao',
  'couve flor gratinada': 'guarnicao',
  'farofa de carne': 'guarnicao',
  'farofa de cenoura': 'guarnicao',
  'farofa de couve': 'guarnicao',
  'farofa de milho': 'guarnicao',
  'legumes ao alho e oleo': 'guarnicao',
  'macarrao a carbonara': 'guarnicao',
  'macarrao ao alho e oleo': 'guarnicao',
  'macarronada': 'guarnicao',
  'mandioca ensopada': 'guarnicao',
  'moranga a mineira': 'guarnicao',
  'moranga c/ quiabo': 'guarnicao',
  'moranga com quiabo': 'guarnicao',
  'pure de abobora': 'guarnicao',
  'pure de batata': 'guarnicao',
  'tutu a mineira': 'guarnicao',
  'virado de vagem': 'guarnicao',
  // Opções vegetarianas
  'assado de grao de bico': 'vegetariana',
  'assado de lentilha': 'vegetariana',
  'bolinho de grao de bico': 'vegetariana',
  'bolinho de soja': 'vegetariana',
  'cassoulet vegetariano': 'vegetariana',
  'escondidinho de soja': 'vegetariana',
  'lasanha de soja': 'vegetariana',
  'lentilha refogada c/ legumes': 'vegetariana',
  'lentilha refogada com legumes': 'vegetariana',
  'quibe de soja': 'vegetariana',
  'soja refogada com legumes': 'vegetariana',
  'strogonoff de soja': 'vegetariana',
  // Pratos principais
  'almondegas assadas': 'proteina',
  'asa de frango assada': 'proteina',
  'bisteca suina grelhada': 'proteina',
  'carne assada': 'proteina',
  'carne cozida': 'proteina',
  'carne cozida com legumes': 'proteina',
  'carne cozida c/ mandioca': 'proteina',
  'carne cozida com mandioca': 'proteina',
  'carne de sol acebolada': 'proteina',
  'carne moida': 'proteina',
  'carne suina a brase': 'proteina',
  'carne suina a bras': 'proteina',
  'carne suina assada': 'proteina',
  'coxa de frango assada': 'proteina',
  'coxa de frango ao molho de tomate': 'proteina',
  'cozido misto': 'proteina',
  'escondidinho de carne seca': 'proteina',
  'feijoada': 'proteina',
  'frango ao molho de tomate': 'proteina',
  'frango gratinado com creme de milho': 'proteina',
  'frango xadrez': 'proteina',
  'isca de carne colorida': 'proteina',
  'isca de frango a milanesa': 'proteina',
  'isca de frango a parmegiana': 'proteina',
  'lasanha de frango': 'proteina',
  'ovo cozido': 'proteina',
  'rocambole de carne': 'proteina',
  'strogonoff de carne': 'proteina',
  'strogonoff de frango': 'proteina',
  // Molhos
  'molho agridoce com mostarda': 'molho',
  'molho de alho': 'molho',
  'molho de hortela': 'molho',
  'molho de tomate': 'molho',
  'molho ingles': 'molho',
  'molho verde': 'molho',
  'molho vinagrete': 'molho',
  // Saladas
  'salada de acelga com abacaxi': 'salada',
  'salada de acelga com alface roxa': 'salada',
  'salada de acelga com couve': 'salada',
  'salada de acelga com rucula': 'salada',
  'salada de acelga': 'salada',
  'salada de alface': 'salada',
  'salada de alface com agriao': 'salada',
  'salada de alface com alface roxa': 'salada',
  'salada de alface com couve': 'salada',
  'salada de alface com rucula': 'salada',
  'salada de alface crespa': 'salada',
  'salada de batata doce': 'salada',
  'salada de beterraba cozida': 'salada',
  'salada de beterraba ralada': 'salada',
  'salada de cenoura com brocolis': 'salada',
  'salada de cenoura cozida': 'salada',
  'salada de cenoura ralada': 'salada',
  'salada de chuchu': 'salada',
  'salada de chuchu com milho': 'salada',
  'salada de couve': 'salada',
  'salada de maionese com legumes': 'salada',
  'salada de maionese com repolho': 'salada',
  'salada de pepino ao vinagrete': 'salada',
  'salada de pepino com couve-flor': 'salada',
  'salada de pepino com couve flor': 'salada',
  'salada de repolho com alface': 'salada',
  'salada de rucula': 'salada',
  'salada de tomate': 'salada',
  'salada de tomate com cebola': 'salada',
  'salada diferente': 'salada',
  'salada fantasia': 'salada',
  'salada provencal': 'salada',
  'salada siria': 'salada',
  'salada seria': 'salada', // grafia legada; PDF de ingredientes: Salada Síria
  'salada tropical': 'salada',
  'salpicao de cenoura': 'salada',
  'tabule': 'salada',
  // Sobremesas
  'banana nanica': 'sobremesa',
  'doce de amendoim em tablete': 'sobremesa',
  'doce de banana em tablete': 'sobremesa',
  'doce de cocada branca tablete': 'sobremesa',
  'doce de geleia em tablete': 'sobremesa',
  'doce de pacoca': 'sobremesa',
  'doce de pe de moleque em tablete': 'sobremesa',
  'laranja': 'sobremesa',
  'maca': 'sobremesa',
  'mamao': 'sobremesa',
  'melancia': 'sobremesa',
  'tangerina': 'sobremesa',
  // Bebidas
  'refresco': 'bebida',
});

// Referências de classificações de cardápios históricos FUMP (outubro/2026).
// Não são cardápios atuais e NUNCA serão exibidos como pratos publicados.
// Nomes exatos desta tabela têm prioridade em todas as categorias.
const HISTORICAL_FUMP_CATEGORIES = Object.freeze({
  // acompanhamento (1)
  "bolinho de milho": "acompanhamento",
  // guarnicao (18)
  "abobora cozida": "guarnicao",
  "abobrinha a napolitana": "guarnicao",
  "abobrinha no fuba": "guarnicao",
  "batata corada ao forno": "guarnicao",
  "cenoura vick": "guarnicao",
  "chuchu tropeiro": "guarnicao",
  "farofa com frutas": "guarnicao",
  "farofa de repolho": "guarnicao",
  "parafuso com brocolis": "guarnicao",
  "penne ao manjericao": "guarnicao",
  "salada de legumes": "guarnicao",
  "sopa de abobora": "guarnicao",
  "sopa de batata": "guarnicao",
  "sopa de fuba": "guarnicao",
  "sopa de inhame": "guarnicao",
  "sopa de legumes": "guarnicao",
  "sopa de mandioca": "guarnicao",
  "virado de couve": "guarnicao",
  // vegetariana (9)
  "charuto de repolho": "vegetariana",
  "cuscuz de legumes com coentro": "vegetariana",
  "espinafre com ricota e abobrinha": "vegetariana",
  "feijoada de soja": "vegetariana",
  "hamburguer de grao de bico": "vegetariana",
  "quibe assado com lentilha": "vegetariana",
  "ratatule": "vegetariana",
  "soja refogada com cenoura": "vegetariana",
  "virado de lentilha": "vegetariana",
  // proteina (21)
  "bife de panela": "proteina",
  "bife de porco acebolado": "proteina",
  "bisteca ao molho": "proteina",
  "bisteca suina assada": "proteina",
  "carne caipira": "proteina",
  "carne de porco frita": "proteina",
  "carne moida a jardineira": "proteina",
  "carne moida com azeitonas": "proteina",
  "copa lombo assado": "proteina",
  "coxa de frango ao molho": "proteina",
  "escondidinho de frango": "proteina", // revisão nominal: tipo histórico não cadastrado
  "falso lombo recheado com calabresa": "proteina",
  "fricasse de frango": "proteina",
  "isca de carne de porco acebolada": "proteina",
  "isca de frango colorida": "proteina",
  "isca de pernil": "proteina",
  "linguica assada": "proteina",
  "linguica toscana acebolada": "proteina",
  "linguica toscana assada": "proteina",
  "sobrecoxa de frango assada": "proteina",
  "torta de frango": "proteina",
  // molho (2)
  "molho de manjericao": "molho", // revisão nominal: tipo histórico não cadastrado
  "molho de salsao": "molho", // revisão nominal: tipo histórico não cadastrado
  // salada (16)
  "salada de acelga com alface": "salada",
  "salada de acelga com alface roxo": "salada",
  "salada de almeirao": "salada",
  "salada de batata baroa": "salada",
  "salada de berinjela com oregano": "salada",
  "salada de beterraba": "salada",
  "salada de chuchu com milho verde": "salada",
  "salada de grao de bico ao vinagrete": "salada",
  "salada de pepino": "salada",
  "salada de repolho bicolor": "salada",
  "salada de repolho com maionese": "salada",
  "salada grega": "salada",
  "salada tabule": "salada",
  "salpicao de legumes": "salada",
  "seleta de legumes": "salada",
  "vinagrete": "salada",
  // sobremesa (4)
  "banana": "sobremesa",
  "doce tablete": "sobremesa",
  "fruta": "sobremesa",
  "gelatina de morango": "sobremesa",
});

// Novos nomes detectados em consulta oficial ao Worker da FUMP em
// 17–19/11/2026 (IDs 6, 1, 2, 5; datas consultadas até 01/12).
// Todas as categorias registradas têm prioridade por nome exato.
const OBSERVED_FUMP_CATEGORIES_NOV2026 = Object.freeze({
  'banana prata': 'sobremesa',
  'carne moida com legumes': 'proteina',
  'chuchu refogado': 'guarnicao',
  'doce de abobora': 'sobremesa',
  'feijao com bacon': 'acompanhamento',
  'feijao tropeiro': 'acompanhamento',
  'gelatina de uva': 'sobremesa',
  'melao': 'sobremesa',
  'repolho bulgaro': 'guarnicao',
  'salada de almeirao com alface roxa': 'salada',
  'salada de almeirao com repolho': 'salada',
  'salada de almeirao com repolho roxo': 'salada',
  'salada de jilo': 'salada',
  'sopa de fuba com couve': 'guarnicao',
  'torta colorida': 'proteina',
});

// Registro comprovado como "Prato protéico 3" na API, mas publicado
// por versões anteriores com category='proteina'.
const VERIFIED_VEGETARIAN_LEGACY = new Set([
  'bolinho de ervilha',
  'soja refogada com legumes',
  'bife de milho',
  'cassoulet vegetariano',
  // Confirmados pelo usuario como alternativas vegetarianas.
  // O Firestore anterior preservava apenas category='proteina',
  // sem informar qual era o tipoPrato da FUMP.
  'bolinho de soja com batata',
  'quibe de cenoura',
  'assado de grao de bico',
]);

// 1. Categorias revisadas de receitas + exceções verificadas.
// 2. Nomes observados no histórico ou na última varredura.
// O catálogo inteiro é autoritativo para nomes exatos.
const VERIFIED_DISH_CATEGORIES = Object.freeze({
  ...ICA_CATALOG,
  ...UNREGISTERED_OVERRIDES,
  ...Object.fromEntries([...VERIFIED_VEGETARIAN_LEGACY].map(name=>[name,'vegetariana'])),
});

export function knownDishCategory(name) {
  const key=normal(name);
  for (const catalog of [VERIFIED_DISH_CATEGORIES,HISTORICAL_FUMP_CATEGORIES,OBSERVED_FUMP_CATEGORIES_NOV2026]) {
    if (Object.hasOwn(catalog,key)) return catalog[key];
  }
  return '';
}

export function unregisteredCategory(name) {
  return knownDishCategory(name);
}

/** Nome exato conhecido prevalece, senão utilizar apenas tipo FUMP reconhecido. */
export function categoryFromSourceType(sourceType, name = '') {
  const known=knownDishCategory(name);
  if(known) return known;
  const t=normal(sourceType);
  if(t.includes('entrada')) return 'salada';
  if(t.includes('sobremesa')) return 'sobremesa';
  if(t.includes('um copo') || t.includes('refresco') || t.includes('bebida')) return 'bebida';
  if(t.includes('guarnicao')) return 'guarnicao';
  if(t.includes('acompanhamento')) return 'acompanhamento';
  if(t.includes('vegetariano') || t.includes('vegano') || /\bproteico\s*3\b/.test(t)) return 'vegetariana';
  if(t.includes('proteico') || t.includes('proteina')) return 'proteina';
  return '';
}

/**
 * Mesmo critério na exibição, inclusive dados já recebidos e cache legado.
 * Apenas snapshots sem sourceType podem preservar categoria válida anterior,
 * pois não temos como reconstruir a evidência original. Tipo explícito
 * desconhecido ou não cadastrado nunca autoriza aproveitar uma categoria errada.
 */
export function publishedCategory(category,name,sourceType='') {
  const known=knownDishCategory(name);
  if(known) return known;
  if(normal(sourceType)) return categoryFromSourceType(sourceType,name);
  const saved=normal(category);
  return ['proteina','vegetariana','guarnicao','acompanhamento',
    'salada','molho','sobremesa','bebida'].includes(saved) ? saved : '';
}
