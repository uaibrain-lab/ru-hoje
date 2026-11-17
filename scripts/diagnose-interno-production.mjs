// Auditoria somente leitura do mapa Interno em producao. Sem login, Firebase writes ou GPS.
import {chromium} from 'playwright';
const base='https://hubufmg.web.app';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  for(const name of ['desktop','mobile']){
    const context=await browser.newContext({
      viewport:name==='desktop'?{width:1280,height:800}:{width:390,height:844},
      serviceWorkers:'allow',
      deviceScaleFactor:1
    });
    const page=await context.newPage();
    const errors=[],network=[];
    page.on('pageerror',e=>errors.push('PAGEERROR '+e.message.slice(0,300)));
    page.on('console',e=>{if(e.type()==='error')errors.push('CONSOLE '+e.text().slice(0,300));});
    page.on('requestfailed',req=>{if(/interno|leaflet|openstreetmap|hubufmg/.test(req.url()))network.push('FAIL '+req.url().slice(0,180)+' '+req.failure()?.errorText);});
    page.on('response',r=>{if(/interno|leaflet|openstreetmap/.test(r.url()) && (r.status()>=300 || network.length<6))network.push('HTTP '+r.status()+' '+r.url().slice(0,180));});
    try {
      await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:22000});
      await page.evaluate(()=>document.getElementById('restaurant-dialog')?.close());
      await page.locator('#tab-interno').click({timeout:10000});
      await page.waitForTimeout(9500);
      const ifr=page.frameLocator('#interno-frame');
      const frameInfo=await ifr.locator('body').evaluate(body=>{
        const map=body.querySelector('#map');
        const iframe=window.frameElement;
        const tiles=[...body.querySelectorAll('img.leaflet-tile')];
        return {
          href:location.href,title:document.title,
          leaflet:!!window.L,nomap:body.classList.contains('no-map'),
          mapClass:map?.className,mapRect:map?.getBoundingClientRect().toJSON(),
          tileCount:tiles.length,loaded:tiles.filter(img=>img.complete&&img.naturalWidth>0).length,
          broken:tiles.filter(img=>img.complete&&img.naturalWidth===0).length,
          text:body.innerText.slice(0,280),
          frameRect:iframe?.getBoundingClientRect().toJSON()
        };
      },{timeout:12000});
      console.log(JSON.stringify({name,frameInfo,network:network.slice(0,18),errors:errors.slice(0,8)}));
    }catch(e){
      console.log(JSON.stringify({name,failed:String(e.message).slice(0,500),url:page.url(),iframeSrc:await page.locator('#interno-frame').getAttribute('src').catch(()=>''),network:network.slice(0,20),errors:errors.slice(0,9)}));
    }
    await context.close();
  }
}finally{await browser.close();}
