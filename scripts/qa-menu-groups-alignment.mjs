/**
 * QA da geometria real dos cards de categorias, incluindo grupos auxiliares.
 * Verifica alinhamento, tipografia, dimensões, temas e linhas com/sem botão.
 * Dados simulados: sem requisições externas, alterações no Firebase ou deploy.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createPreviewServer} from './preview-local.mjs';

const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
}).formatToParts(new Date()).map(part=>[part.type,part.value]));
const today=dateParts.year+'-'+dateParts.month+'-'+dateParts.day;
const recipes=[
  {tipoPrato:'Prato protéico 1',descricaoPrato:'Escondidinho de Frango'},
  {tipoPrato:'Prato protéico 1',descricaoPrato:'Hambúrguer de grão-de-bico'},
  {tipoPrato:'Guarnição',descricaoPrato:'Batata ao Forno'},
  {tipoPrato:'Acompanhamento 1',descricaoPrato:'Feijão com bacon'},
  {tipoPrato:'Entrada 1',descricaoPrato:'Salada de almeirão com repolho roxo e cenoura em tiras'},
  {tipoPrato:'Sobremesa 1 (uma porção)',descricaoPrato:'Gelatina de Uva'}
];
const getResponse=async url=>{
  const params=new URL(url).searchParams;
  const id=params.get('id'),date=params.get('data');
  const cardapios=id==='2' && date===today ? [{
    data:date,refeicoes:[{tipoRefeicao:'Almoço',pratos:recipes}]
  }] : [];
  return new Response(JSON.stringify({id:Number(id),cardapios}),{
    status:200,headers:{'Content-Type':'application/json',
      'X-Menu-Fetched-At':new Date().toISOString()}
  });
};
const server=createPreviewServer({fetchFn:getResponse});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/';
const configs=[[320,640],[375,667],[390,844],[412,915],[768,1024],[1024,768]];
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const theme of ['dark','light']){
    for(const [width,height] of configs){
      const page=await browser.newPage({
        viewport:{width,height},serviceWorkers:'block'
      });
      await page.emulateMedia({colorScheme:theme});
      await page.addInitScript(()=>{
        localStorage.setItem('ruhoje:restaurant:v1','saude');
      });
      const pageErrors=[];
      page.on('pageerror',err=>pageErrors.push(err.message));
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.locator('.meal-card:has(.menu-group--main) .menu-group--vegetarian .dish-title')
        .getByText('Hambúrguer de grão-de-bico',{exact:true})
        .waitFor({timeout:18000});
      const metrics=await page.evaluate(()=>{
        const card=document.querySelector('.meal-card:has(.menu-group--main)');
        if(!card)return null;
        const rect=el=>{
          const r=el.getBoundingClientRect();
          return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,
            width:r.width,height:r.height};
        };
        return {
          viewport:innerWidth,docWidth:document.documentElement.scrollWidth,
          groups:[...card.querySelectorAll('.meal-contents .menu-group')].map(group=>{
            const heading=group.querySelector('.menu-group-title');
            const icon=heading.querySelector('.category-emoji');
            const row=group.querySelector('.dish-row');
            const dish=row.querySelector('.dish-title');
            const titleText=document.createRange();
            titleText.selectNodeContents(heading.lastChild);
            const style=getComputedStyle(group);
            const hStyle=getComputedStyle(heading);
            const dishStyle=getComputedStyle(row);
            return {
              label:heading.textContent.trim(),
              box:rect(group),header:rect(heading),
              labelX:titleText.getBoundingClientRect().left,
              icon:rect(icon),row:rect(row),dish:rect(dish),
              padding:style.paddingLeft,
              borderTop:style.borderTopWidth,borderLeft:style.borderLeftWidth,
              radius:style.borderTopLeftRadius,
              titleFont:hStyle.fontSize,
              dishFont:dishStyle.fontSize,
              rowHeight:row.getBoundingClientRect().height,
              isButton:!!row.querySelector('.dish-trigger'),
              background:style.backgroundColor
            };
          })
        };
      });
      const hint=theme+' '+width+'x'+height+': '+JSON.stringify(metrics);
      assert.deepEqual(pageErrors,[],'Erro na interface: '+hint);
      assert.ok(metrics,'Card de almoço não foi renderizado: '+hint);
      assert.equal(metrics.groups.length,6,'Seis categorias esperadas: '+hint);
      assert.ok(metrics.docWidth<=width+1,'Rolagem horizontal detectada: '+hint);
      const groups=metrics.groups;
      const base=groups[0];
      assert.ok(base.label.toLocaleLowerCase('pt-BR').includes('pratos principais'),'Ordem principal incorreta: '+hint);
      assert.ok(groups[1].label.toLocaleLowerCase('pt-BR').includes('opção vegetariana'),'Ordem vegetariana incorreta: '+hint);
      for(const group of groups){
        assert.ok(Math.abs(group.box.left-base.box.left)<1,
          'Categorias com recuo esquerdo diferente: '+hint);
        assert.ok(Math.abs(group.box.right-base.box.right)<1,
          'Categorias com larguras diferentes: '+hint);
        assert.equal(group.padding,base.padding,
          'Categorias com padding desigual: '+hint);
        assert.equal(group.borderLeft,'1px','Bordas laterais devem ter 1px: '+hint);
        assert.equal(group.borderTop,'1px','Borda superior deve ter 1px: '+hint);
        assert.equal(group.radius,base.radius,'Raio da borda desigual: '+hint);
        assert.equal(group.titleFont,'12px','Tamanho do título desigual: '+hint);
        assert.equal(group.dishFont,'15px','Tamanho do prato desigual: '+hint);
        assert.ok(Math.abs(group.icon.width-20)<1&&Math.abs(group.icon.height-20)<1,
          'Ícones sem dimensões uniformes: '+hint);
        assert.ok(Math.abs(group.labelX-group.dish.left)<1.5,
          'Nome do prato não alinha com o texto do título: '+hint);
        assert.ok(group.rowHeight>=44,'Linha inferior a 44px: '+hint);
        assert.ok(group.dish.right<=group.box.right-5,
          'Texto do prato transborda o cartão: '+hint);
        assert.ok(group.box.left>=0&&group.box.right<=width+1,
          'Cartão excede a tela: '+hint);
      }
      assert.ok(groups[0].background!==groups[2].background,
        'Pratos principais devem conservar a cor diferenciada: '+hint);
      assert.ok(groups[1].background!==groups[2].background,
        'Vegetarianos devem conservar a cor diferenciada: '+hint);
      console.log('MENU_GROUPS_ALIGN_OK theme='+theme+' size='+width+'x'+height+
        ' groups='+groups.length+' groupWidth='+Math.round(base.box.width)+
        ' textX='+Math.round(base.labelX));
      await page.close();
    }
  }
  console.log('MENU_GROUPS_ALIGN_PASS '+(configs.length*2)+' cenários');
}finally{
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
