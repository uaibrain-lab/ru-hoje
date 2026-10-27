// Bandeco QA v2.6.0-RC1: público somente via Rules; exclusões cliente proibidas.
// O sorteio oficial continua exclusivo do executor privado e não é autorizado em produção.
import {backend} from './festas-backend.js';
import {clean,cleanRules,handle,httpsUrl,normalizeTicketUrl,maskName,normalizeTags,EVENT_TAGS,csvSafe,validateEvent,drawEligible,encryptPrivate,decryptPrivate,drawAtMs} from './festas-core.js';
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
async function localHandleFingerprint(uid,instagram){
  const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${uid}:${instagram}`));
  return Array.from(new Uint8Array(buffer)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
const DEMO=['localhost','127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('festas-demo')==='1';
function initialParticipantSlot(){try{const value=Number(localStorage.getItem('bandeco:festas:participant-slot'));return Number.isInteger(value)&&value>=0&&value<3?value:0;}catch{return 0;}}
const state={events:[],allEvents:[],selected:null,editingId:'',editorMode:'list',editorGeneration:0,currentEvent:null,admin:false,user:null,service:null,participantSlot:initialParticipantSlot(),participantGeneration:0,participantUid:'',signupHandle:'',demoProfiles:new Map(),demoEntries:new Map(),demoResults:new Map(),posterDataUrl:'',posterCache:new Map(),posterReadGeneration:0,eventsUnsubscribe:null,eventsGeneration:0,adminPrivateKey:null,privateRecords:[],defaultRules:'',tagCatalog:[],demoEvents:[{
  id:'exemplo',name:'Festa parceira (demonstração)',organizer:'Atlética de exemplo',place:'Belo Horizonte',startsAt:'2026-11-06T22:00',
  description:'Evento fictício para testar o layout.',tags:['Open Bar','Open Food'],posterUrl:'',ticketUrl:'https://example.org/ingressos',
  raffleStatus:'disabled',drawAt:'',rulesText:'',winnerCount:0,alternateCount:0,participantCount:0,published:true
}]};
function note(id,text,error=false){const el=$(id);if(el){el.textContent=text;el.dataset.error=String(error);}}
function openModal(id){const d=$(id);if(d&&!d.open)d.showModal();}
function closeModal(id){const d=$(id);if(!d)return;if(d.tagName==='DIALOG'){if(d.open)d.close();}else d.hidden=true;}
function showSaveResult(success,title,message,retry){const titleEl=$('admin-save-title'),messageEl=$('admin-save-message'),retryEl=$('admin-save-retry'),okEl=$('admin-save-ok'),dialog=$('admin-save-dialog');if(!titleEl)return;titleEl.textContent=title;messageEl.textContent=message;retryEl.hidden=!retry;retryEl.textContent=success?'Tentar novamente':'Confirmar';retryEl.onclick=()=>{closeModal('admin-save-dialog');retry?.();};okEl.onclick=()=>closeModal('admin-save-dialog');dialog.hidden=false;queueMicrotask(()=>retry?retryEl.focus():okEl.focus());}
function button(label,cls,action){const b=make('button',cls,label);b.type='button';b.addEventListener('click',action);return b;}
function visibilityIcon(visible){return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="2.8"></circle>${visible?'':'<path d="m4 4 16 16"></path>'}</svg>`;}
function trashIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="m7 7 1 13h8l1-13"></path><path d="M10 11v5M14 11v5"></path></svg>';}
function localizedDate(raw){if(!raw)return '';const [ymd,hm]=String(raw).split('T');const [y,m,d]=(ymd||'').split('-');return `${d||'--'}/${m||'--'} · ${hm||'--:--'}`;}
function plural(count,singular,pluralForm){return `${count} ${count===1?singular:pluralForm}`;}
function switchTab(tab){
  const pages={menu:'bandeco-main',festas:'festas-page',interno:'interno-page',sobre:'sobre-page'};
  if(!Object.hasOwn(pages,tab))return;
  const changed=!Object.entries(pages).some(([name,id])=>name===tab && !$(id).hidden);
  for(const [name,id] of Object.entries(pages)){
    $(id).hidden=name!==tab;
    const button=$('tab-'+name);button.setAttribute('aria-current',name===tab?'page':'false');button.classList.toggle('is-active',name===tab);
  }
  if(tab==='festas')void refreshEvents();else stopPublicEventsListener();
  if(tab==='interno')notifyInternoShown();
  if(changed)window.scrollTo(0,0);
}
function notifyInternoShown(){
  const page=$('interno-page'),iframe=$('interno-frame');
  if(!page||page.hidden||!iframe?.contentWindow)return;
  requestAnimationFrame(()=>iframe.contentWindow?.postMessage({type:'bandeco:interno:shown'},window.location.origin));
}
async function service(){if(!state.service)state.service=await backend();return state.service;}
function publicEventsActive(){return !document.hidden && !$('festas-page').hidden;}
function stopPublicEventsListener(){
  state.eventsGeneration++;
  if(state.eventsUnsubscribe){state.eventsUnsubscribe();state.eventsUnsubscribe=null;}
}
async function refreshEvents(){
  if(DEMO){state.events=state.demoEvents.filter(e=>e.published && !e.archived).sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)));renderEvents();return;}
  if(!publicEventsActive() || state.eventsUnsubscribe)return;
  const generation=++state.eventsGeneration;
  try{
    const {db,dbMod}=await service();
    if(generation!==state.eventsGeneration || !publicEventsActive())return;
    const q=dbMod.query(dbMod.collection(db,'events'),dbMod.where('published','==',true),dbMod.where('archived','==',false),dbMod.limit(40));
    state.eventsUnsubscribe=dbMod.onSnapshot(q,snap=>{
      if(generation!==state.eventsGeneration || !publicEventsActive())return;
      state.events=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)));
      note('festas-status','');renderEvents();
    },()=>{if(generation!==state.eventsGeneration)return;state.events=[];renderEvents();note('festas-status','Festas temporariamente indisponíveis.',true);});
  }catch(error){if(generation!==state.eventsGeneration)return;state.events=[];renderEvents();note('festas-status','Festas temporariamente indisponíveis.',true);}
}
function safePosterDataUrl(value){return typeof value==='string' && /^data:image\/(?:webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length<=330000 ? value : '';}
function setPosterStatus(img,text,error=false){const status=img?.parentElement?.querySelector('.festa-poster-status');if(status){status.textContent='';status.dataset.error=String(error);status.hidden=true;}}
async function paintPoster(event,img){
  const cached=state.posterCache.get(event.id);
  if(cached){img.src=cached;img.hidden=false;setPosterStatus(img,'');return;}
  if(!event.hasUploadedPoster || DEMO)return;
  const readGeneration=state.posterReadGeneration;
  const adminRead=state.admin;
  setPosterStatus(img,'Carregando cartaz…');
  try{const svc=await service();const {db,adminDb,dbMod}=svc;
    // Cartazes ocultos/arquivados só são legíveis pelo admin. Visitantes continuam
    // usando a instância pública e só recebem cartazes de eventos publicados.
    const posterDb=state.admin?adminDb:db;
    const snap=await dbMod.getDoc(dbMod.doc(posterDb,'eventPosters',event.id));
    if(!snap.exists())throw new Error('Cartaz não encontrado.');const src=safePosterDataUrl(snap.data().imageDataUrl);
    if(!src)throw new Error('Cartaz inválido ou fora do limite.');
    if(img.isConnected && readGeneration===state.posterReadGeneration && (!adminRead || state.admin)){state.posterCache.set(event.id,src);img.src=src;img.hidden=false;setPosterStatus(img,'');}
  }catch(error){if(img.isConnected && readGeneration===state.posterReadGeneration && (!adminRead || state.admin)){img.hidden=false;img.classList.add('festa-poster-fallback');setPosterStatus(img,'Não foi possível carregar este cartaz. Tente novamente no painel.',true);if(state.admin)note('admin-status','Não foi possível carregar o cartaz salvo. Selecione o arquivo novamente para tentar outra vez.',true);}}
}
async function optimizePoster(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>3_000_000)throw new Error('Use PNG, JPG ou WebP com até 3 MB.');
  const image=await createImageBitmap(file);
  try{
    const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw new Error('Este navegador não permite otimizar imagens.');
    for(const maxSide of [1100,950,800,650,500]){
      const scale=Math.min(1,maxSide/Math.max(image.width,image.height));
      canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of [.82,.7,.58,.45]){
        const out=canvas.toDataURL('image/webp',quality);
        if(safePosterDataUrl(out) && Math.ceil(out.length*3/4)<240000)return out;
      }
    }
    throw new Error('Imagem muito detalhada para o limite gratuito. Experimente uma imagem menor.');
  }finally{image.close?.();}
}
function renderEvents(){const root=$('festas-list');root.replaceChildren();
  if(!state.events.length){root.append(make('p','festas-empty','Nenhuma festa publicada no momento.'));return;}
  for(const e of state.events){
    const card=make('article','festa-card festa-card-v21');
    const top=make('div','festa-card-body');
    const heading=make('div','festa-card-heading');const names=make('div');names.append(make('h3','',clean(e.name)),make('p','festa-organizer',clean(e.organizer)));
    heading.append(names);
    const tags=make('div','festa-tags');normalizeTags(e.tags).forEach(t=>tags.append(make('span','festa-tag-chip',tagLabel(t))));heading.append(tags);top.append(heading);
    top.append(make('p','festa-details',`${localizedDate(e.startsAt)} · ${clean(e.place)}`));
    if(e.description)top.append(make('p','festa-desc festa-card-desc',clean(e.description,700)));
    const actions=make('div','festa-actions');
    const ticket=httpsUrl(e.ticketUrl);
    if(ticket){const a=make('a','festa-action festa-ticket','INGRESSOS 🔥');a.href=ticket;a.target='_blank';a.rel='noopener noreferrer sponsored';actions.append(a);}
    const drawMs=DEMO?Date.parse(`${e.drawAt||''}:00-03:00`):drawAtMs(e);
    if(e.raffleStatus==='open' && Number.isFinite(drawMs) && Date.now()<drawMs){
      actions.append(button('Sorteio','festa-action festa-action-primary',()=>openSignup(e)));
      actions.append(make('span','festa-count',plural(DEMO?state.demoEntries.get(e.id)?.size||0:Number(e.participantCount)||0,'inscrito','inscritos')));
    }else if(e.raffleStatus==='drawn')actions.append(button('Resultados!','festa-action festa-action-primary',()=>showResult(e)));
    else if(e.raffleStatus==='open')actions.append(make('span','festa-count',Number.isFinite(drawMs)&&Date.now()>=drawMs?'Inscrições encerradas · aguardando apuração':'Inscrições abertas'));
    else if(e.raffleStatus==='closed')actions.append(make('span','festa-count','Inscrições encerradas'));
    top.append(actions);card.append(top);
    if((DEMO && e.posterDataUrl) || e.hasUploadedPoster || httpsUrl(e.posterUrl)){
      const img=make('img','festa-art');img.alt=`Arte de ${clean(e.name)}`;img.loading='lazy';img.referrerPolicy='no-referrer';
      const inline=safePosterDataUrl(DEMO?e.posterDataUrl:'');
      if(inline)img.src=inline;
      else if(httpsUrl(e.posterUrl))img.src=httpsUrl(e.posterUrl);
      else img.hidden=true;
      img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label','Abrir cartaz completo');
      const openPoster=()=>{const full=$('poster-full');full.src=img.currentSrc||img.src;full.alt=img.alt;$('poster-title').textContent=`Cartaz completo · ${clean(e.name)}`;openModal('poster-dialog');};
      img.addEventListener('click',openPoster);img.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();openPoster();}});
      const posterStatus=make('small','festa-poster-status');posterStatus.hidden=true;card.append(img,posterStatus);
      if(!DEMO && e.hasUploadedPoster)void paintPoster(e,img);
    }
    root.append(card);
  }
}
function setSignupStep(step){for(const name of ['rules','handle'])$('signup-step-'+name).hidden=name!==step;$('signup-form').hidden=step!=='profile';}
function participantLabel(){return `Participante neste dispositivo · perfil ${state.participantSlot+1}`;}
function updateParticipantLabel(){const el=$('signup-participant-identity');if(el)el.textContent=participantLabel();}
function participantDb(svc){return svc.participantDbs?.[state.participantSlot]||svc.db;}
function waitForAuthState(auth,authMod,predicate,timeout=7000){if(predicate(auth.currentUser))return Promise.resolve(auth.currentUser);return new Promise((resolve,reject)=>{let timer;const stop=authMod.onAuthStateChanged(auth,user=>{if(!predicate(user))return;clearTimeout(timer);stop();resolve(user);});timer=setTimeout(()=>{stop();reject(new Error('A nova sessão anônima não respondeu a tempo.'));},timeout);});}
function clearParticipantForm(){state.signupHandle='';state.participantUid='';$('signup-ig').value='';$('signup-name').value='';$('signup-email').value='';$('signup-marketing').checked=false;note('signup-result','');setSignupStep('handle');updateParticipantLabel();}
function closeParticipantSwitchPrompt(){const dialog=$('participant-switch-dialog');if(dialog)dialog.hidden=true;}
function openParticipantSwitchPrompt(){const dialog=$('participant-switch-dialog');if(!dialog)return;dialog.hidden=false;queueMicrotask(()=>$('participant-switch-cancel').focus());}
async function switchParticipant(){
  closeParticipantSwitchPrompt();const generation=++state.participantGeneration;
  if(DEMO){state.participantSlot=(state.participantSlot+1)%3;clearParticipantForm();note('signup-result','Novo participante fictício selecionado nesta aba local.');return;}
  try{
    const svc=await service();const oldSlot=state.participantSlot;const current=svc.participantAuths[oldSlot];const previousUid=current.currentUser?.uid||state.participantUid||'';
    if(current.currentUser)await svc.authMod.signOut(current);
    await waitForAuthState(current,svc.authMod,user=>!user);
    const nextSlot=(oldSlot+1)%svc.participantAuths.length;const next=svc.participantAuths[nextSlot];
    // A slot usada anteriormente também é encerrada antes de criar uma nova identidade.
    if(next.currentUser)await svc.authMod.signOut(next);
    await waitForAuthState(next,svc.authMod,user=>!user);
    const result=(await svc.authMod.signInAnonymously(next)).user;
    const fresh=await waitForAuthState(next,svc.authMod,user=>Boolean(user?.isAnonymous));
    if(generation!==state.participantGeneration)throw new Error('A troca de participante foi substituída por outra ação.');
    if(!fresh?.uid||fresh.uid===previousUid)throw new Error('Não foi possível criar uma identidade anônima diferente.');
    state.participantSlot=nextSlot;state.participantUid=fresh.uid;
    try{localStorage.setItem('bandeco:festas:participant-slot',String(nextSlot));}catch{}
    clearParticipantForm();note('signup-result','Nova sessão independente iniciada neste dispositivo.');
  }catch(error){note('signup-result',error?.message||'Não foi possível iniciar outra sessão. A inscrição anterior foi preservada.',true);}
}
function openSignup(e){state.selected=e;state.signupHandle='';$('signup-event-terms').checked=false;$('signup-marketing').checked=false;$('signup-ig').value='';updateParticipantLabel();
  $('signup-title').textContent=`Sorteio · ${clean(e.name)}`;
  const rules=$('signup-rules');rules.replaceChildren(make('p','festa-rules-text',cleanRules(e.rulesText,1800)||'Regras ainda não configuradas.'),make('p','festa-draw-date',`Apuração prevista: ${localizedDate(e.drawAt)}`));
  note('signup-result','');setSignupStep('rules');openModal('signup-dialog');
}
function signupRulesNext(){if(!$('signup-event-terms').checked){note('signup-result','Confirme que leu as regras.',true);return;}
  note('signup-result','');setSignupStep('handle');}
