// Importação tardia: o cardápio continua acessível offline e sem login.
let cached;
export async function backend(){
  if(cached)return cached;
  const config=window.RU_CONFIG?.firebaseWeb;
  if(!config?.apiKey || !config.projectId || !config.authDomain)throw new Error('Festas aguardam configuração do Firebase Web no ambiente local.');
  const [appMod,authMod,dbMod]=await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js')
  ]);
  const participantApps=Array.from({length:3},(_,index)=>appMod.getApps().find(item=>item.name===`bandeco-participant-${index+1}`)||appMod.initializeApp(config,`bandeco-participant-${index+1}`));
  const adminApp=appMod.getApps().find(item=>item.name==='bandeco-admin')||appMod.initializeApp(config,'bandeco-admin');
  const participantAuths=participantApps.map(app=>authMod.initializeAuth(app,{persistence:[authMod.indexedDBLocalPersistence]}));
  const participantDbs=participantApps.map(app=>dbMod.getFirestore(app));
  const adminAuth=authMod.getAuth(adminApp), db=participantDbs[0], adminDb=dbMod.getFirestore(adminApp);
  if(window.RU_CONFIG?.eventEmulator && ['localhost','127.0.0.1'].includes(location.hostname)){
    participantAuths.forEach(auth=>authMod.connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true}));
    authMod.connectAuthEmulator(adminAuth,'http://127.0.0.1:9099',{disableWarnings:true});
    participantDbs.forEach(item=>dbMod.connectFirestoreEmulator(item,'127.0.0.1',8080));
    dbMod.connectFirestoreEmulator(adminDb,'127.0.0.1',8080);
  }
  cached={auth:participantAuths[0],participantAuths,participantDbs,adminAuth,db,adminDb,authMod,dbMod};
  return cached;
}
