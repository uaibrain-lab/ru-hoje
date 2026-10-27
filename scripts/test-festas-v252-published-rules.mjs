// Reproduz exatamente as regras lidas no Console; somente Firebase Emulator.
import assert from 'node:assert/strict';
const project='demo-bandeco';const firestoreHost=process.env.FIRESTORE_EMULATOR_HOST;const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
if(!firestoreHost||!authHost||process.env.GCLOUD_PROJECT!==project)throw Error('Bloqueio: este teste exige somente o emulador demo-bandeco.');
const base=`http://${firestoreHost}/v1/projects/${project}/databases/(default)/documents`;
async function token(email){const response=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'LocalRulesOnly123!',returnSecureToken:true})});const body=await response.json();if(!response.ok)throw Error(JSON.stringify(body));return body.idToken;}
async function request(method,path,auth){return fetch(`${base}/${path}`,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},body:method==='PATCH'?JSON.stringify({fields:{uid:{stringValue:'forged'},enabled:{booleanValue:true}}}):undefined});}
const anonymous=await token(`anonymous-simulation-${Date.now()}@example.test`);const googleUnauthorized=await token(`google-unauthorized-simulation-${Date.now()}@example.test`);
for(const [label,auth] of [['unauthenticated',null],['anonymous',anonymous],['google-not-owner',googleUnauthorized]]){
  assert.equal((await request('PATCH','eventAdminAccess/owner',auth)).status,403,`${label}: create denied`);
  assert.equal((await request('GET','eventAdminAccess/owner',auth)).status,403,`${label}: read denied`);
  assert.equal((await request('DELETE','eventAdminAccess/owner',auth)).status,403,`${label}: delete denied`);
}
console.log('REGRAS PUBLICADAS NO EMULADOR: anônimo, Google não autorizado, não autenticado, UID forjado, alteração enabled e exclusão negados; regras reproduzidas exatamente, sem Firestore real.');
