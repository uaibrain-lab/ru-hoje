/**
 * Auditoria mobile do espaçamento entre o status do RU e o título do mês.
 * Verifica também o texto exibido para café da manhã em todos os pontos da UI.
 * Sem backend e sem dados reais.
 */
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const [css,app]=await Promise.all([
  readFile(new URL('../public/assets/styles.css',import.meta.url),'utf8'),
  readFile(new URL('../public/assets/app.js',import.meta.url),'utf8')
]);
const wording='Exclusivo pra FUMP I, II e III';
assert.equal(app.split(wording).length-1,3,
  'O aviso de café deve aparecer no status, nos horários e no subtítulo');
assert.ok(!/\bacesso restrito\b/i.test(app),
  'O café não deve usar o rótulo genérico antigo');
const widths=[320,360,375,390,412,768,850,1024];
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of widths){
    const page=await browser.newPage({
      viewport:{width,height:850},serviceWorkers:'block'
    });
    await page.setContent('<!doctype html><html lang="pt-BR"><head>'+
      '<meta name="viewport" content="width=device-width, initial-scale=1">'+
      '<style>'+css+'</style></head><body>'+
      '<main class="site-wrap">'+
        '<section class="restaurant-section">'+
          '<button class="restaurant-picker"><span>RU Setorial I</span></button>'+
          '<div class="hours-wrap" id="hours-wrap">'+
            '<div class="hours-status"><span class="hours-dot is-open"></span>'+
              '<span id="hours-status">Aberto agora · fecha às 14h · '+wording+'</span></div>'+
            '<details class="hours-details"><summary aria-label="Ver horários"></summary>'+
              '<div id="hours-list" class="hours-list">Segunda — Café da manhã ('+wording+')</div>'+
              '<p class="hours-caveat">Horários regulares.</p>'+
            '</details>'+
          '</div>'+
        '</section>'+
        '<section class="date-section"><div class="section-heading">'+
          '<h2 id="dates-heading">Novembro de 2026</h2>'+
          '<button class="today-link">Ir para hoje</button>'+
        '</div></section>'+
      '</main></body></html>',{waitUntil:'load'});

    async function measure(){
      return page.evaluate(()=>{
        const hours=document.getElementById('hours-wrap');
        const month=document.querySelector('.date-section');
        const status=document.querySelector('.hours-status');
        const arrow=document.querySelector('.hours-details>summary');
        const heading=document.getElementById('dates-heading');
        const r=el=>{const b=el.getBoundingClientRect();
          return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,
            width:b.width,height:b.height}};
        return {
          hours:r(hours),month:r(month),status:r(status),
          arrow:r(arrow),heading:r(heading),
          viewport:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,
          gap:month.getBoundingClientRect().top-hours.getBoundingClientRect().bottom,
          monthMargin:getComputedStyle(month).marginTop
        };
      });
    }
    const closed=await measure();
    assert.ok(closed.scrollWidth<=width+1,
      'Overflow em '+width+'px: '+JSON.stringify(closed));
    assert.ok(closed.heading.left>=0&&closed.heading.right<=width+1,
      'Título fora do viewport em '+width+'px');
    assert.ok(closed.status.right<=closed.arrow.left+1,
      'Status sobrepõe a seta em '+width+'px: '+JSON.stringify(closed));
    if(width<=850){
      assert.ok(closed.gap>=0&&closed.gap<=5,
        'Distância excessiva entre status e mês '+width+'px: '+JSON.stringify(closed));
      assert.ok(closed.arrow.height>=35,
        'Seta de horários comprimida demais em '+width+'px');
    }
    await page.locator('.hours-details>summary').click();
    const expanded=await measure();
    assert.ok(expanded.month.top>=expanded.hours.bottom-1,
      'Mês cobre os horários expandidos em '+width+'px');
    const list=await page.locator('#hours-list').isVisible();
    assert.equal(list,true,
      'Detalhes de horários não abriram em '+width+'px');
    await page.locator('.hours-details>summary').click();
    await page.locator('#hours-wrap').evaluate(el=>el.hidden=true);
    const hidden=await measure();
    assert.ok(hidden.month.top>=hidden.hours.bottom,
      'Mês sobrepõe restaurante quando horários indisponíveis ('+width+'px)');
    console.log('RU_MONTH_SPACING_OK width='+width+
      ' gap='+closed.gap.toFixed(1)+'px'+
      ' expanded='+expanded.gap.toFixed(1)+'px');
    await page.close();
  }
  console.log('RU_MONTH_SPACING_PASS '+widths.length+' viewports');
  console.log('FUMP_BREAKFAST_LABEL_PASS 3 pontos de exibição');
}finally{await browser?.close();}
