import {hoursFor, REGULAR_HOURS} from './hours.js';

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

/** Mantém o rótulo 'hoje' e acrescenta a bolinha só quando não há atendimento regular previsto. */
export function dateChipLabel(isToday, missing) {
  if (isToday) return missing ? 'hoje ·' : 'hoje';
  return missing ? '·' : '';
}

/**
 * A bolinha indica exclusivamente um dia sem atendimento REGULAR previsto
 * para o RU selecionado — nunca ausência de cardápio ou erro da API.
 * Sem RU escolhido, não há indicador. Feriados e exceções não são inferidos.
 */
export function isNonOperatingDay(iso, restaurantId) {
  if (!restaurantId || !Object.hasOwn(REGULAR_HOURS,restaurantId)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const date=new Date(iso+'T12:00:00Z');
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0,10)!==iso) return false;
  return hoursFor(restaurantId,iso).length===0;
}
