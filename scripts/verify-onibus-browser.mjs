/**
 * Smoke de navegador com o pacote Externo BH REAL montado no Hub.
 * A página local deve servir o diretório public/ com /interno e /externo.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base=process.env.HUB_QA_URL||'http://127.0.0.1:8765/';
const deepLink='?aba=onibus&tipo=externo&ponto=14791950';
const browser=await chromium.launch({headless:true});
try {
  for(const width of [390,1280]){
    const page=await browser.newPage({viewport:{width,height:900},
      serviceWorkers:'block'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://externo-bh-gps-free.hubufmg.workers.dev/api/arrivals?stop=*',
      route=>{
        if(width===1280)return route.fulfill({status:503,contentType:'application/json',
          headers:{'Access-Control-Allow-Origin':'*'},
          body:JSON.stringify({available:false,error:'ARRIVALS_UNAVAILABLE'})});
        const now=Date.now();
        return route.fulfill({status:200,contentType:'application/json',
          headers:{'Access-Control-Allow-Origin':'*'},
          body:JSON.stringify({available:true,source:'SUMOB_GTFS_RT_TRIP_UPDATES',
            stopId:'14791950',fetchedAt:new Date(now).toISOString(),
            feedTimestamp:new Date(now).toISOString(),
            items:[{tripId:'test-trip-51',routeId:'562134',stopId:'14791950',
              stopSequence:12,at:new Date(now+180000).toISOString(),
              lastFeedUpdateAt:new Date(now).toISOString(),eventType:'arrival'}]})});
      });
    try{
      await page.goto(new URL(deepLink,base).href,{
        waitUntil:'domcontentloaded',timeout:30000
      });
      assert.equal(await page.locator('#interno-frame').count(),1,
        'A página precisa ter apenas o iframe de ônibus unificado');
      assert.equal(await page.locator('#externo-frame').count(),0,
        'A interface externa duplicada reapareceu');
      assert.equal(await page.locator('.onibus-intro').count(),0,
        'O cabeçalho decorativo Mobilidade/Ônibus deve ter sido removido');
      assert.equal(await page.locator('#interno-page').getAttribute('aria-label'),
        'Ônibus: pontos, linhas e horários');
      const frameHeight=await page.locator('#interno-frame').evaluate(n=>n.getBoundingClientRect().height);
      assert.ok(frameHeight>Math.min(480,900*0.48),
        'Mapa ficou excessivamente baixo após remoção do cabeçalho: '+frameHeight);
      const frame=page.frameLocator('#interno-frame');
      await frame.locator('#map-point-legend').waitFor({timeout:30000});
      await frame.locator('.municipal-detail-title').waitFor({timeout:30000});
      if(width===390){
        await frame.locator('#municipal-stop-realtime:not([hidden])').waitFor({timeout:20000});
        const txt=await frame.locator('#municipal-realtime-rows').innerText();
        assert.match(txt,/51/);
        assert.match(txt,/Chegada prevista/);
        assert.match(txt,/SUMOB/);
        assert.match(await frame.locator('#municipal-timetable-title').innerText(),/tabela/);
      }else{
        await frame.locator('#municipal-stop-schedules .municipal-arrivals').waitFor({timeout:20000});
        assert.equal(await frame.locator('#municipal-stop-realtime').isVisible(),false,
          'Worker indisponível não pode gerar ETA fictício');
        assert.match(await frame.locator('#municipal-timetable-title').innerText(),/programados/);
      }
      assert.equal(await frame.locator('#map-point-legend').count(),1);
      assert.equal(await frame.locator('.map-legend-symbol--internal').count(),1);
      assert.equal(await frame.locator('.map-legend-symbol--municipal').count(),1);
      assert.equal(await frame.locator('#map-filter-toggle').count(),0,
        'Botão flutuante Todos deve ser removido');
      const internalEye=frame.locator('#toggle-internal-points');
      const municipalEye=frame.locator('#toggle-municipal-points');
      assert.equal(await internalEye.getAttribute('aria-pressed'),'true');
      assert.equal(await municipalEye.getAttribute('aria-pressed'),'true');
      assert.equal(await internalEye.innerText(),'Internos');
      assert.equal(await municipalEye.innerText(),'Municipais');
      assert.equal(await frame.locator('#map-data-status').isVisible(),false,
        'Status UFMG + BH não pode aparecer na interface');
      await municipalEye.click();
      assert.equal(await municipalEye.getAttribute('aria-pressed'),'false');
      assert.equal(await internalEye.getAttribute('aria-pressed'),'true',
        'Ocultar municipais não pode ocultar internos');
      await internalEye.click();
      assert.equal(await internalEye.getAttribute('aria-pressed'),'false');
      await municipalEye.click();
      assert.equal(await municipalEye.getAttribute('aria-pressed'),'true',
        'Municipais devem poder ser exibidos com internos ocultos');
      await internalEye.click();
      assert.equal(await internalEye.getAttribute('aria-pressed'),'true');
      assert.equal(await frame.locator('#quick-linhas').isVisible(),true,
        'Linhas deve ser acessível mesmo com um ponto selecionado');
      await frame.locator('#quick-linhas').click();
      await frame.locator('#line-q').waitFor({timeout:15000});
      assert.equal(await frame.locator('#line-q').count(),1,
        'Existe mais de uma busca de linhas');
      assert.equal(await frame.locator('#q').count(),0,
        'A busca de pontos não deve duplicar a busca de linhas');
      const firstGroup=await frame.locator('.bus-line-group').first().textContent();
      assert.match(firstGroup||'',/Internos/,
        'Linhas internas precisam aparecer no topo');
      const filters=frame.locator('[data-line-filter-mode]');
      assert.equal(await filters.count(),3,
        'O filtro explícito deve oferecer Todas, Internos e Municipais');
      assert.equal(await frame.locator('[data-line-filter-mode="all"]')
        .getAttribute('aria-pressed'),'true');
      await frame.locator('[data-line-filter-mode="internal"]').click();
      assert.equal(await frame.locator('[data-line-filter-mode="internal"]')
        .getAttribute('aria-pressed'),'true');
      assert.match(await frame.locator('.bus-line-group').first().textContent()||'',/Internos/);
      await frame.locator('[data-line-filter-mode="external"]').click();
      assert.equal(await frame.locator('[data-line-filter-mode="external"]')
        .getAttribute('aria-pressed'),'true');
      assert.match(await frame.locator('.bus-line-group').first().textContent()||'',/Municipais/);
      await frame.locator('[data-line-filter-mode="all"]').click();
      assert.match(await frame.locator('.bus-line-group').first().textContent()||'',/Internos/);
      await frame.locator('#quick-pontos').click();
      assert.equal(await frame.locator('#q').count(),1);
      assert.equal(await frame.locator('#line-q').count(),0);
      assert.deepEqual(errors,[],
        'Erros JS impediram carregar a interface unificada');
      await page.goto(new URL('/externo/?ponto=14791950',base).href,
        {waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForURL(/aba=onibus.*tipo=externo.*ponto=14791950/,{timeout:15000});
      assert.equal(await page.locator('#interno-frame').count(),1,
        'Link legado não pode abrir a interface municipal duplicada');
      console.log('HUB_ONIBUS_BROWSER_OK width='+width);
    }finally{await page.close();}
  }
}finally{await browser.close();}