function demoAddEntry(e,ig){let entries=state.demoEntries.get(e.id);if(!entries){entries=new Set();state.demoEntries.set(e.id,entries);}
  if(entries.has(ig)){note('signup-result','Você já está inscrito neste sorteio.');setSignupStep('done');return;}
  entries.add(ig);e.participantCount=entries.size;setSignupStep('done');note('signup-result','Inscrição confirmada! Boa sorte!');refreshEvents();
}
async function signupContinue(){const ig=handle($('signup-ig').value);if(!ig){note('signup-result','Informe um @ válido.',true);return;}state.signupHandle=ig;
  if(!DEMO){
    try{
       const svc=await service();const {participantAuths,authMod,dbMod}=svc;const db=participantDb(svc);const auth=participantAuths[state.participantSlot];
       const user=auth.currentUser?.isAnonymous?auth.currentUser:(await authMod.signInAnonymously(auth)).user;
      const uid=user.uid;
      state.participantUid=uid;
      const entry=await dbMod.getDoc(dbMod.doc(db,'events',state.selected.id,'entries',uid));
      if(entry.exists()){
        const ownHandle=localStorage.getItem('bandeco:festas:own:'+uid);
        const sameHandle=ownHandle===await localHandleFingerprint(uid,ig);
        if(!sameHandle){
          note('signup-result','Já existe uma inscrição nesta sessão. Para cadastrar outro @, escolha “Inscrever outra pessoa”.',true);
          openParticipantSwitchPrompt();return;
        }
        note('signup-result','Você já está inscrito neste sorteio.');setSignupStep('done');return;
      }
      const profile=await dbMod.getDoc(dbMod.doc(db,'eventProfiles',uid));
      // O @ no navegador não é autenticação; só reaproveita a inscrição na MESMA sessão anônima.
      const ownHandle=localStorage.getItem('bandeco:festas:own:'+uid);
      if(profile.exists()&&ownHandle===await localHandleFingerprint(uid,ig)){
        await joinWithOwner(uid);return;
      }
      $('signup-name').value='';$('signup-email').value='';$('signup-marketing').checked=false;
      note('signup-result',profile.exists()?'Confirme seus dados neste dispositivo para associar o @.':'Primeiro cadastro: preencha nome e e-mail.');
      setSignupStep('profile');return;
    }catch(err){note('signup-result','Não foi possível confirmar sua inscrição. Tente novamente.',true);return;}
  }
  if(state.demoProfiles.has(ig)){demoAddEntry(state.selected,ig);return;}
  $('signup-name').value='';$('signup-email').value='';$('signup-marketing').checked=false;note('signup-result','Primeiro cadastro: preencha apenas nome e e-mail.');setSignupStep('profile');
}
async function joinWithOwner(uid){
  const e=state.selected;if(!e)throw Error('Evento não encontrado.');
  const svc=await service();const {dbMod}=svc;const db=participantDb(svc);
  const ref=dbMod.doc(db,'events',e.id),entry=dbMod.doc(db,'events',e.id,'entries',uid);
  const profileSnap=await dbMod.getDoc(dbMod.doc(db,'eventProfiles',uid));
  const encryptedProfile=profileSnap.data()?.encrypted;
  if(!encryptedProfile)throw Error('Cadastro protegido não encontrado.');
  const already=await dbMod.runTransaction(db,async tx=>{
    const [eventSnap,entrySnap]=await Promise.all([tx.get(ref),tx.get(entry)]);
    if(entrySnap.exists())return true;
    if(!eventSnap.exists())throw Error('Festa indisponível.');
    const fresh=eventSnap.data();
    if(fresh.raffleStatus!=='open'||!fresh.published||!Number.isFinite(drawAtMs(fresh)))throw Error('Inscrições encerradas.');
    if(fresh.participantCount>=5000)throw Error('Limite operacional de inscrições atingido.');
    tx.update(ref,{participantCount:fresh.participantCount+1});
    tx.set(entry,{createdAt:dbMod.serverTimestamp(),termsAcceptedAt:dbMod.serverTimestamp(),encryptedProfile});
    return false;
  });
  setSignupStep('done');note('signup-result',already?'Você já está inscrito neste sorteio.':'Inscrição confirmada! Boa sorte!');await refreshEvents();
}
async function signupSubmit(ev){ev.preventDefault();
  if(!DEMO){
    const ig=state.signupHandle,name=clean($('signup-name').value,100),email=clean($('signup-email').value,160);
    if(!ig||name.length<3||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      note('signup-result','Informe nome e e-mail válidos.',true);return;
    }
    $('signup-submit').disabled=true;
    try{
       const svc=await service();const {participantAuths,authMod,dbMod}=svc;const db=participantDb(svc);const auth=participantAuths[state.participantSlot];
       const uid=(auth.currentUser?.isAnonymous?auth.currentUser:(await authMod.signInAnonymously(auth)).user).uid;
      state.participantUid=uid;
      const response=await fetch('/assets/festas-public-key.json',{cache:'no-store'});
      if(!response.ok)throw Error('Chave pública não disponível.');
      const {key}=await response.json();
      if(!key?.n)throw Error('Chave de proteção ainda não configurada.');
      const encrypted=await encryptPrivate({instagram:ig,name,email,marketingConsent:$('signup-marketing').checked,
        acceptedAt:new Date().toISOString()},key);
      await dbMod.setDoc(dbMod.doc(db,'eventProfiles',uid),{encrypted,updatedAt:dbMod.serverTimestamp(),schemaVersion:1});
      // O texto do @ só fica neste dispositivo; no Firestore o identificador é cifrado.
      try{localStorage.setItem('bandeco:festas:own:'+uid,await localHandleFingerprint(uid,ig));}catch{}
      await joinWithOwner(uid);
    }catch(err){note('signup-result',err?.message==='Inscrições encerradas.'?err.message:'Não foi possível concluir a inscrição; nenhuma informação pessoal foi publicada.',true);}
    finally{$('signup-submit').disabled=false;}return;
  }
  const name=clean($('signup-name').value,100),email=clean($('signup-email').value,160);
  if(name.length<3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){note('signup-result','Informe nome e e-mail válidos.',true);return;}
  const ig=state.signupHandle;if(!ig||!state.selected)return;
  state.demoProfiles.set(ig,{instagram:ig,name,email,marketingConsent:$('signup-marketing').checked,createdAt:new Date().toISOString()});
  demoAddEntry(state.selected,ig);
}
function showResult(e){$('result-title').textContent=`Resultados · ${clean(e.name)}`;const root=$('result-body');root.replaceChildren();openModal('result-dialog');
  if(DEMO){const data=state.demoResults.get(e.id);if(!data){root.append(make('p','','Ainda não há resultados nesta demonstração.'));return;}
    root.append(make('p','festa-small',`${plural(data.participantCount,'inscrição','inscrições')} ${data.participantCount===1?'recebida':'recebidas'}.`));
    for(const [key,title] of [['winners','Ganhadores'],['alternates','Suplentes']]){root.append(make('h3','',title));if(!data[key].length)root.append(make('p','festa-small','Nenhum.'));
      data[key].forEach((x,i)=>root.append(make('p','',`${i+1}º · ${maskName(x.name)}`)));}return;}
  service().then(async({db,dbMod})=>{const snap=await dbMod.getDoc(dbMod.doc(db,'events',e.id,'results','official'));
    if(!snap.exists()||snap.data().status!=='published')throw new Error('Resultado ainda não publicado.');
    const data=snap.data();for(const [key,title] of [['winners','Ganhadores'],['alternates','Suplentes']]){root.append(make('h3','',title));(data[key]||[]).forEach((x,i)=>root.append(make('p','',`${i+1}º · ${clean(x.mask,80)}`)));}}
  ).catch(()=>root.append(make('p','','Resultado indisponível.')));
}
async function clearAdminSession(){
  state.posterReadGeneration++;
  state.admin=false;state.user=null;state.allEvents=[];state.privateRecords=[];state.adminPrivateKey=null;state.posterCache.clear();
  if($('admin-private-key'))$('admin-private-key').value='';
  const preview=$('admin-poster-preview');if(preview){preview.removeAttribute('src');preview.hidden=true;preview.classList.remove('festa-poster-fallback');}
  $('admin-forms-list')?.replaceChildren();
  $('admin-panel').hidden=true;$('admin-login').hidden=false;closeModal('admin-dialog');
}
async function logoutAdmin(){const {adminAuth,authMod}=await service();await authMod.signOut(adminAuth);await clearAdminSession();}
// Diagnóstico estritamente técnico: somente fase e código normalizado, jamais erro bruto ou identidade.
function ocupaAdminDiag(stage,error){
  const raw=typeof error?.code==='string'?error.code:'';
  const code=/^(?:auth\/[a-z0-9-]+|permission-denied|unavailable|failed-precondition|unauthenticated|owner-mismatch|provider-missing)$/.test(raw)?raw:'unknown';
  console.warn('OCUPA_P2_AUTH_DIAG',stage,code);
  return code;
}
async function authorized(){const {adminAuth,authMod,adminDb,dbMod}=await service();let user=adminAuth.currentUser;
  if(!user || user.isAnonymous){
    try{const res=await authMod.signInWithPopup(adminAuth,new authMod.GoogleAuthProvider());user=res.user;}
    catch(error){ocupaAdminDiag('google-popup',error);throw error;}
  }
  if(!user || user.isAnonymous || !user.providerData?.some(item=>item.providerId==='google.com')){
    ocupaAdminDiag('google-provider-check',{code:'provider-missing'});
    await authMod.signOut(adminAuth);state.user=null;return false;
  }
  try{
    const snap=await dbMod.getDoc(dbMod.doc(adminDb,'eventAdminAccess','owner'));
    const data=snap.exists()?snap.data():null;
    if(data?.enabled===true&&data.uid===user.uid){state.user=user;return true;}
    ocupaAdminDiag('owner-check',{code:'owner-mismatch'});
    await authMod.signOut(adminAuth);state.user=null;return false;
  }catch(error){
    ocupaAdminDiag('owner-document-read',error);
    await authMod.signOut(adminAuth).catch(()=>{});state.user=null;
    if(error?.code==='permission-denied')throw new Error('As regras publicadas ainda bloqueiam a verificação administrativa.');
    throw error;
  }
}
async function openAdmin(){openModal('admin-dialog');note('admin-status','');if(DEMO){state.admin=true;$('admin-login').hidden=true;$('admin-panel').hidden=false;
    note('admin-status','Laboratório: acesso administrativo fictício. Não conectado à produção.');await loadDefaultRules();await loadTagCatalog();await renderAdminEvents();adminTab('events');return;}
  let ocupaAdminStage='authentication-and-owner';
  try{if(!await authorized()){note('admin-status','Acesso não autorizado.',true);return;}state.admin=true;$('admin-login').hidden=true;$('admin-panel').hidden=false;
    note('admin-status','Acesso administrativo autorizado. Dados pessoais indisponíveis até revisão de segurança.');
    ocupaAdminStage='load-default-rules';await loadDefaultRules();
    ocupaAdminStage='load-tag-catalog';await loadTagCatalog();
    ocupaAdminStage='load-admin-events';await renderAdminEvents();adminTab('events');}
  catch(err){const code=ocupaAdminDiag(ocupaAdminStage,err);await clearAdminSession();openModal('admin-dialog');
    const base=err.message==='As regras publicadas ainda bloqueiam a verificação administrativa.'?err.message:'Falha ao autenticar conta administrativa.';
    const detail=new URLSearchParams(location.search).get('authdiag')==='1'?` [P2.1: ${ocupaAdminStage} / ${code}]`:'';
    note('admin-status',base+detail,true);}
}
function adminTab(tab){const f=tab==='forms';$('admin-events-panel').hidden=f;$('admin-forms-panel').hidden=!f;$('admin-tab-events').setAttribute('aria-current',f?'false':'page');
  $('admin-tab-forms').setAttribute('aria-current',f?'page':'false');if(f)renderForms();}
