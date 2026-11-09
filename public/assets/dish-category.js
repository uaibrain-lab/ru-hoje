/**
 * Correções conservadoras para dados oficiais da FUMP sem tipo cadastrado
 * e snapshots legados que não distinguiam prato protéico 3 (vegetariano).
 *
 * Evidência: FUMP, 20/10/2026, API JSON IDs 1, 2, 5, 6.
 * Nunca inferir indiscriminadamente proteína por palavras como "bife"
 * ("Bife de milho" é vegetariano) ou "bolinho".
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
});

// Catálogo auxiliar alimentado pelo PDF "Ingredientes - ICA".
// Ele só é consultado quando a FUMP não informa um tipo confiável;
// classificações oficiais reconhecidas continuam prevalecendo.
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
  'salada seria': 'salada',
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

export function unregisteredCategory(name) {
  const key = normal(name);
  // A FUMP pode enviar strogonoff sem tipo cadastrado. O prato continua
  // sendo principal; somente a variante explicitamente vegana é vegetariana.
  if (/\bstrogonoff\b/.test(key)) {
    return /\b(?:vegano|vegetariano)\b/.test(key) ? 'vegetariana' : 'proteina';
  }
  return UNREGISTERED_OVERRIDES[key] || ICA_CATALOG[key] || '';
}

/**
 * Interpreta somente a classificação oficial publicada pela FUMP.
 * A posição "Prato protéico 3" é a alternativa vegetariana observada
 * nos cardápios oficiais; os demais protéicos continuam proteínas.
 * Retorno vazio: a fonte não deu uma classificação conhecida.
 */
export function categoryFromSourceType(sourceType, name = '') {
  const t = normal(sourceType);
  if (t.includes('entrada')) return 'salada';
  if (t.includes('sobremesa')) return 'sobremesa';
  if (t.includes('um copo') || t.includes('refresco') || t.includes('bebida')) return 'bebida';
  if (t.includes('guarnicao')) return 'guarnicao';
  if (t.includes('acompanhamento')) return 'acompanhamento';
  if (t.includes('vegetariano') || t.includes('vegano') || /\bproteico\s*3\b/.test(t)) return 'vegetariana';
  if (t.includes('proteico') || t.includes('proteina')) return 'proteina';
  if (t === 'tipo de item nao cadastrado' || !t) return unregisteredCategory(name);
  return '';
}

/**
 * Exibição de snapshots novos e legados.
 * 1. Prioriza o tipo oficial original quando presente e reconhecido.
 * 2. Sem essa evidência, aplica somente exceções pontuais verificadas.
 * Nunca escreve ou altera dados remotamente.
 */
export function publishedCategory(category, name, sourceType = '') {
  const original = normal(sourceType);
  // Correções nominais confirmadas para casos em que o tipo da FUMP veio
  // ausente ou inconsistente com a natureza do prato.
  const nameKey = normal(name);
  if (nameKey === 'soja refogada com legumes') return 'vegetariana';
  if (nameKey === 'frango ao molho de tomate') return 'proteina';
  // Em uma resposta antiga sem tipo oficial, preservar categoria legada
  // exceto para os nomes que sabemos terem sido classificados incorretamente.
  if (original && original !== 'tipo de item nao cadastrado') {
    const official = categoryFromSourceType(sourceType, name);
    if (official) return official;
  }
  const saved = normal(category);
  if (!saved || saved === 'outros' || saved === 'tipo de item nao cadastrado') {
    return (original === '' || original === 'tipo de item nao cadastrado')
      ? (ICA_CATALOG[nameKey] || unregisteredCategory(name) || saved)
      : saved;
  }
  // O catálogo pode corrigir somente categorias legadas claramente conflitantes;
  // nunca substitui uma categoria legada diferente sem evidência suficiente.
  if ((original === '' || original === 'tipo de item nao cadastrado') &&
      ((saved === 'proteina' && ICA_CATALOG[nameKey] === 'vegetariana') ||
       (saved === 'molho' && ICA_CATALOG[nameKey] === 'proteina'))) {
    return ICA_CATALOG[nameKey];
  }
  // Somente para dados legados sem tipo original: indicação vegetariana explícita
  // no nome ou nomes já confirmados. Nunca sobrepor a categoria de outra família.
  if (saved === 'proteina' && (VERIFIED_VEGETARIAN_LEGACY.has(normal(name)) ||
      /\b(?:vegetarian[oa]s?|vegan[oa]s?)\b/.test(normal(name)))) {
    return 'vegetariana';
  }
  return category;
}
