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
  'molho verde': 'molho',
  'molho de tomate com oregano': 'molho',
  // Itens conhecidos em cardápios sem tipo oficial publicado.
  'assado de grao de bico': 'vegetariana',
  'cassoulet vegetariano': 'vegetariana',
  'bolinho de soja com batata': 'vegetariana',
  'quibe de cenoura': 'vegetariana',
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
  return UNREGISTERED_OVERRIDES[key] || '';
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
  // Em uma resposta antiga sem tipo oficial, preservar categoria legada
  // exceto para os nomes que sabemos terem sido classificados incorretamente.
  if (original && original !== 'tipo de item nao cadastrado') {
    const official = categoryFromSourceType(sourceType, name);
    if (official) return official;
  }
  const saved = normal(category);
  if (!saved || saved === 'outros' || saved === 'tipo de item nao cadastrado') {
    return unregisteredCategory(name) || saved;
  }
  // Somente para dados legados sem tipo original: indicação vegetariana explícita
  // no nome ou nomes já confirmados. Nunca sobrepor a categoria de outra família.
  if (saved === 'proteina' && (VERIFIED_VEGETARIAN_LEGACY.has(normal(name)) ||
      /\b(?:vegetarian[oa]s?|vegan[oa]s?)\b/.test(normal(name)))) {
    return 'vegetariana';
  }
  return category;
}
