/**
 * Regressão visual do canto e contorno do card de Festas.
 * Em desktop, container query units (cqw) aplicadas no próprio container
 * podem cair para viewport width, criando um raio de cerca de 58px.
 *
 * Execute: node scripts/qa-festas-card-frame.mjs
 * Sem dados reais, Firebase, FUMP, credenciais ou mutações.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const css=await fs.readFile(new URL('../public/assets/styles.css',import.meta.url),'utf8');
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const widths=[320,375,390,412,768,1024,1440,1920,2560];
  for(const width of widths){
    const page=await browser.newPage({
      viewport:{width,height:900},serviceWorkers:'block',deviceScaleFactor:1
    });
    await page.setContent('<!doctype html><html lang="pt-BR"><head>'+
      '<meta name="viewport" content="width=device-width, initial-scale=1">'+
      '<style>'+css+'</style></head><body>'+
      '<main class="site-wrap"><section class="festas-page" id="festas-page">'+
      '<div class="festas-list">'+
        '<article class="festa-card festa-card--compact">'+
          '<div class="festa-card-main festa-card-main--with-poster">'+
            '<button class="festa-poster-trigger" aria-label="Abrir cartaz">'+
              '<img class="festa-art" alt="Cartaz fictício" '+
                'src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27250%27 height=%27350%27%3E%3Crect width=%27250%27 height=%27350%27 fill=%27%23713bd5%27/%3E%3C/svg%3E">'+
            '</button>'+
            '<div class="festa-card-content">'+
              '<h3 class="festa-card-title">Festa de teste</h3>'+
              '<p class="festa-card-organizer">Organização fictícia</p>'+
              '<div class="festa-meta"><div class="festa-meta-row">SEX 21 NOV · 21H</div></div>'+
            '</div>'+
            '<div class="festa-card-actions--inline">'+
              '<a class="festa-action festa-action-primary" href="#">'+
                '<span class="festa-action-label">Ingressos</span>'+
                '<span class="festa-action-chevron">›</span></a>'+
              '<button class="festa-action festa-action-secondary" type="button">'+
                '<span class="festa-action-label">Sorteio</span>'+
              '</button>'+
            '</div>'+
          '</div>'+
        '</article>'+
      '</div></section></main></body></html>',{waitUntil:'load'});
    const result=await page.evaluate(()=>{
      const card=document.querySelector('.festa-card--compact');
      const action=document.querySelector('.festa-action-primary');
      const box=card.getBoundingClientRect();
      const button=action.getBoundingClientRect();
      const styles=getComputedStyle(card);
      return {
        radius:parseFloat(styles.borderTopRightRadius),
        border:parseFloat(styles.borderRightWidth),
        cardLeft:box.left,cardRight:box.right,
        buttonLeft:button.left,buttonRight:button.right,
        buttonHeight:button.height,cardWidth:box.width,
        viewport:innerWidth,docWidth:document.documentElement.scrollWidth
      };
    });
    assert.ok(result.radius>=12&&result.radius<=20,
      width+'px: raio do card exagerado ('+result.radius+'px)');
    assert.ok(result.border>=.9&&result.border<=1.1,
      width+'px: borda do card cresce com a viewport ('+result.border+'px)');
    assert.ok(result.cardRight<=result.viewport+1&&result.cardLeft>=-1,
      width+'px: card vazou do viewport ('+JSON.stringify(result)+')');
    assert.ok(result.buttonLeft>=result.cardLeft&&result.buttonRight<=result.cardRight,
      width+'px: botão roxo ultrapassou o card ('+JSON.stringify(result)+')');
    assert.ok(result.buttonHeight>=20,
      width+'px: ação desapareceu ou foi comprimida');
    assert.ok(result.docWidth<=result.viewport+1,
      width+'px: rolagem horizontal indesejada');
    console.log('FESTAS_CARD_FRAME_OK viewport='+width+
      ' radius='+result.radius+'px border='+result.border+
      'px card='+Math.round(result.cardWidth)+'px');
    await page.close();
  }
  console.log('FESTAS_CARD_FRAME_PASS 9 viewports');
}finally{
  await browser?.close();
}
