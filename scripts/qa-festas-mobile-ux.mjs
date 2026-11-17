/**
 * Auditoria de geometria mobile: miniatura, título, organização, dados,
 * tags, botões e estado de inscrições. Usa apenas fixtures locais.
 * Executar: npm run test:festas:mobile
 */
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const css=await readFile(new URL('../public/assets/styles.css',import.meta.url),'utf8');
const posterSrc='data:image/svg+xml,'+encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600">'+
    '<rect width="900" height="1600" fill="#8c43c7"/>'+
    '<rect x="55" y="40" width="790" height="1520" fill="#281b4b"/>'+
    '<text x="75" y="200" fill="white" font-size="76">Festa</text></svg>'
);
const tagText='Open Bar · Drinks · Música ao Vivo · Universitários';
function card({poster=true,actions=2,status=true,long=true}={}){
  const longName='Festa Universitária de Integração com Título Longo para Testar Responsividade';
  const title=long?longName:'Festa de teste';
  const organizer=long?'Organização Acadêmica e Atlética Estudantil do Campus Pampulha':'Atlética Exemplo';
  const location=long?'Espaço Cultural da Universidade Federal de Minas Gerais — Campus Pampulha':'Belo Horizonte';
  const art=poster?'<button type="button" class="festa-poster-trigger" aria-label="Abrir cartaz completo">'+
    '<img class="festa-art" alt="Cartaz de teste" src="'+posterSrc+'"></button>':'';
  const buttons=actions>0?'<div class="festa-card-actions--inline">'+
    '<a class="festa-action festa-action-primary" href="#ingressos">'+
    '<span class="festa-action-icon">▣</span><span class="festa-action-label">Ingressos</span>'+
    '<span class="festa-action-chevron">›</span></a>'+
    (actions>1?'<button class="festa-action festa-action-secondary">'+
      '<span class="festa-action-icon">♧</span><span class="festa-action-label">Sorteio</span>'+
      '<span class="festa-action-chevron">›</span></button>':'')+
    '</div>':'';
  return '<article class="festa-card festa-card--compact"><div class="festa-card-main '+
    (poster?'festa-card-main--with-poster':'festa-card-main--no-poster')+'">'+
    art+
    '<div class="festa-card-content">'+
    '<h3 class="festa-card-title">'+title+'</h3>'+
    '<p class="festa-card-organizer">'+organizer+'</p>'+
    '<div class="festa-meta">'+
      '<div class="festa-meta-row">'+
        '<span class="festa-meta-item"><span class="festa-meta-icon">▣</span><span>21/11</span></span>'+
        '<span class="festa-meta-separator"></span>'+
        '<span class="festa-meta-item"><span class="festa-meta-icon">◷</span><span>21:00</span></span>'+
      '</div>'+
      '<span class="festa-meta-item festa-meta-location">'+
        '<span class="festa-meta-icon">⌖</span><span>'+location+'</span></span>'+
    '</div>'+
    '<div class="festa-card-tags">'+tagText.split(' · ').map(t=>
      '<span class="festa-tag-chip">'+t+'</span>').join('')+'</div>'+
    '</div>'+buttons+
    (status?'<p class="festa-card-status">Inscrições abertas · veja as regras do sorteio</p>':'')+
    '</div></article>';
}
const variants=[
  {id:'poster-two-actions',poster:true,actions:2,status:true,long:true},
  {id:'poster-one-action',poster:true,actions:1,status:false,long:true},
  {id:'poster-no-actions',poster:true,actions:0,status:true,long:true},
  {id:'no-poster-two-actions',poster:false,actions:2,status:true,long:true},
  {id:'no-poster-one-action',poster:false,actions:1,status:false,long:true}
];
const widths=[280,320,360,375,390,412,430,600,768,850];
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of widths){
    const page=await browser.newPage({
      viewport:{width,height:900},deviceScaleFactor:1,serviceWorkers:'block'
    });
    const html='<!doctype html><html lang="pt-BR"><head>'+
      '<meta name="viewport" content="width=device-width, initial-scale=1">'+
      '<style>'+css+'</style></head><body>'+
      '<main class="site-wrap"><section class="festas-page" id="festas-page">'+
      '<div class="festas-list">'+variants.map(v=>
        '<div class="fixture" data-id="'+v.id+'">'+card(v)+'</div>').join('')+
      '</div></section></main></body></html>';
    await page.setContent(html,{waitUntil:'load'});
    for(const variant of variants){
      const result=await page.locator('[data-id="'+variant.id+'"]').evaluate(host=>{
        const box=el=>{
          if(!el)return null;const r=el.getBoundingClientRect();
          return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
        };
        const card=host.querySelector('.festa-card--compact');
        const poster=host.querySelector('.festa-poster-trigger');
        const image=host.querySelector('.festa-art');
        const title=host.querySelector('.festa-card-title');
        const content=host.querySelector('.festa-card-content');
        const org=host.querySelector('.festa-card-organizer');
        const location=host.querySelector('.festa-meta-location>span:last-child');
        const tags=host.querySelector('.festa-card-tags');
        const actions=host.querySelector('.festa-card-actions--inline');
        const status=host.querySelector('.festa-card-status');
        return {
          card:box(card),poster:box(poster),content:box(content),title:box(title),
          organizer:box(org),location:box(location),tags:box(tags),
          actions:box(actions),status:box(status),
          buttons:[...host.querySelectorAll('.festa-action')].map(box),
          radius:getComputedStyle(card).borderTopRightRadius,
          imageFit:image?getComputedStyle(image).objectFit:null,
          imageHeight:image?image.naturalHeight:null,
          locationWhiteSpace:getComputedStyle(location).whiteSpace,
          titleLineClamp:getComputedStyle(title).webkitLineClamp,
          titleOverflow:getComputedStyle(title).overflow,
          titleScrollHeight:title.scrollHeight,
          titleClientHeight:title.clientHeight,
          locationScrollWidth:location.scrollWidth,
          locationClientWidth:location.clientWidth,
          bodyScrollWidth:document.documentElement.scrollWidth,
          viewportWidth:innerWidth
        };
      });
      const hint=width+'px / '+variant.id+': '+JSON.stringify(result);
      const tol=1.5;
      assert.ok(result.bodyScrollWidth<=width+tol,'Rolagem horizontal: '+hint);
      assert.ok(result.card.left>=0&&result.card.right<=width+tol,'Card excede tela: '+hint);
      assert.ok(result.titleScrollHeight<=result.titleClientHeight+tol,
        'Título cortado: '+hint);
      assert.ok(result.locationScrollWidth<=result.locationClientWidth+tol,
        'Local cortado: '+hint);
      assert.equal(result.locationWhiteSpace,'normal','Local sem quebra de linha: '+hint);
      assert.ok(result.tags.right<=result.card.right+tol,'Tags vazaram: '+hint);
      if(variant.poster){
        assert.ok(result.poster.left<result.content.left,'Cartaz não está à esquerda: '+hint);
        assert.ok(result.poster.top<=result.content.top+tol,'Cartaz não alinhado: '+hint);
        assert.equal(result.imageFit,'contain','Cartaz está sendo recortado: '+hint);
        assert.ok(result.poster.height>=result.poster.width*1.3,
          'Miniatura sem proporção vertical: '+hint);
        assert.ok(result.poster.right<=result.content.left+tol,
          'Cartaz sobrepõe texto: '+hint);
      }
      if(variant.actions){
        assert.ok(result.actions.left<result.content.left,
          'Ações continuam espremidas na coluna de informação: '+hint);
        const headerBottom=Math.max(result.poster?.bottom||0,result.content.bottom);
        assert.ok(result.actions.top>=headerBottom-1,
          'Ações sobrepostas aos dados ou cartaz: '+hint);
        assert.ok(result.actions.right<=result.card.right+tol,
          'Ações vazam do card: '+hint);
        assert.equal(result.buttons.length,variant.actions,hint);
        for(const button of result.buttons){
          assert.ok(button.height>=44,'Botão pequeno para toque: '+hint);
          assert.ok(button.left>=result.card.left&&button.right<=result.card.right+tol,
            'Botão fora do card: '+hint);
        }
      }
      if(variant.status){
        assert.ok(result.status.top>=Math.max(result.actions?.bottom||0,
          result.content.bottom)-1,'Aviso sobrepõe ações: '+hint);
      }
      console.log('FESTAS_MOBILE_UX_OK width='+width+
        ' fixture='+variant.id+' card='+Math.round(result.card.width)+
        ' poster='+Math.round(result.poster?.width||0)+'px'+
        ' actions='+Math.round(result.actions?.width||0)+'px');
    }
    await page.close();
  }
  console.log('FESTAS_MOBILE_UX_PASS '+(widths.length*variants.length)+
    ' combinações de tamanho e conteúdo');
}finally{await browser?.close();}
