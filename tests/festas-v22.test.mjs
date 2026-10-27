import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EVENT_TAGS,normalizeTags,validateEvent} from '../public/assets/festas-core.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('tags padrão e personalizadas: limite, duplicatas e texto seguro',()=>{
  assert.ok(EVENT_TAGS.includes('Open Bar'));
  assert.ok(EVENT_TAGS.includes('Open Food'));
  assert.ok(EVENT_TAGS.includes('Festa à fantasia'));
  assert.deepEqual(normalizeTags(['Open Bar','Festa à fantasia','Meu evento','meu evento','<script>']),['Open Bar','Festa à fantasia','Meu evento']);
  assert.equal(normalizeTags(Array.from({length:20},(_,i)=>`Tag ${i}`)).length,8);
});
test('campos de festa não exigem URL de regulamento ou fundamento jurídico',()=>{
  const value=validateEvent({name:'Festa Atlética',organizer:'Atlética X',place:'UFMG',startsAt:'2026-12-11T21:00',ticketUrl:'https://exemplo.org/ticket',raffleStatus:'open',winnerCount:2,alternateCount:3,drawAt:'2026-12-10T15:00',rulesText:'Seguir o CATM; aguardar a hora do sorteio.',tags:['Open Bar','Festa à fantasia','Aquecimento']});
  assert.equal(value.raffleStatus,'open');
  assert.deepEqual(value.tags,['Open Bar','Festa à fantasia','Aquecimento']);
  assert.equal(value.winnerCount,2);
  for(const key of ['termsUrl','authorizationReference','legallyReviewed'])assert.ok(!(key in value),key);
  assert.equal(value.ticketUrl,'https://exemplo.org/ticket');
});
test('cartões, upload otimizado, regras padrão e inscrição ficam separados de PII público',()=>{
  const ui=read('public/assets/festas.js'),html=read('public/index.html'),rules=read('firestore.rules');
  for(const id of ['admin-poster-file','admin-poster-preview','admin-new-tag','admin-add-tag','admin-use-default-rules','admin-save-default-rules','admin-rulesText','admin-tab-events','admin-tab-forms','admin-export-csv','admin-delete-all'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(ui,/INGRESSOS 🔥/);
  assert.match(ui,/imageDataUrl:posterToSave/);
  assert.match(ui,/optimizePoster\(file\)/);
  assert.match(ui,/eventSettings','raffleDefaults'/);
  assert.match(rules,/match \/eventPosters\/\{eventId\}/);
  assert.match(rules,/imageDataUrl\.size\(\) <= 330000/);
  assert.match(rules,/match \/eventProfiles\/\{uid\}/);
  assert.match(rules,/function canJoinCount\(eventId\)/);assert.match(rules,/isParticipant\(\)/);
  const render=ui.slice(ui.indexOf('function renderEvents()'),ui.indexOf('function setSignupStep'));
  assert.doesNotMatch(render,/e\.winnerCount|e\.alternateCount|\.email|\.instagram/);
  assert.doesNotMatch(html,/id="admin-(?:termsUrl|authorizationReference|legallyReviewed)"/);
});
