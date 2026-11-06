const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');
const temp=process.env.ATLAS_TEST_TEMP||process.env.TEMP||process.env.TMP;const env={...process.env};if(temp){env.TEMP=temp;env.TMP=temp;}
const id=n=>'20000101'+String(n).padStart(6,'0')+'-testdoc',book=id(1),a=id(10),b=id(11),c=id(12);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){for(let n=0;n<300;n++){if(predicate())return;await sleep(20);}throw Error('Timed out waiting for fixture request');}
(async()=>{
 const browser=await chromium.launch({...(process.env.ATLAS_BROWSER_CHANNEL?{channel:process.env.ATLAS_BROWSER_CHANNEL}:{}),headless:true,env});let release=()=>{};
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];
  let sqlCalls=0,catalogCalls=0,hold=false,fail=false,stamp=1,edges=[{source_id:a,target_id:b,count:1}];
  await ctx.addInitScript(({book})=>{
   if(!localStorage.getItem('personal-atlas-notebooks')){
    localStorage.setItem('personal-atlas-notebooks',JSON.stringify([book]));localStorage.setItem('personal-atlas-preferences',JSON.stringify({showReferences:false}));
   }
   const original=window.setInterval.bind(window);
   window.setInterval=(callback,ms,...args)=>{if(ms===30000)window.__atlasPoll=()=>callback(...args);return original(callback,ms,...args);};
  },{book});
  await ctx.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin!=='http://atlas.test')return route.abort();
   if(!url.pathname.startsWith('/api/')){const file=path.join(root,path.basename(url.pathname)||'atlas.html');return fs.existsSync(file)?route.fulfill({path:file}):route.abort();}
   const body=req.postDataJSON();let data;
   if(url.pathname==='/api/notebook/lsNotebooks'){catalogCalls++;data={notebooks:[{id:book,name:'示例笔记本'}]};}
   else if(url.pathname==='/api/filetree/listDocsByPath')data={box:book,files:[a,b,c].map((id,i)=>({id,name:['笔记A','笔记B','笔记C'][i],path:'/'+id+'.sy',subFileCount:0,mtime:stamp,hMtime:'可能变化的相对时间'}))};
   else if(url.pathname==='/api/query/sql'){
    sqlCalls++;const result=edges.map(e=>({...e})),failed=fail;
    if(hold)await new Promise(r=>release=r);
    return route.fulfill({json:failed?{code:-1,msg:'fixture background failure'}:{code:0,data:result}}).catch(()=>{});
   }else if(url.pathname==='/api/block/getBlockInfo')data={box:book,rootID:body.id};
   else if(url.pathname==='/api/block/getBlockKramdown')data={kramdown:'示例笔记正文'};
   else throw Error(url.pathname);
   await route.fulfill({json:{code:0,data}}).catch(()=>{});
  });
  const page=await ctx.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://atlas.test/atlas.html');await page.locator('body[data-ready=true]').waitFor();assert.equal(sqlCalls,0);
  const toggle=page.locator('#show-references'),links=page.locator('.reference-edge'),status=page.locator('#reference-status');
  const choose=async title=>page.locator('#tree .tree-label').getByText(title,{exact:true}).click();
  const poll=async()=>{const before=catalogCalls;await page.evaluate(()=>window.__atlasPoll());await until(()=>catalogCalls>before);await page.waitForFunction(()=>!document.getElementById('refresh').disabled);};
  hold=true;await toggle.check();await until(()=>sqlCalls===1);
  for(let n=0;n<4;n++){await toggle.uncheck();await toggle.check();}
  await choose('笔记A');assert.equal(sqlCalls,1);release();hold=false;await links.waitFor();
  await page.evaluate(()=>{
   window.__loadingTexts=[];
   new MutationObserver(()=>{const text=document.getElementById('reference-status').textContent;if(text.includes('正在读取'))window.__loadingTexts.push(text);})
    .observe(document.getElementById('reference-status'),{childList:true,subtree:true,characterData:true});
  });
  for(let n=0;n<6;n++){await toggle.uncheck();assert.equal(await links.count(),0);await toggle.check();assert.equal(await links.count(),1);}
  await page.locator('#selected-references').check();await choose('笔记B');assert.equal(await links.count(),1);
  await choose('笔记C');assert.equal(await links.count(),0);await choose('笔记A');assert.equal(await links.count(),1);
  await page.locator('#selected-references').uncheck();
  await page.locator('#tree .tree-label').getByText('笔记A',{exact:true}).dblclick();await page.locator('#home').click();
  for(const view of ['sunburst','grouped','radial'])await page.locator(`[data-view=${view}]`).click();
  assert.equal(sqlCalls,1);
  for(let n=0;n<3;n++)await poll();assert.equal(sqlCalls,1);
  const beforeEvent=catalogCalls;await page.evaluate(()=>window.postMessage({type:'personal-atlas-refresh',command:'refreshFiletree'},location.origin));
  await until(()=>catalogCalls>beforeEvent);await page.waitForFunction(()=>!document.getElementById('refresh').disabled);assert.equal(sqlCalls,1);
  // A changed note is checked in the background while the previous link stays visible.
  stamp++;edges=[{source_id:a,target_id:b,count:1},{source_id:b,target_id:c,count:1}];hold=true;
  await poll();await until(()=>sqlCalls===2);assert.equal(await links.count(),1);assert.ok(!(await status.innerText()).includes('正在读取'));
  await choose('笔记C');await toggle.uncheck();await toggle.check();assert.equal(sqlCalls,2);assert.equal(await links.count(),1);
  await poll();assert.equal(sqlCalls,2);release();hold=false;await page.waitForFunction(()=>document.querySelectorAll('.reference-edge').length===2);
  // Explicit refresh failure preserves the last successful result.
  fail=true;hold=true;await page.locator('#refresh').click();await until(()=>sqlCalls===3);assert.equal(await links.count(),2);
  release();hold=false;await page.waitForFunction(()=>document.getElementById('reference-status').title.includes('后台更新暂未完成'));
  assert.equal(await links.count(),2);fail=false;await toggle.uncheck();await toggle.check();await until(()=>sqlCalls===4);
  await page.waitForFunction(()=>!document.getElementById('reference-status').title.includes('后台更新暂未完成'));
  // A real edit notification can recheck references even within the same timestamp tick.
  hold=true;edges=[{source_id:c,target_id:a,count:1}];const beforeTransaction=catalogCalls;
  await page.evaluate(()=>window.postMessage({type:'personal-atlas-refresh',command:'transactions'},location.origin));
  await until(()=>catalogCalls>beforeTransaction&&sqlCalls===5);assert.equal(await links.count(),2);
  release();hold=false;await page.waitForFunction(()=>document.querySelectorAll('.reference-edge').length===1);
  assert.equal(await links.first().getAttribute('data-source'),c);
  // Changes arriving during a request coalesce into one follow-up check.
  hold=true;await page.locator('#refresh').click();await until(()=>sqlCalls===6);
  edges=[{source_id:a,target_id:b,count:1},{source_id:c,target_id:a,count:1}];
  stamp++;await poll();stamp++;await poll();assert.equal(sqlCalls,6);assert.equal(await links.count(),1);
  release();hold=false;await until(()=>sqlCalls===7);
  await page.waitForFunction(()=>document.querySelectorAll('.reference-edge').length===2);
  await poll();assert.equal(sqlCalls,7);
  assert.deepEqual(await page.evaluate(()=>window.__loadingTexts),[]);
  // Cancelling the scope aborts the pending request and does not leak cached links.
  hold=true;await page.locator('#refresh').click();await until(()=>sqlCalls===8);
  await page.locator('#choose-notebooks').click();await page.locator('#notebook-clear').click();await page.locator('#notebook-apply').click();
  await page.locator('#empty').getByText('尚未选择笔记本。点击左上方“展示范围”开始选择。',{exact:true}).waitFor();release();await sleep(50);
  assert.equal(await links.count(),0);assert.deepEqual(errors,[]);
  const result={initialReferencesOffNoSQL:true,rapidPendingTogglesSharedOneRequest:true,cachedToggles:6,selectionFocusLayoutNoSQL:true,unchangedPollsWithoutSQL:3,genericRefreshWithoutSQL:true,changedMetadataBackgroundRefresh:true,backgroundRetainedLinks:true,refreshFailureRetainedLinks:true,transactionRefreshWithinSameTimestamp:true,concurrentChangesCoalesced:true,noColdLoadingAfterFirstResult:true,staleScopeCleared:true,totalSQLRequests:sqlCalls};
  if(process.env.ATLAS_RESULTS_DIR){fs.mkdirSync(process.env.ATLAS_RESULTS_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.ATLAS_RESULTS_DIR,'reference-cache-results.json'),JSON.stringify(result,null,2));}console.log(JSON.stringify(result));
 }finally{release();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