async function renderAdminEvents(){let events=[];
  if(DEMO)events=state.demoEvents;
  else {const {adminDb,dbMod}=await service();events=(await dbMod.getDocs(dbMod.collection(adminDb,'events'))).docs.map(d=>({id:d.id,...d.data()}));}
  state.allEvents=events.sort((a,b)=>String(a.startsAt||'').localeCompare(String(b.startsAt||'')));
  const list=$('admin-events-list'),hiddenList=$('admin-hidden-list'),hiddenWrap=$('admin-hidden-wrap'),archivedList=$('admin-archived-list'),archivedWrap=$('admin-archived-wrap');if(!list)return;list.replaceChildren();hiddenList?.replaceChildren();archivedList?.replaceChildren();
  const active=events.filter(e=>e.archived!==true&&e.published===true),hidden=events.filter(e=>e.archived!==true&&e.published!==true),archived=events.filter(e=>e.archived===true);
  if(!active.length)list.append(make('p','festa-empty','Nenhuma festa publicada. Use “＋ Criar festa” ou abra a seção “Ocultas”.'));
  const renderRow=(e,isArchived=false,target=list)=>{
    const row=make('article','festa-admin-event-row');
    const info=make('div','festa-admin-event-info');
    const dueMs=DEMO?Date.parse(`${e.drawAt||''}:00-03:00`):drawAtMs(e);const raffleLabel=e.raffleStatus==='drawn'?'Resultado publicado':e.raffleStatus==='open'&&Number.isFinite(dueMs)&&Date.now()>=dueMs?'Aguardando apuração':e.raffleStatus==='open'?'Inscrições abertas':'Sem sorteio ativo';
    const participantCount=Number.isInteger(e.participantCount)&&e.participantCount>=0?e.participantCount:0;
    info.append(make('strong','',clean(e.name||'Sem nome')),make('span','festa-small',`${localizedDate(e.startsAt)} · ${isArchived?'Arquivada':e.published?'Publicada':'Oculta'} · ${raffleLabel} · ${plural(participantCount,'inscrito','inscritos')}`));
    const actions=make('div','festa-admin-event-actions');
    const edit=button('✎','icon-btn',()=>openEditor(e.id));edit.setAttribute('aria-label',`Editar ${clean(e.name)}`);edit.title='Editar festa';
    const toggle=button('','icon-btn',()=>isArchived?restoreEvent(e):askTogglePublished(e));toggle.innerHTML=isArchived?'↺':visibilityIcon(e.published===true);toggle.setAttribute('aria-label',isArchived?'Restaurar festa':e.published?'Ocultar festa':'Exibir festa');toggle.title=isArchived?'Restaurar festa':e.published?'Ocultar festa':'Exibir festa';
    const del=button('','icon-btn danger',()=>askDeleteEvent(e));del.innerHTML=trashIcon();del.setAttribute('aria-label',`Arquivar ${clean(e.name||'festa')} (não exclui definitivamente)`);del.title=e.raffleStatus==='drawn'?'Histórico protegido':'Arquivar festa (reversível); remover definitivamente apenas em manutenção QA';
    actions.append(edit,toggle);if(!isArchived)actions.append(del);row.append(info,actions);target.append(row);
    return row;
  };
  active.forEach(e=>renderRow(e,false,list));
  if(hiddenWrap){hiddenWrap.hidden=!hidden.length;hidden.forEach(e=>renderRow(e,false,hiddenList));}
  if(archivedWrap){archivedWrap.hidden=!archived.length;archived.forEach(e=>renderRow(e,true,archivedList));}
}
function setEditorVisible(visible){$('admin-events-list-wrap').hidden=visible;$('admin-editor').hidden=!visible;$('admin-editor-title').textContent=state.editorMode==='create'?'Criar festa':'Editar festa';$('admin-duplicate-event').hidden=state.editorMode!=='edit';}
function resetEditor(){for(const k of ['name','place','organizer','description','startsAt','ticketUrl','rulesText','drawAt'])$('admin-'+k).value='';$('admin-winnerCount').value=0;$('admin-alternateCount').value=0;$('admin-published').checked=false;$('admin-raffleStatus').value='disabled';$('admin-tags').replaceChildren();$('admin-poster-file').value='';const img=$('admin-poster-preview');img.hidden=true;img.removeAttribute('src');toggleTagComposer(false);$('admin-save-default-rules').checked=false;for(const key of ['raffleStatus','winnerCount','alternateCount','drawAt','rulesText','published'])$('admin-'+key).disabled=false;state.posterDataUrl='';}
function openCreate(){state.editorGeneration++;state.editorMode='create';state.editingId='';state.currentEvent=null;resetEditor();for(const tag of [...EVENT_TAGS,...state.tagCatalog])tagOption(tag,false);if(state.defaultRules)$('admin-rulesText').value=state.defaultRules;setEditorVisible(true);$('admin-name').focus();}
function openEditor(id){const generation=++state.editorGeneration;state.editorMode='edit';state.editingId=id;state.currentEvent=state.allEvents.find(x=>x.id===id)||null;setEditorVisible(true);loadEditor(id,generation);}
function backToList(){state.editorGeneration++;state.editorMode='list';state.editingId='';state.currentEvent=null;setEditorVisible(false);note('admin-status','');renderAdminEvents();}
async function askTogglePublished(event){
  if(event.published===true && event.raffleStatus==='open' && Number(event.participantCount)>0){
    showSaveResult(false,'Sorteio com participantes','Esta festa já recebeu inscrições. Para preservar a apuração, não é possível ocultá-la diretamente; procure o procedimento administrativo de cancelamento.');
    return;
  }
  const hiding=event.published;const suffix=event.raffleStatus==='drawn'?' Os resultados concluídos e o histórico serão preservados.':'';showSaveResult(false,hiding?'Ocultar festa?':'Exibir festa?',hiding?`A festa deixará de aparecer na área pública.${suffix}`:'A festa voltará a aparecer na área pública.',async()=>{await togglePublished(event);});}
