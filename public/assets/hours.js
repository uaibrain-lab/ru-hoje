/** Horários regulares publicados pela FUMP. Não indicam funcionamento extraordinário. */
const wd = (cafe, almoco, jantar) => ({cafe, almoco, jantar});
export const REGULAR_HOURS = Object.freeze({
  'setorial-i': {
    weekdays: wd(null, ['10:30','14:00'], ['17:10','19:30']),
    saturday: wd(null, ['11:00','13:00'], null)
  },
  'setorial-ii': {
    weekdays: wd(['06:45','08:00'], ['10:30','14:00'], null),
    saturday: wd(null, null, null)
  },
  saude: {
    weekdays: wd(['07:00','08:00'], ['10:30','14:00'], ['17:30','19:30']),
    saturday: wd(null, ['11:30','13:00'], null)
  },
  direito: {
    weekdays: wd(['07:00','08:00'], ['11:00','14:00'], ['17:30','19:30']),
    saturday: wd(null, null, null)
  },
  ica: {
    weekdays: wd(['06:45','08:00'], ['11:00','13:30'], ['17:30','19:30']),
    saturday: wd(null, ['11:15','13:00'], null)
  }
});
const LABELS={cafe:'Café da manhã',almoco:'Almoço',jantar:'Jantar'};
const KEYS=['cafe','almoco','jantar'];
const TIMEZONE='America/Sao_Paulo';
const minute = s => Number(s.slice(0,2))*60+Number(s.slice(3,5));
export const shortHour = s => {const [h,m]=s.split(':').map(Number);return `${h}h${m?String(m).padStart(2,'0'):''}`;};
export function brClock(date=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:TIMEZONE, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
    minute:'2-digit',hourCycle:'h23'
  }).formatToParts(date).map(part=>[part.type,part.value]));
  return {iso:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};
}
export function hoursFor(ruId, iso) {
  const rule=REGULAR_HOURS[ruId]; if(!rule) return [];
  const weekday=new Date(`${iso}T12:00:00Z`).getUTCDay();
  const data=weekday===0?null:weekday===6?rule.saturday:rule.weekdays;
  return data ? KEYS.filter(k=>data[k]).map(k=>({id:k,label:LABELS[k],start:data[k][0],end:data[k][1],startMinute:minute(data[k][0]),endMinute:minute(data[k][1])})) : [];
}
const addDay=(iso,days)=> {const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
export function currentOpening(ruId, time=new Date()) {
  const clock=brClock(time);
  const slots=hoursFor(ruId,clock.iso);
  const open=slots.find(s=>clock.minute>=s.startMinute && clock.minute<s.endMinute);
  if(open) return {state:'open',message:`Aberto agora · fecha às ${shortHour(open.end)}`,details:`${open.label} · ${shortHour(open.start)}–${shortHour(open.end)}`};
  for(let i=0;i<8;i++) {
    const iso=addDay(clock.iso,i);
    const upcoming=hoursFor(ruId,iso).find(s=>i>0 || clock.minute<s.startMinute);
    if (upcoming) {
      let when = i===0?'':i===1?'amanhã ':'';
      if (i>1) when=new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',weekday:'long'}).format(new Date(`${iso}T12:00:00Z`))+' ';
      return {state:'closed',message:`Fechado · abre ${when}às ${shortHour(upcoming.start)}`,details:`Próxima refeição: ${upcoming.label.toLowerCase()}`};
    }
  }
  return {state:'closed',message:'Sem horário regular disponível',details:''};
}
export function weeklySummary(ruId) {
  const rule=REGULAR_HOURS[ruId]; if(!rule) return [];
  const show=slots=>KEYS.flatMap(k=>slots[k]?[`${LABELS[k]} ${shortHour(slots[k][0])}–${shortHour(slots[k][1])}`]:[]);
  return [
    {day:'Seg–sex',services:show(rule.weekdays)},
    {day:'Sábado',services:show(rule.saturday)},
    {day:'Domingo',services:[]}
  ];
}
