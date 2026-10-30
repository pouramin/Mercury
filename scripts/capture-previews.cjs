// Capture genuine browser screenshots of the 11 unchanged generated applications.
// Runs only in CI after building /_site, never rewrites original projects.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('/tmp/mercury-preview-tools/node_modules/playwright-core');

const cases = {
  inception: ['coffee','todo','snake','flowforge'],
  haiku: ['coffee','todo','snake','flowforge'],
  luna: ['coffee','snake','flowforge']
};
const statusFile = path.join(process.cwd(),'_site/demos/build-status.json');
const builds = JSON.parse(fs.readFileSync(statusFile,'utf8'));
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/opt/google/chrome/chrome',
  '/usr/bin/chromium'
].filter(Boolean);
const chromePath = chromeCandidates.find(p=>fs.existsSync(p));
if (!chromePath) throw new Error('Chrome executable not found for genuine captures');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:chromePath,
    args:['--no-sandbox','--disable-dev-shm-usage']});
  let count=0;
  try{
    for(const [model,tasks] of Object.entries(cases)){
      for(const task of tasks){
        if(task==='flowforge'&&builds[model]!==true)continue;
        const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
        try{
          // No network dependencies: screenshot the local build artifact.
          await page.route('**/*',route=>{
            const url=new URL(route.request().url());
            return url.hostname==='127.0.0.1'?route.continue():route.abort();
          });
          const url='http://127.0.0.1:8765/Mercury/demos/'+model+'/'+task+'/';
          const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
          if(!response||!response.ok())throw Error('Unsuccessful HTTP status for '+url);
          await page.waitForTimeout(task==='flowforge'?1000:650);
          const info=await page.evaluate(()=>({
            title:document.title,
            text:document.body?.innerText?.slice(0,1000)||'',
            children:document.body?.children?.length||0
          }));
          if(/unicorns have taken over|really bad day|build unavailable/i.test(info.text))
            throw Error('Error screen detected: '+model+'/'+task);
          if(info.children===0)throw Error('Blank application: '+model+'/'+task);
          const dest=path.join(process.cwd(),'_site/previews',model,task+'.png');
          fs.mkdirSync(path.dirname(dest),{recursive:true});
          await page.screenshot({path:dest,type:'png',animations:'disabled',timeout:15000});
          count++;
          console.log('Captured genuine preview:',model,task,info.title,fs.statSync(dest).size);
        }finally{await page.close();}
      }
    }
  }finally{await browser.close();}
  if(count!==11)throw new Error('Expected 11 captures; got '+count);
  console.log('Verified all '+count+' real application screenshots.');
})().catch(e=>{console.error(e);process.exit(1)});
