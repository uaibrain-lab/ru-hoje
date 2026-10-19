/** Merge snapshot fetched in a disposable runner with last Firestore publication.
 * Incoming successfully validated meals replace old meals even if fewer dishes,
 * because the FUMP can change the menu. Unfetched meals remain for resilience. */
export function mergeSnapshots(previous, incoming, now = new Date()) {
  if (incoming?.schemaVersion !== 1 || !incoming?.generatedAt || !incoming?.days || typeof incoming.days !== 'object') {
    throw new Error('Snapshot entrante ausente ou fora do esquema');
  }
  const old = previous?.schemaVersion === 1 && previous.days && typeof previous.days === 'object' ? previous : {days:{}};
  const merged = {schemaVersion:1, generatedAt:incoming.generatedAt, source:incoming.source, days:{}};
  const todayParts = {};
  for (const part of new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)) todayParts[part.type]=part.value;
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const shift = days => {const d=new Date(`${today}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
  const earliest=shift(-7), latest=shift(10);
  for (const date of new Set([...Object.keys(old.days), ...Object.keys(incoming.days)])) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < earliest || date > latest) continue;
    const base=old.days[date]?.restaurants || {};
    const next=incoming.days[date]?.restaurants || {};
    const restaurants={};
    for (const id of new Set([...Object.keys(base), ...Object.keys(next)])) {
      if (!['setorial-i','setorial-ii','saude','direito','ica'].includes(id)) continue;
      const oldRu=base[id] || {}, newRu=next[id] || {};
      const meals={};
      for (const meal of new Set([...Object.keys(oldRu.meals || {}), ...Object.keys(newRu.meals || {})])) {
        if (!['almoco','jantar','cafe'].includes(meal)) continue;
        const candidate=newRu.meals?.[meal];
        const oldMeal=oldRu.meals?.[meal];
        const chosen=(candidate?.items?.length && (!oldMeal?.fetchedAt || !candidate.fetchedAt || Date.parse(candidate.fetchedAt)>=Date.parse(oldMeal.fetchedAt))) ? candidate : oldMeal;
        if (chosen?.items?.length) meals[meal]=chosen;
      }
      if (Object.keys(meals).length) {
        const fetchedAt=Object.values(meals).map(m=>m.fetchedAt).filter(Boolean).sort().at(-1) || newRu.fetchedAt || oldRu.fetchedAt;
        restaurants[id]={meals,fetchedAt};
      }
    }
    if (Object.keys(restaurants).length) merged.days[date]={restaurants};
  }
  return merged;
}