async function togglePublished(event){
  try{
    if(!state.admin)throw Error('Faça login como administrador.');
    if(DEMO){event.published=!event.published;await renderAdminEvents();await refreshEvents();note('admin-status',event.published?'Festa exibida.':'Festa ocultada.');return;}
    const {adminDb,dbMod}=await service();
    const ref=dbMod.doc(adminDb,'events',event.id);
    const visible=await dbMod.runTransaction(adminDb,async tx=>{
      const snapshot=await tx.get(ref);
      if(!snapshot.exists())throw Error('Festa não encontrada. Atualize a lista.');
      const fresh=snapshot.data();
      if(!Object.hasOwn(fresh,'archived'))throw Error('Festa antiga sem campo archived. É necessário concluir o saneamento QA para que apareça publicamente.');
      if(fresh.archived===true)throw Error('Restaure a festa arquivada antes de mudar sua visibilidade.');
      if(fresh.published===true&&fresh.raffleStatus==='open'&&Number(fresh.participantCount)>0)
        throw Error('Esta festa tem inscrições em aberto. É necessário um procedimento de cancelamento, não apenas ocultar.');
      if(!Number.isInteger(fresh.participantCount))
        throw Error('Festa legada sem contador válido. Precisa de saneamento QA antes da alteração.');
      const next=fresh.published!==true;
      tx.update(ref,{published:next,updatedAt:dbMod.serverTimestamp()});
      return next;
    });
    // O commit já foi confirmado: erro de atualização de tela não é erro de gravação.
    try{await renderAdminEvents();await refreshEvents();note('admin-status',visible?'Festa exibida na área pública.':'Festa ocultada da área pública.');}
    catch{note('admin-status',`Visibilidade ${visible?'publicada':'ocultada'} no Firestore, mas a lista não pôde ser atualizada. Reabra o painel.`,true);}
  }catch(error){
    const permission=error?.code==='permission-denied';
    const message=permission
      ? 'Firestore recusou a alteração. Verifique se as Rules deste pacote já foram homologadas/publicadas no QA, se o administrador está autorizado e se o evento é legado.'
      : (error?.message||'Não foi possível alterar a visibilidade desta festa.');
    note('admin-status',message,true);
    showSaveResult(false,'Visibilidade não alterada',message);
  }
}
async function askDeleteEvent(event){
  if(event.raffleStatus==='drawn'||Number(event.participantCount)>0){
    showSaveResult(false,'Histórico protegido','Esta festa possui inscrições ou resultados. Não é permitido apagar ou arquivar esses dados pelo navegador. A administração pode consultar o histórico e, quando permitido, ocultar a publicação.');
    return;
  }
  showSaveResult(false,'Arquivar festa?','A festa ficará oculta e será movida para Arquivadas. Isso NÃO exclui o documento. Exclusão definitiva de testes exige manutenção QA separada.',()=>deleteEvent(event));
}
async function deleteEvent(event){
  try{
    if(DEMO){if(event.raffleStatus==='drawn'||Number(event.participantCount)>0)throw Error('Festa com histórico não pode ser arquivada.');event.archived=true;event.published=false;await renderAdminEvents();await refreshEvents();note('admin-status','Festa arquivada sem excluir dados.');return;}
    const {adminDb,dbMod}=await service();const ref=dbMod.doc(adminDb,'events',event.id);
    await dbMod.runTransaction(adminDb,async tx=>{
      const [snap,pub,priv]=await Promise.all([
        tx.get(ref),tx.get(dbMod.doc(adminDb,'events',event.id,'results','official')),
        tx.get(dbMod.doc(adminDb,'events',event.id,'resultPrivate','official'))
      ]);
      if(!snap.exists())throw Error('Esta festa não está mais disponível.');
      const fresh=snap.data();
      if(pub.exists()||priv.exists()||fresh.raffleStatus==='drawn'||fresh.participantCount!==0)
        throw Error('Festa com inscrições ou resultado: histórico protegido; nenhuma informação foi excluída.');
      if(!fresh.archived)tx.update(ref,{archived:true,published:false,updatedAt:dbMod.serverTimestamp()});
    });
    // Não tentar repetir um arquivamento já confirmado apenas porque o refresh falhou.
    try{await renderAdminEvents();await refreshEvents();note('admin-status','Festa arquivada. Nenhum cadastro foi apagado.');}
    catch{note('admin-status','Festa arquivada no Firestore, mas a lista não pôde ser atualizada. Reabra o painel.',true);}
  }catch(error){note('admin-status',error?.message||'Não foi possível arquivar a festa.',true);}
}
async function restoreEvent(event){try{
  if(DEMO){event.archived=false;await renderAdminEvents();note('admin-status','Festa restaurada em Ocultas. Use o ícone de olho para publicar.');return;}
  const {adminDb,dbMod}=await service();
  await dbMod.updateDoc(dbMod.doc(adminDb,'events',event.id),{archived:false,updatedAt:dbMod.serverTimestamp()});
  try{await renderAdminEvents();note('admin-status','Festa restaurada em Ocultas. Use o ícone de olho para publicar.');}
  catch{note('admin-status','Festa restaurada no Firestore, mas a lista não pôde ser atualizada. Reabra o painel.',true);}
}catch(error){note('admin-status',error?.message||'Não foi possível restaurar a festa.',true);}}
function duplicateForTest(){const source=state.currentEvent;if(!source)return;state.editorGeneration++;state.editorMode='create';state.editingId='';state.currentEvent=null;resetEditor();for(const k of ['place','organizer','description','startsAt','ticketUrl'])$('admin-'+k).value=source[k]||'';$('admin-name').value=`${source.name||'Festa'} (novo teste)`;$('admin-published').checked=false;for(const tag of normalizeTags(source.tags||[]))tagOption(tag,true);setEditorVisible(true);$('admin-name').focus();note('admin-status','Cópia de teste criada sem inscrições, resultados ou dados pessoais.');}
async function loadDefaultRules(){
  if(DEMO){try{state.defaultRules=cleanRules(localStorage.getItem('bandeco:festas:regras-demo')||'',1800);}catch{state.defaultRules='';}return;}
  const {adminDb,dbMod}=await service();
  try{const snap=await dbMod.getDoc(dbMod.doc(adminDb,'eventSettings','raffleDefaults'));
    state.defaultRules=snap.exists()?cleanRules(snap.data().rulesText||'',1800):'';
  }catch{state.defaultRules='';}
}
async function loadTagCatalog(){
  if(DEMO){try{state.tagCatalog=normalizeTags(JSON.parse(localStorage.getItem('bandeco:festas:tags-demo')||'[]'),30);}catch{state.tagCatalog=[];}return;}
  try{const {adminDb,dbMod}=await service();const snap=await dbMod.getDoc(dbMod.doc(adminDb,'eventSettings','tagCatalog'));
    state.tagCatalog=snap.exists()?normalizeTags(snap.data().tags||[],30):[];
  }catch{state.tagCatalog=[];}
}
async function saveTagCatalog(){
  if(DEMO){try{localStorage.setItem('bandeco:festas:tags-demo',JSON.stringify(state.tagCatalog));}catch{}return;}
  const {adminDb,dbMod}=await service();
  await dbMod.setDoc(dbMod.doc(adminDb,'eventSettings','tagCatalog'),{tags:state.tagCatalog,updatedAt:dbMod.serverTimestamp()});
}
function tagLabel(tag){
  const emoji={'Open Bar':'🍹','Open Food':'🍔','Festa à fantasia':'🎭'};
  return emoji[tag] ? `${emoji[tag]} ${tag}` : `🏷️ ${tag}`;
}
function tagOption(tag,checked=false){
  const old=[...$('admin-tags').querySelectorAll('input')].find(x=>x.value.toLocaleLowerCase('pt-BR')===tag.toLocaleLowerCase('pt-BR'));
  if(old){old.checked=old.checked||checked;return;}
  const label=make('label','festa-check');const input=make('input');input.type='checkbox';input.value=tag;input.checked=checked;
  label.append(input,document.createTextNode(tagLabel(tag)));$('admin-tags').append(label);
}
function toggleTagComposer(open){
  $('admin-tag-composer').hidden=!open;
  $('admin-show-tag').setAttribute('aria-expanded',String(open));
  if(open)$('admin-new-tag').focus();
  else $('admin-new-tag').value='';
}
async function customTag(){
  const text=$('admin-new-tag').value;const normalized=normalizeTags([text]);
  if(!normalized.length){note('admin-status','Tag inválida. Use entre 2 e 28 caracteres, sem símbolos de código.',true);return;}
  const selected=$('admin-tags').querySelectorAll('input:checked').length;
  if(selected>=8){note('admin-status','Selecione no máximo 8 tags.',true);return;}
  tagOption(normalized[0],true);$('admin-new-tag').value='';toggleTagComposer(false);
  if(!EVENT_TAGS.includes(normalized[0]) && !state.tagCatalog.some(x=>x.toLocaleLowerCase('pt-BR')===normalized[0].toLocaleLowerCase('pt-BR'))){
    state.tagCatalog=normalizeTags([...state.tagCatalog,normalized[0]],30);
    try{await saveTagCatalog();}catch{note('admin-status','Tag selecionada nesta festa, mas não foi possível salvar no catálogo global.',true);return;}
  }
  note('admin-status','Tag adicionada e disponível nas próximas festas. Salve este evento para associá-la.');
}
function loadEditor(id,generation=state.editorGeneration){const e=state.allEvents.find(x=>x.id===id)||{};if(generation!==state.editorGeneration||state.editorMode!=='edit'||state.editingId!==id)return;state.currentEvent=e;state.posterDataUrl='';
  toggleTagComposer(false);
  $('admin-save-default-rules').checked=false;
  $('admin-poster-file').value='';
  $('admin-tags').replaceChildren();
  for(const tag of [...EVENT_TAGS,...state.tagCatalog])tagOption(tag,(e.tags||[]).includes(tag));
  for(const tag of normalizeTags(e.tags||[]))tagOption(tag,true);
  for(const k of ['name','place','organizer','description','startsAt','ticketUrl','rulesText','drawAt'])$('admin-'+k).value=e[k]||'';
  $('admin-winnerCount').value=e.winnerCount??0;$('admin-alternateCount').value=e.alternateCount??0;$('admin-published').checked=e.published===true;
  $('admin-raffleStatus').value=e.raffleStatus||'disabled';
  if(!id && !e.rulesText && state.defaultRules)$('admin-rulesText').value=state.defaultRules;
  const img=$('admin-poster-preview');const preview=safePosterDataUrl(DEMO?e.posterDataUrl:'')||state.posterCache.get(id)||httpsUrl(e.posterUrl);
  img.hidden=!preview;if(preview)img.src=preview;else img.removeAttribute('src');
  if(id && e.hasUploadedPoster && !DEMO && !state.posterCache.has(id))void paintPoster(e,img);
  const immutable=e.raffleStatus==='drawn';$('admin-raffleStatus').disabled=immutable;$('admin-winnerCount').disabled=immutable;$('admin-alternateCount').disabled=immutable;$('admin-drawAt').disabled=immutable;$('admin-rulesText').disabled=immutable;$('admin-published').disabled=immutable;
  note('admin-editor-hint',immutable?'Sorteio concluído: use o ícone de olho na lista para ocultar ou exibir, sem modificar os resultados. Use uma cópia para um novo teste.':'');
}
async function saveEvent(ev){ev.preventDefault();if(!state.admin)return;const saveButton=$('admin-editor')?.querySelector('button[type="submit"]');const wasEditing=Boolean(state.editingId);if(wasEditing&&state.currentEvent?.raffleStatus==='drawn'){note('admin-status','Sorteio concluído: crie uma cópia para alterar os parâmetros.',true);return;}if(saveButton){saveButton.disabled=true;saveButton.dataset.originalLabel=saveButton.textContent;saveButton.textContent='Salvando…';}
  try{const raw={};for(const k of ['name','place','organizer','description','startsAt','ticketUrl','rulesText','drawAt'])raw[k]=$('admin-'+k).value;
    if(raw.ticketUrl.trim()){
      const normalized=normalizeTicketUrl(raw.ticketUrl);
      if(!normalized)throw Error('Link inválido: informe um domínio válido, como sympla.com.br/evento. Apenas HTTPS é permitido.');
      raw.ticketUrl=normalized;
      $('admin-ticketUrl').value=normalized;
    }
    // Manter URLs legadas que já estejam no Firestore sem expor um novo campo;
    // se uma imagem for enviada, ela substitui a origem legada.
    const previous=state.allEvents.find(x=>x.id===state.editingId);
    raw.posterUrl=state.posterDataUrl?'':(previous?.posterUrl||'');
    raw.tags=[...$('admin-tags').querySelectorAll('input:checked')].map(x=>x.value);
    raw.winnerCount=Number($('admin-winnerCount').value);raw.alternateCount=Number($('admin-alternateCount').value);
    raw.raffleStatus=$('admin-raffleStatus').value;raw.published=$('admin-published').checked;raw.archived=previous?.archived===true;
    const payload=validateEvent(raw);payload.archived=raw.archived===true;
    if(payload.raffleStatus!=='disabled'){
      const localTimestamp=Date.parse(payload.drawAt+':00-03:00'); // horário de Brasília
      if(!Number.isFinite(localTimestamp))throw new Error('Data de apuração inválida.');
      payload.drawAtTimestamp=new Date(localTimestamp);
    }
    const saveDefaults=$('admin-save-default-rules').checked && payload.rulesText.trim().length>0;
    if(DEMO){const id=state.editingId||`demo-${Date.now()}`;const prev=state.demoEvents.find(e=>e.id===id);
      state.demoEvents=state.demoEvents.filter(e=>e.id!==id);
      const image=state.posterDataUrl||prev?.posterDataUrl||'';
      state.demoEvents.push({...payload,id,posterDataUrl:image,hasUploadedPoster:!!image,participantCount:state.demoEntries.get(id)?.size||0});
      if(saveDefaults){state.defaultRules=payload.rulesText;try{localStorage.setItem('bandeco:festas:regras-demo',state.defaultRules);}catch{}}
      state.posterDataUrl='';note('admin-status','Festa salva no laboratório, sem deploy nem gravação remota.');await renderAdminEvents();await refreshEvents();backToList();showSaveResult(true,wasEditing?'Alterações salvas!':'Festa criada com sucesso!',wasEditing?'As informações da festa foram atualizadas.':'A festa foi salva. Você já pode consultá-la na lista de eventos.');return;}
    if(raw.raffleStatus==='drawn')throw new Error('Resultados são publicados somente pelo executor privado.');
     if(payload.raffleStatus==='open'&&(!payload.drawAtTimestamp||payload.drawAtTimestamp.getTime()<=Date.now())){
      const unchangedExpiredEvent=wasEditing && previous?.raffleStatus==='open'
        && drawAtMs(previous)===payload.drawAtTimestamp?.getTime();
      if(!unchangedExpiredEvent)throw new Error('Escolha um horário futuro para abrir inscrições.');
    }
    const {adminDb,dbMod}=await service();const id=state.editingId;const ref=id?dbMod.doc(adminDb,'events',id):dbMod.doc(dbMod.collection(adminDb,'events'));
    const prev=state.allEvents.find(x=>x.id===id);
    const batch=dbMod.writeBatch(adminDb);
     if(payload.drawAtTimestamp)payload.drawAtTimestamp=dbMod.Timestamp.fromDate(payload.drawAtTimestamp);
     delete payload.drawAtUtc;
     const eventData={...payload,hasUploadedPoster:!!state.posterDataUrl||prev?.hasUploadedPoster===true,updatedAt:dbMod.serverTimestamp()};
     if(id)eventData.participantCount=prev?.participantCount||0;
     else eventData.participantCount=0;
     batch.set(ref,eventData,{merge:true});
    const posterToSave=state.posterDataUrl;
    if(posterToSave){batch.set(dbMod.doc(adminDb,'eventPosters',ref.id),{imageDataUrl:posterToSave,updatedAt:dbMod.serverTimestamp()});}
    if(saveDefaults){batch.set(dbMod.doc(adminDb,'eventSettings','raffleDefaults'),{rulesText:payload.rulesText,updatedAt:dbMod.serverTimestamp()});state.defaultRules=payload.rulesText;}
     await batch.commit();
     if(posterToSave)state.posterCache.set(ref.id,posterToSave);
     state.posterDataUrl='';
     // Commit confirmado: falha posterior de refresh não pode produzir duplicação em retry.
     if(!id){state.editingId=ref.id;state.editorMode='edit';}
     try{await renderAdminEvents();await refreshEvents();backToList();}
     catch{note('admin-status','Festa salva, mas a lista não pôde ser atualizada. Reabra o painel para conferir.',true);}
     showSaveResult(true,wasEditing?'Alterações salvas!':'Festa criada com sucesso!',wasEditing?'As informações da festa foram atualizadas.':'A festa foi salva. Você já pode consultá-la na lista de eventos.');
  }catch(err){const message=err?.message||'Verifique os campos e tente novamente.';note('admin-status',message,true);showSaveResult(false,'Não foi possível salvar a festa',message,()=>saveEvent(ev));}
  finally{if(saveButton){saveButton.disabled=false;saveButton.textContent=saveButton.dataset.originalLabel||'Salvar festa';}}
}
function forms(){return [...state.demoProfiles.values()].sort((a,b)=>a.instagram.localeCompare(b.instagram)).map(p=>{
  const eventIds=[...state.demoEntries].filter(([,set])=>set.has(p.instagram)).map(([id])=>id);
  const outcomes=[];for(const [eventId,result] of state.demoResults){
    if(result.winners.some(x=>x.instagram===p.instagram))outcomes.push(`${state.demoEvents.find(e=>e.id===eventId)?.name||eventId}: ganhador(a)`);
    else if(result.alternates.some(x=>x.instagram===p.instagram))outcomes.push(`${state.demoEvents.find(e=>e.id===eventId)?.name||eventId}: suplente`);
  }
  return {...p,eventIds,participations:eventIds.length,outcomes};});}
