/**
 * Um dia tem cardápio quando há pelo menos um prato publicado em alguma refeição.
 * O cálculo respeita o RU favorito quando selecionado. Sem RU escolhido, verifica
 * os restaurantes conhecidos para não presumir que todos estejam sem cardápio.
 * Não inferir disponibilidade pelos dias da semana: a FUMP poderá abrir domingos.
 */
export function hasMenuForDate(data, iso, restaurantId = null) {
  if (!data?.days || typeof data.days !== 'object') return false;
  const restaurants = data.days[iso]?.restaurants;
  if (!restaurants || typeof restaurants !== 'object') return false;
  const menus = restaurantId ? [restaurants[restaurantId]] : Object.values(restaurants);
  return menus.some(ru => ru?.meals && Object.values(ru.meals).some(meal =>
    Array.isArray(meal?.items) && meal.items.length > 0));
}

/**
 * Sem snapshot carregado = disponibilidade desconhecida, não exibir ponto.
 * Com snapshot carregado, ponto = nenhuma refeição encontrada no app para RU/dia.
 * Não afirma fechamento do restaurante nem que a FUMP jamais publicará o cardápio.
 */
export function isMissingMenu(data, iso, restaurantId = null) {
  return !!(data?.days && typeof data.days === 'object' && !hasMenuForDate(data, iso, restaurantId));
}

/** Mantém o rótulo 'hoje' e acrescenta o indicador só quando não há cardápio. */
export function dateChipLabel(isToday, missing) {
  if (isToday) return missing ? 'hoje ·' : 'hoje';
  return missing ? '·' : '';
}
