// Copia somente publicMenus/current da produção para a homologação.
// Padrão: leitura e validação. A escrita exige --write e uma credencial exclusiva
// de bandeco-homologacao em HOMOLOGATION_FIREBASE_SERVICE_ACCOUNT_JSON ou ADC
// temporária explicitamente apontada para a configuração isolada de QA.
import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_PROJECT = 'cardapioufmg';
const TARGET_PROJECT = 'bandeco-homologacao';
const DOCUMENT_PATH = 'publicMenus/current';
const SOURCE_URL = `https://firestore.googleapis.com/v1/projects/${SOURCE_PROJECT}/databases/(default)/documents/${DOCUMENT_PATH}`;
const write = process.argv.includes('--write');
const requestedProject = process.argv.find((arg) => arg.startsWith('--project='))?.slice('--project='.length);
if (requestedProject !== TARGET_PROJECT) throw new Error(`Use --project=${TARGET_PROJECT}; nenhum outro destino é permitido.`);

const allowedRestaurants = new Set(['setorial-i', 'setorial-ii', 'saude', 'direito', 'ica']);
const allowedMeals = new Set(['almoco', 'jantar']);
const allowedDayKeys = /^\d{4}-\d{2}-\d{2}$/;
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} inválido.`);
  return value;
};

function validateMenu(menu) {
  if (!menu || menu.schemaVersion !== 1 || typeof menu.days !== 'object' || !menu.days) throw new Error('Snapshot sem schemaVersion/days válidos.');
  text(menu.source, 'source');
  for (const [day, dayData] of Object.entries(menu.days)) {
    if (!allowedDayKeys.test(day) || !dayData || typeof dayData.restaurants !== 'object') throw new Error(`Dia inválido: ${day}`);
    for (const [restaurant, restaurantData] of Object.entries(dayData.restaurants)) {
      if (!allowedRestaurants.has(restaurant) || !restaurantData || typeof restaurantData.meals !== 'object') throw new Error(`RU inválido: ${restaurant}`);
      for (const [meal, mealData] of Object.entries(restaurantData.meals)) {
        if (!allowedMeals.has(meal) || !mealData || !Array.isArray(mealData.items)) throw new Error(`Refeição inválida: ${restaurant}/${meal}`);
        for (const item of mealData.items) text(item?.name, `Prato ${day}/${restaurant}/${meal}`);
      }
    }
  }
  return {days: Object.keys(menu.days).length, restaurants: new Set(Object.values(menu.days).flatMap((d) => Object.keys(d.restaurants))).size};
}

const response = await fetch(SOURCE_URL, {headers: {'accept': 'application/json'}});
if (!response.ok) throw new Error(`Leitura pública bloqueada: HTTP ${response.status}.`);
const firestoreDoc = await response.json();
const payload = firestoreDoc?.fields?.payload?.stringValue;
if (typeof payload !== 'string') throw new Error('Documento público não contém fields.payload.stringValue.');
const menu = JSON.parse(payload);
const summary = validateMenu(menu);
const capturedAt = new Date().toISOString();
const diagnostics = {capturedAt, sourceProject: SOURCE_PROJECT, targetProject: TARGET_PROJECT, document: DOCUMENT_PATH, sourceUpdateTime: firestoreDoc.updateTime ?? null, generatedAt: menu.generatedAt ?? null, ...summary, writeRequested: write, writePerformed: false};

if (write) {
  const raw = process.env.HOMOLOGATION_FIREBASE_SERVICE_ACCOUNT_JSON;
  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const isolatedConfig = process.env.CLOUDSDK_CONFIG;
  const adcIsolated = adcPath && isolatedConfig
    && path.resolve(adcPath).startsWith(path.resolve(isolatedConfig) + path.sep);
  if (!raw && !adcIsolated) throw new Error('Para escrever, use credencial JSON exclusiva da homologação ou ADC por impersonação dentro de CLOUDSDK_CONFIG isolado.');
  let credential;
  if (raw) {
    const credentials = JSON.parse(raw);
    if (credentials.project_id !== TARGET_PROJECT) throw new Error('Credencial não pertence a bandeco-homologacao; escrita abortada.');
    const {cert} = await import('firebase-admin/app');
    credential = cert(credentials);
  } else {
    const {applicationDefault} = await import('firebase-admin/app');
    credential = applicationDefault();
  }
  const [{initializeApp, deleteApp}, {getFirestore, FieldValue}] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
  const app = initializeApp({credential, projectId: TARGET_PROJECT}, 'menu-copy-homologation');
  try {
    const db = getFirestore(app);
    await db.doc(DOCUMENT_PATH).set({payload, updatedAt: FieldValue.serverTimestamp()}, {merge: false});
    diagnostics.writePerformed = true;
  } finally { await deleteApp(app); }
}

const output = path.resolve('diagnostics/menu-copy-v256.json');
await fs.mkdir(path.dirname(output), {recursive: true});
await fs.writeFile(output, JSON.stringify(diagnostics, null, 2) + '\n');
console.log(JSON.stringify(diagnostics, null, 2));