async function renderForms(){const root=$('admin-forms-list');root.replaceChildren();if(!DEMO){
    $('admin-private-key-panel').hidden=false;
    if(!state.adminPrivateKey){$('admin-forms-counter').textContent='Abra sua chave privada para consultar os cadastros criptografados.';return;}
    try{
      const {adminDb,dbMod}=await service();const profiles=await dbMod.getDocs(dbMod.collection(adminDb,'eventProfiles'));
      const records=[];
      for(const p of profiles.docs){
        try{const data=await decryptPrivate(p.data().encrypted,state.adminPrivateKey);
          records.push({uid:p.id,...data});}catch{/* perfil ilegível não vaza */}
      }
      const byUid=new Map(records.map(r=>[r.uid,{...r,participations:0,outcomes:[]} ]));
      // Todas as relações de participação são privadas e só podem ser listadas pelo dono.
      for(const e of state.allEvents){
        const rows=await dbMod.getDocs(dbMod.collection(adminDb,'events',e.id,'entries'));
        for(const row of rows.docs){const profile=byUid.get(row.id);if(profile)profile.participations++;}
        const winners=await dbMod.getDoc(dbMod.doc(adminDb,'events',e.id,'resultPrivate','official'));
        if(winners.exists()){
          const report=winners.data();for(const uid of report.winnerUids||[]){const profile=byUid.get(uid);if(profile)profile.outcomes.push(`${e.name}: ganhador(a)`);}
          for(const uid of report.alternateUids||[]){const profile=byUid.get(uid);if(profile)profile.outcomes.push(`${e.name}: suplente`);}
        }
      }
      state.privateRecords=[...byUid.values()];
      $('admin-forms-counter').textContent=`${plural(records.length,'cadastro protegido','cadastros protegidos')}`;
      for(const r of state.privateRecords){const row=make('div','festa-form-record');
        row.append(make('strong','',`${r.name} · @${r.instagram}`),make('p','',
          `${r.email} · ${plural(r.participations,'inscrição','inscrições')} · Publicidade: ${r.marketingConsent?'sim':'não'}${r.outcomes.length?' · '+r.outcomes.join('; '):''}`));
        root.append(row);
      }
    }catch{note('admin-status','Falha na leitura protegida.',true);}return;
  }
  const people=forms();const total=[...state.demoEntries.values()].reduce((n,set)=>n+set.size,0);$('admin-forms-counter').textContent=`${plural(people.length,'cadastro','cadastros')} · ${plural(total,'inscrição','inscrições')}`;
  people.forEach(p=>{const row=make('div','festa-form-record');const info=make('div');info.append(make('strong','',`@${p.instagram} · ${p.name}`),make('p','',`${p.email} · ${plural(p.participations,'participação','participações')} · Marketing: ${p.marketingConsent?'sim':'não'}${p.outcomes.length?' · '+p.outcomes.join('; '):''}`));
    row.append(info,button('Apagar','festa-secondary',()=>showSaveResult(false,'Apagar cadastro fictício?',`Isso remove @${p.instagram} e suas inscrições apenas da demonstração local.`,()=>{
      state.demoProfiles.delete(p.instagram);for(const [eventId,set] of state.demoEntries){set.delete(p.instagram);const event=state.demoEvents.find(e=>e.id===eventId);if(event)event.participantCount=set.size;}state.demoResults.clear();renderForms();refreshEvents();})));root.append(row);});
}
function exportCSV(){if(!state.admin){return;}
  if(!DEMO&&!state.adminPrivateKey){note('admin-status','Desbloqueie sua chave privada antes de exportar.',true);return;}
  const rows=[['Instagram','Nome','Email','Aceita publicidade','Participacoes'],...(DEMO?forms():state.privateRecords).map(p=>['@'+p.instagram,p.name,p.email,p.marketingConsent?'sim':'não',p.participations??0])];
  const csv='\uFEFF'+rows.map(r=>r.map(csvSafe).join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=make('a');a.href=url;a.download=DEMO?'bandeco-festas-demonstracao.csv':'bandeco-festas-privado.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function deleteAll(){if(!DEMO||!state.admin)return;showSaveResult(false,'Apagar cadastros fictícios?', 'Todos os cadastros, inscrições e resultados da demonstração local serão removidos.',()=>{state.demoProfiles.clear();state.demoEntries.clear();state.demoResults.clear();for(const e of state.demoEvents){e.participantCount=0;if(e.raffleStatus==='drawn')e.raffleStatus='closed';}renderForms();refreshEvents();});}
function demoScheduler(){if(!DEMO)return;
  for(const e of state.demoEvents){if(e.raffleStatus!=='open'||!e.drawAt||Date.now()<new Date(e.drawAt).getTime()||state.demoResults.has(e.id))continue;
    const people=[...(state.demoEntries.get(e.id)||[])].map(ig=>state.demoProfiles.get(ig)).filter(Boolean);
    if(!people.length)continue;
    const result=drawEligible(people,e.winnerCount,e.alternateCount);
    state.demoResults.set(e.id,{...result,participantCount:people.length,drawnAt:new Date().toISOString()});e.raffleStatus='drawn';refreshEvents();
    note('festas-status','Sorteio SIMULADO realizado nesta aba local. Um site fechado não poderia executá-lo.');
  }
}
function init(){
  // A porta visual não fornece privilégio: o backend checa um UID único.
  const portrait=document.querySelector('.identity img');
  const identity=document.querySelector('.identity');
  let taps=0, lastTap=0;
  portrait?.addEventListener('click',ev=>{
    ev.preventDefault();ev.stopPropagation();
    const now=performance.now();if(now-lastTap>2500)taps=0;lastTap=now;taps++;
    if(taps===5){const lock=$('admin-lock');lock.hidden=false;lock.focus();taps=0;}
  });
  // O texto do logotipo segue funcionando como link para o início.
  identity?.setAttribute('title','Ir para o cardápio');
  const side=$('bandeco-navigation'),collapse=$('sidebar-collapse');
  collapse?.addEventListener('click',()=>{
    const closed=side.classList.toggle('is-collapsed');
    collapse.setAttribute('aria-expanded',String(!closed));
    collapse.setAttribute('aria-label',closed?'Expandir menu lateral':'Recolher menu lateral');
    try{localStorage.setItem('bandeco:sidebar:v1',closed?'1':'0');}catch{}
  });
  try{if(localStorage.getItem('bandeco:sidebar:v1')==='1'){
    side.classList.add('is-collapsed');collapse?.setAttribute('aria-expanded','false');
    collapse?.setAttribute('aria-label','Expandir menu lateral');
  }}catch{}
  for(const tab of ['menu','festas','interno','sobre'])$('tab-'+tab).addEventListener('click',()=>switchTab(tab));
  $('interno-frame')?.addEventListener('load',notifyInternoShown);
  $('admin-lock').addEventListener('click',openAdmin);$('admin-login').addEventListener('click',openAdmin);
  const adminClose=$('admin-dialog').querySelector('[data-close]');
  adminClose.addEventListener('click',()=>{clearAdminSession();logoutAdmin().catch(()=>clearAdminSession());});
  $('admin-save-dialog').querySelector('[data-close]').addEventListener('click',()=>closeModal('admin-save-dialog'));
  for(const id of ['signup-dialog','result-dialog','poster-dialog']){$(id).querySelector('[data-close]').addEventListener('click',()=>closeModal(id));}
  $('signup-rules-next').addEventListener('click',signupRulesNext);$('signup-continue').addEventListener('click',signupContinue);$('signup-form').addEventListener('submit',signupSubmit);
  $('admin-tab-events').addEventListener('click',()=>adminTab('events'));$('admin-tab-forms').addEventListener('click',()=>adminTab('forms'));
  $('admin-create-event').addEventListener('click',openCreate);$('admin-back-list').addEventListener('click',backToList);$('admin-duplicate-event').addEventListener('click',duplicateForTest);$('admin-editor').addEventListener('submit',saveEvent);
  $('admin-ticketUrl').addEventListener('blur',event=>{
    const value=event.target.value.trim();if(!value)return;
    const normalized=normalizeTicketUrl(value);if(normalized)event.target.value=normalized;
  });
  $('admin-show-tag').addEventListener('click',()=>toggleTagComposer(true));
  $('admin-cancel-tag').addEventListener('click',()=>toggleTagComposer(false));
  $('admin-add-tag').addEventListener('click',customTag);
  $('admin-new-tag').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();customTag();}});
  $('admin-use-default-rules').addEventListener('click',()=>{
    if(state.defaultRules){$('admin-rulesText').value=state.defaultRules;note('admin-status','Regras padrão carregadas.');}
    else note('admin-status','Não há regras padrão cadastradas. Salve uma festa marcando a opção de padrão.',true);
  });
  $('admin-unlock-private')?.addEventListener('click',async()=>{
    if(!state.admin)return;
    try{const file=$('admin-private-key').files?.[0];if(!file||file.size>15000)throw Error('Arquivo inválido.');
      const key=JSON.parse(await file.text());if(key.kty!=='RSA'||!key.d)throw Error('Chave privada inválida.');
      state.adminPrivateKey=key;await renderForms();note('admin-status','Cadastros descriptografados nesta sessão.');
    }catch{note('admin-status','Não foi possível abrir a chave privada.',true);}
  });
  $('admin-export-csv').addEventListener('click',exportCSV);$('admin-delete-all').hidden=!DEMO;$('admin-delete-all').addEventListener('click',deleteAll);
  $('admin-poster-file').addEventListener('change',async ev=>{const file=ev.target.files?.[0];if(!file)return;
    try{
      const output=await optimizePoster(file);state.posterDataUrl=output;
      $('admin-poster-preview').src=output;$('admin-poster-preview').hidden=false;
      note('admin-status',DEMO?'Arte otimizada e pronta para salvar na demonstração.':'Arte otimizada; ao salvar, será gravada no Firestore como imagem separada.');
    }catch(error){state.posterDataUrl='';note('admin-status',error.message,true);}
  });
  setEditorVisible(false);$('signup-switch-participant')?.addEventListener('click',openParticipantSwitchPrompt);$('participant-switch-cancel')?.addEventListener('click',closeParticipantSwitchPrompt);$('participant-switch-cancel-x')?.addEventListener('click',closeParticipantSwitchPrompt);$('participant-switch-continue')?.addEventListener('click',()=>switchParticipant());
  if(DEMO)setInterval(demoScheduler,1000);
  else {setInterval(()=>{if(publicEventsActive())renderEvents();},15000);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPublicEventsListener();else if(publicEventsActive())void refreshEvents();});}
  if(!DEMO)service().then(({adminAuth,authMod})=>authMod.onAuthStateChanged(adminAuth,user=>{
    const googleUser=user&&!user.isAnonymous&&user.providerData?.some(item=>item.providerId==='google.com');
    if(state.admin&&!googleUser)clearAdminSession();
  })).catch(()=>{});
}
init();
