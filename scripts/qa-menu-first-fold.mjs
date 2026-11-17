/**
 * QA da primeira tela real de Cardápios (HTML/JS/CSS do Hub + FUMP simulada).
 * Verifica bordas dos grupos, ordem e visibilidade de proteínas/vegetarianos
 * sem precisar rolar a página após o RU já ter sido selecionado.
 * Sem chamadas de rede externas nem alterações em produção.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createPreviewServer} from './preview-local.mjs';

const tz='America/Sao_Paulo';
const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'
}).formatToParts(new Date()).map(p=>[p.type,p.value]));
const today=parts.year+'-'+parts.month+'-'+parts.day;
const responseFor=async url=>{
  const req=new URL(url),id=req.searchParams.get('id'),date=req.searchParams.get('data');
  const cardapios=id==='2'&&date===today?[{
    data:date,refeicoes:[{tipoRefeicao:'Almoço',pratos:[
      {tipoPrato:'Prato protéico 1',descricaoPrato:'Escondidinho de Frango'},
      {tipoPrato:'Prato protéico 1',descricaoPrato:'Bife de milho'},
      {tipoPrato:'Acompanhamento 1',descricaoPrato:'Arroz Branco'}
    ]}]
  }]:[];
  return new Response(JSON.stringify({id:Number(id),cardapios}),{
    status:200,headers:{'Content-Type':'application/json','X-Menu-Fetched-At':new Date().toISOString()}
  });
};
const server=createPreviewServer({fetchFn:responseFor});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/';
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const [width,height] of [[320,640],[360,740],[375,667],[375,812],[390,844],[412,915]]){
    const page=await browser.newPage({viewport:{width,height},serviceWorkers:'block'});
    await page.addInitScript(()=>{
      localStorage.setItem('ruhoje:restaurant:v1','saude');
    });
    const pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('.menu-group--vegetarian .dish-title').getByText('Bife de milho',{exact:true})
      .waitFor({timeout:18000});
    const d=await page.evaluate(()=>{
      const rect=selector=>{const e=document.querySelector(selector);if(!e)return null;
        const r=e.getBoundingClientRect();return {x:r.left,y:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
      };
      const main=document.querySelector('.menu-group--main'),veg=document.querySelector('.menu-group--vegetarian');
      const mainStyle=getComputedStyle(main),vegStyle=getComputedStyle(veg);
      const row=document.querySelector('.menu-group--main .dish-trigger');
      return{
        viewport:{width:innerWidth,height:innerHeight},
        documentWidth:document.documentElement.scrollWidth,
        nav:rect('#bandeco-navigation'),month:rect('.date-section'),
        picker:rect('.restaurant-picker'),dates:rect('.date-strip'),meal:rect('.meal-card'),
        main:rect('.menu-group--main'),veg:rect('.menu-group--vegetarian'),
        menuHeading:rect('.menu-heading-row'),
        mainBorder:mainStyle.borderLeftWidth,vegBorder:vegStyle.borderLeftWidth,
        mainPadding:mainStyle.paddingLeft,vegPadding:vegStyle.paddingLeft,
        mainBorderTop:mainStyle.borderTopWidth,vegBorderTop:vegStyle.borderTopWidth,
        dishHeight:row?.getBoundingClientRect().height||0,
        windowScrollY:window.scrollY
      };
    });
    const hint=width+'x'+height+': '+JSON.stringify(d);
    assert.deepEqual(pageErrors,[],'Erro na UI: '+hint);
    assert.ok(d.documentWidth<=width+1,'Scroll horizontal: '+hint);
    assert.ok(Math.abs(d.main.x-d.veg.x)<1,'Grupos com laterais desalinhadas: '+hint);
    assert.ok(Math.abs(d.main.right-d.veg.right)<1,'Grupos com larguras distintas: '+hint);
    assert.equal(d.mainBorder,d.vegBorder,'Bordas laterais diferentes: '+hint);
    assert.equal(d.mainBorderTop,d.vegBorderTop,'Bordas superiores diferentes: '+hint);
    assert.equal(d.mainPadding,d.vegPadding,'Padding dos grupos diferente: '+hint);
    assert.ok(d.main.bottom<d.veg.y,'Ordem dos grupos incorreta: '+hint);
    assert.ok(d.dishHeight>=44,'Área de toque dos pratos reduzida: '+hint);
    assert.equal(d.windowScrollY,0,'Página rolou sozinha antes de exibir o cardápio');
    if(height>=667){
      assert.ok(d.veg.y<d.nav.y-6,
        'Opção vegetariana não entra no primeiro viewport útil: '+hint);
    }
    if(height>=740){
      assert.ok(d.veg.bottom<=d.nav.y-4,
        'Opção vegetariana ficou coberta pela navegação inferior: '+hint);
    }
    console.log('MENU_FIRST_FOLD_OK '+width+'x'+height+
      ' mainY='+Math.round(d.main.y)+
      ' vegEnd='+Math.round(d.veg.bottom)+
      ' navTop='+Math.round(d.nav.y));
    await page.close();
  }
  console.log('MENU_FIRST_FOLD_PASS 6 viewports');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
