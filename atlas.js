'use strict';
(() => {
  const C=window.AtlasCore,S=window.AtlasSelection,R=window.AtlasReferences,H=window.AtlasVisibility,W=window.AtlasWorkspace,NS='http://www.w3.org/2000/svg';
  const $=id=>document.getElementById(id);
  const state={root:null,map:new Map(),focus:null,selected:null,view:'radial',query:'',collapsed:new Set(),treeOpen:new Set(),zoom:1,panX:0,panY:0,baseScale:1,loading:false,generation:0,previewGeneration:0,drag:null,visible:[],destroyed:false,catalog:[],selection:S.read(localStorage),loadController:null,previewController:null};
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const svg=(tag,attrs={},text)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
  const valid=id=>/^\d{14}-[a-z0-9]{7}$/.test(id);
  const brief=(s,n=15)=>s.length>n?s.slice(0,n)+'…':s;
  const isDocument=node=>node?.kind==='document';
  const count=node=>node.documentCount??node.descendants;
  const selectedNow=()=>new Set(S.read(localStorage));
  Object.assign(state,{references:[],allReferences:[],rawRoot:null,rawMap:new Map(),hidden:H.read(localStorage),hideDraft:null,hideLimit:200,referenceLimited:false,referenceError:'',showReferences:true,selectedReferences:false,labelMode:'all',sunLabelKey:null,networkLabelKey:null,networkGroups:new Map()});
  let refreshTimer,searchTimer,resizeTimer;
  let sessionTimer,historyTimer,restorePending=W.current(localStorage),workspaceLibrary=W.read(localStorage),applyingSnapshot=false,importData=null,importGeneration=0,lastWheel=0,sessionDirty=false;
  const navigation=W.history();
  try{const saved=JSON.parse(localStorage.getItem('personal-atlas-preferences')||'{}');if(['radial','grouped','sunburst'].includes(saved.view))state.view=saved.view;if(saved.theme==='dark')document.documentElement.dataset.theme='dark';if(typeof saved.showReferences==='boolean')state.showReferences=saved.showReferences;if(typeof saved.selectedReferences==='boolean')state.selectedReferences=saved.selectedReferences;if(['all','auto'].includes(saved.labelMode))state.labelMode=saved.labelMode;}catch{}
  function preferences(){try{localStorage.setItem('personal-atlas-preferences',JSON.stringify({view:state.view,theme:document.documentElement.dataset.theme||'light',showReferences:state.showReferences,selectedReferences:state.selectedReferences,labelMode:state.labelMode}));}catch{}}
  function capture(){
    const rect=$('graph').getBoundingClientRect(),round=n=>Number(n.toFixed(6));
    return W.snapshot({selection:state.selection,hidden:[...state.hidden],view:state.view,theme:document.documentElement.dataset.theme||'light',labelMode:state.labelMode,showReferences:state.showReferences,selectedReferences:state.selectedReferences,auto:$('auto').checked,depth:Number($('depth').value),limit:Number($('limit').value),query:state.query.slice(0,200),focusId:state.focus?.id||null,selectedId:state.selected?.id||null,treeOpen:[...state.treeOpen].filter(valid),collapsed:[...state.collapsed].filter(valid),camera:{zoom:state.zoom,panX:round(Math.max(-64,Math.min(64,state.panX/Math.max(1,rect.width)))),panY:round(Math.max(-64,Math.min(64,state.panY/Math.max(1,rect.height))))}});
  }
  function navButtons(){$('nav-back').disabled=!navigation.canBack;$('nav-forward').disabled=!navigation.canForward;}
  function remember(){if(!state.root||state.loading||applyingSnapshot||state.destroyed)return;navigation.push(capture());navButtons();}
  function notifyBackup(){if(window.parent!==window)window.parent.postMessage({type:'personal-atlas-settings-changed',settings:W.envelope(state.root?capture():W.current(localStorage),W.read(localStorage))},location.origin);else $('workspace-status').textContent='设置已在本机记住；可导出文件备份。';}
  function saveSession(rememberHistory=true){
    if(!state.root||state.loading||applyingSnapshot||state.destroyed)return;
    try{const current=capture();workspaceLibrary=W.save(localStorage,{profiles:W.read(localStorage).profiles,last:current});clearTimeout(sessionTimer);sessionDirty=false;if(rememberHistory)navigation.push(current);navButtons();notifyBackup();}catch(error){workspaceError(error.message);}
  }
  function scheduleSession(immediateHistory=false){sessionDirty=true;clearTimeout(sessionTimer);sessionTimer=setTimeout(()=>saveSession(),320);if(immediateHistory){clearTimeout(historyTimer);historyTimer=setTimeout(remember,0);}}
  function workspaceError(message){$('workspace-error').textContent=message;$('workspace-error').hidden=false;}
  function restoreView(value){
    const s=W.snapshot(value);state.view=s.view;state.labelMode=s.labelMode;state.showReferences=s.showReferences;state.selectedReferences=s.selectedReferences;
    document.documentElement.dataset.theme=s.theme;$('depth').value=String(s.depth);$('limit').value=String(s.limit);$('auto').checked=s.auto;state.query=s.query;$('search').value=s.query;
    state.focus=H.nearest(state.rawMap.get(s.focusId),state.map)||state.map.get(s.focusId)||state.root;
    state.selected=H.nearest(state.rawMap.get(s.selectedId),state.map)||state.map.get(s.selectedId)||state.focus;
    state.treeOpen=new Set(s.treeOpen.filter(id=>state.map.has(id)));state.treeOpen.add(state.root.id);for(const n of C.ancestors(state.selected))state.treeOpen.add(n.id);
    state.collapsed=new Set(s.collapsed.filter(id=>state.map.has(id)));renderTree();renderMap(true);renderDetails();
    if(!s.focusId||state.focus.id===s.focusId){const rect=$('graph').getBoundingClientRect();state.zoom=s.camera.zoom;state.panX=s.camera.panX*rect.width;state.panY=s.camera.panY*rect.height;transform();}
  }
  async function applySnapshot(value,{library=W.read(localStorage),rememberHistory=true}={}){
    if(applyingSnapshot){workspaceError('正在切换视角，请稍候。');return false;}
    const s=W.snapshot(value),same=JSON.stringify(state.selection)===JSON.stringify(s.selection)&&state.rawRoot;
    try{workspaceLibrary=W.commit(localStorage,s,library);}catch(error){workspaceError(error.message);return false;}
    clearTimeout(sessionTimer);clearTimeout(historyTimer);applyingSnapshot=true;state.selection=s.selection;state.hidden=new Set(s.hidden);
    try{
      if(same){projectVisibility();restoreView(s);}else{restorePending=s;resetScope();await load();}
      $('hidden-dialog').close();state.hideDraft=null;
    }finally{applyingSnapshot=false;}
    saveSession(rememberHistory);return Boolean(state.root);
  }
  async function moveHistory(delta){
    if(state.loading)return;navigation.push(capture());const target=navigation.move(delta);if(!target)return;
    // Navigation history follows browsing locations; it does not undo hidden rules.
    await applySnapshot({...target,hidden:[...state.hidden]},{rememberHistory:false});if(state.root)navigation.replace(capture());navButtons();
  }
  function renderProfiles(){
    workspaceLibrary=W.read(localStorage);const list=$('profile-list');list.replaceChildren();
    for(const profile of workspaceLibrary.profiles){const row=el('div','profile-row'),name=el('button','profile-name',profile.name),remove=el('button','profile-delete','删除');row.dataset.profileId=profile.id;name.title='应用视角：'+profile.name;name.onclick=async()=>{if(await applySnapshot(profile.snapshot))$('workspace-dialog').close();};remove.setAttribute('aria-label','删除视角 '+profile.name);remove.onclick=()=>{try{workspaceLibrary=W.save(localStorage,{...W.read(localStorage),profiles:W.read(localStorage).profiles.filter(p=>p.id!==profile.id)});renderProfiles();notifyBackup();}catch(error){workspaceError(error.message);}};row.append(name,remove);list.append(row);}
    if(!workspaceLibrary.profiles.length)list.append(el('p','preview-placeholder','把当前范围、隐藏规则和位置保存成一个视角，之后可以一键切换。'));
    profileSaveLabel();
  }
  function profileSaveLabel(){const name=$('profile-name').value.trim();$('profile-save').textContent=W.read(localStorage).profiles.some(p=>p.name===name)?'更新此视角':'保存当前视角';}
  function openWorkspace(){
    $('workspace-error').hidden=true;importData=null;importGeneration++;$('settings-file').value='';$('import-summary').textContent='';$('settings-restore').disabled=true;renderProfiles();$('workspace-dialog').showModal();
  }
  function saveProfile(){
    if(!state.root||state.loading){workspaceError('请等待图谱加载完成后保存。');return;}
    const name=$('profile-name').value.trim();if(!name){workspaceError('请给这个视角起个名字。');return;}
    try{const lib=W.read(localStorage),existing=lib.profiles.find(p=>p.name===name),profile={id:existing?.id||'view-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),name,snapshot:capture()};workspaceLibrary=W.save(localStorage,{profiles:existing?lib.profiles.map(p=>p.id===existing.id?profile:p):[...lib.profiles,profile],last:profile.snapshot});$('workspace-error').hidden=true;$('workspace-status').textContent='已保存视角：'+name;renderProfiles();notifyBackup();}catch(error){workspaceError(error.message);}
  }
  function exportSettings(){
    try{const data=W.envelope(state.root?capture():W.current(localStorage),W.read(localStorage)),text=JSON.stringify(data,null,2);W.parse(text);const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()).replace(/\D/g,'');const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'})),link=el('a');link.href=url;link.download='图谱设置备份_'+stamp+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);$('workspace-status').textContent='已导出图谱设置与常用视角。';}catch(error){workspaceError(error.message);}
  }
  async function api(endpoint,body,signal,referenceScope){
    const allowed=['/api/notebook/lsNotebooks','/api/filetree/listDocsByPath','/api/block/getBlockInfo','/api/block/getBlockKramdown','/api/query/sql'];
    if(!allowed.includes(endpoint))throw new Error('图谱只读取文档，不修改笔记');
    if(endpoint==='/api/filetree/listDocsByPath'&&!selectedNow().has(body.notebook))throw new Error('笔记本不在当前选择范围');
    if(endpoint==='/api/query/sql'&&(!referenceScope||referenceScope.books.some(id=>!selectedNow().has(id))||body.stmt!==R.query(referenceScope.books,referenceScope.cursor)))throw new Error('双链读取范围不符');
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
    if(!response.ok)throw new Error('思源连接失败（'+response.status+'）');
    const result=await response.json();if(result.code!==0)throw new Error(result.msg||'思源未返回数据');return result.data;
  }
  async function load(silent=false){
    if(state.loading&&silent)return;
    state.loadController?.abort();const controller=new AbortController();state.loadController=controller;
    state.loading=true;$('refresh').disabled=true;
    if(!silent){$('connection').textContent='正在读取所选笔记本';$('empty').hidden=false;$('empty').textContent='正在读取思源文档层级…';}
    const generation=++state.generation;
    try{
      const catalog=await api('/api/notebook/lsNotebooks',{},controller.signal);
      if(!Array.isArray(catalog?.notebooks))throw new Error('无法取得笔记本列表');
      state.catalog=catalog.notebooks.filter(book=>S.valid(book.id));
      const selectedIds=state.selection.slice(),selectedSet=new Set(selectedIds);
      const books=S.selectedBooks(state.catalog,selectedIds);
      const roots=books.map(book=>({id:book.id,title:book.name||'未命名笔记本',notebookId:book.id,kind:'notebook',path:'/',children:[]}));
      const root=roots.length===1?roots[0]:{id:'atlas-root',title:'我的知识图谱',kind:'collection',children:roots};
      const seen=new Set([root.id,...roots.map(n=>n.id)]);
      async function branch(parent){
        if(!selectedSet.has(parent.notebookId))throw new Error('笔记本范围不符');
        const result=await api('/api/filetree/listDocsByPath',{notebook:parent.notebookId,path:parent.path,maxListCount:100000,ignoreMaxListHint:true},controller.signal);
        if(result.box&&result.box!==parent.notebookId)throw new Error('返回数据不属于所选笔记本');
        if(!Array.isArray(result.files))throw new Error('文档目录格式不正确');
        for(const file of result.files){
          if(!valid(file.id)||seen.has(file.id))continue;
          seen.add(file.id);
          if(!/^\/(?:\d{14}-[a-z0-9]{7}\/)*\d{14}-[a-z0-9]{7}\.sy$/.test(file.path))throw new Error('文档路径格式不正确');
          const node={id:file.id,title:file.name||'未命名',notebookId:parent.notebookId,kind:'document',path:file.path,children:[],updated:file.hMtime||'',childCount:Number(file.subFileCount||0)};
          parent.children.push(node);
        }
        for(const child of parent.children)if(child.childCount>0)await branch(child);
        if(parent.childCount&&parent.children.length<parent.childCount)throw new Error('思源返回的目录不完整，请稍后刷新');
      }
      for(const notebook of roots)await branch(notebook);
      if(generation!==state.generation||state.destroyed)return;
      const signature=JSON.stringify(root,(k,v)=>k==='updated'?undefined:v);
      const changed=signature!==state.signature;
      const map=C.indexTree(root);let references={edges:[],limited:false},referenceError='';
      try{references=await R.read(books.map(b=>b.id),map,(stmt,scope)=>api('/api/query/sql',{stmt},controller.signal,scope));}
      catch(error){if(error.name==='AbortError')throw error;referenceError=error.message;}
      if(generation!==state.generation||state.destroyed)return;
      state.allReferences=references.edges;state.referenceLimited=references.limited;state.referenceError=referenceError;
      state.rawRoot=root;state.rawMap=map;state.signature=signature;projectVisibility();
      state.treeOpen.add(state.root.id);
      $('connection').classList.remove('error');$('connection').textContent='已连接思源';
      updateScope(books);
      $('updated').textContent='最近更新 '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' · 本地读取';
      if(restorePending){const saved=restorePending;restorePending=null;restoreView(saved);}else if(changed||!silent){renderTree();renderMap(true);renderDetails();}else{drawReferences();renderReferenceDetails();if(isDocument(state.selected))renderPreview(state.selected);}
      if(!roots.length){$('empty').hidden=false;$('empty').textContent=selectedIds.length?'所选笔记本当前不可用。请打开、解锁笔记本，或重新选择。':'尚未选择笔记本。点击左上方“展示范围”开始选择。';}
      else if(!state.query)$('empty').hidden=true;
      document.body.dataset.ready='true';
    }catch(error){
      if(error.name==='AbortError'||generation!==state.generation)return;
      $('connection').classList.add('error');$('connection').textContent='连接待恢复';
      if(!state.root){$('empty').hidden=false;$('empty').textContent=error.message+'\n请确认思源已打开，且所选笔记本处于打开状态。';$('details').replaceChildren(el('h2','detail-title','尚未连接'),el('p','error-message',error.message));}
      $('graph-count').textContent=error.message;
    }finally{if(generation===state.generation){state.loading=false;$('refresh').disabled=false;if(state.root){remember();if(!W.read(localStorage).last||sessionDirty)scheduleSession();}}}
  }
  function updateScope(books){
    const label=books.length===1?books[0].name:books.length?'已选 '+books.length+' 个笔记本':'选择笔记本';
    $('scope-label').textContent=label;$('scope-subtitle').textContent=label;
    $('scope-note-text').textContent=books.length===1?'仅展示“'+books[0].name+'”':'仅展示已选的 '+books.length+' 个笔记本';
    $('choose-notebooks').title=books.map(book=>book.name).join('、')||'选择要展示的笔记本';
  }
  function resetScope(){
    state.loadController?.abort();state.previewController?.abort();state.generation++;state.previewGeneration++;
    state.root=null;state.focus=null;state.selected=null;state.map=new Map();state.visible=[];state.signature=null;
    state.rawRoot=null;state.rawMap=new Map();state.allReferences=[];state.hideDraft=null;$('hidden-dialog').close();updateHiddenCount();
    state.networkGroups=new Map();state.networkLabelKey=null;state.sunLabelKey=null;
    state.references=[];state.referenceLimited=false;state.referenceError='';$('reference-status').textContent='';
    state.query='';$('search').value='';$('tree').replaceChildren();$('viewport').replaceChildren();$('breadcrumbs').replaceChildren();
    $('details').replaceChildren(el('p','preview-placeholder','正在加载所选笔记本…'));
    $('tooltip').hidden=true;document.body.dataset.ready='false';
  }
  function projectVisibility(){
    const oldFocus=state.rawMap.get(state.focus?.id),oldSelected=state.rawMap.get(state.selected?.id);
    state.root=H.project(state.rawRoot,state.hidden);state.map=C.indexTree(state.root);
    state.references=H.references(state.allReferences,state.map);
    state.focus=H.nearest(oldFocus,state.map)||state.root;state.selected=H.nearest(oldSelected,state.map)||state.focus;
    updateHiddenCount();
  }
  function updateHiddenCount(){
    const hidden=state.rawRoot?count(state.rawRoot)-count(state.root):0;
    $('manage-hidden').textContent='隐藏内容'+(hidden?' · '+hidden+' 篇':'');$('manage-hidden').disabled=!state.rawRoot;
    $('manage-hidden-header').disabled=!state.rawRoot;
  }
  function applyVisibility(){
    if(!state.rawRoot)return;
    state.previewController?.abort();state.previewGeneration++;$('tooltip').hidden=true;
    projectVisibility();renderTree();renderMap(true);renderDetails();
  }
  function saveHidden(ids){
    try{state.hidden=H.write(localStorage,ids);return true;}catch{$('hidden-error').textContent='无法保存隐藏设置，请检查本地存储是否可用。';$('hidden-error').hidden=false;return false;}
  }
  function hideNote(node){
    if(!isDocument(node)||!state.map.has(node.id))return;
    const draft=new Set(state.hidden);draft.add(node.id);
    if(saveHidden(draft))applyVisibility();else{hiddenDialog(draft);$('hidden-error').textContent='无法保存隐藏设置，请检查本地存储是否可用。';$('hidden-error').hidden=false;}
  }
  function hiddenDialog(draft){
    if(!state.rawRoot)return;
    state.hideDraft=draft||new Set(state.hidden);state.hideLimit=200;$('hidden-search').value='';$('hidden-only').checked=false;
    $('hidden-error').hidden=true;renderHiddenList();$('hidden-dialog').showModal();
  }
  function renderHiddenList(){
    if(!state.hideDraft||!state.rawRoot)return;
    const list=$('hidden-list');list.replaceChildren();
    const query=$('hidden-search').value.trim().toLocaleLowerCase(),only=$('hidden-only').checked,draft=state.hideDraft;
    const documents=[...state.rawMap.values()].filter(isDocument);
    const matches=documents.filter(n=>(!query||C.ancestors(n).map(p=>p.title).join(' / ').toLocaleLowerCase().includes(query))&&(!only||H.covered(n,draft)));
    for(const node of matches.slice(0,state.hideLimit)){
      const inherited=H.covered(node.parent,draft),row=el('label','notebook-option hidden-option'),check=el('input');check.type='checkbox';check.value=node.id;check.checked=H.covered(node,draft);check.disabled=inherited;
      check.setAttribute('aria-label','隐藏 '+node.title);if(inherited)check.title='随上级隐藏，取消上级勾选后可单独设置';
      row.style.paddingLeft=(Math.min(node.depth-1,5)*12+4)+'px';
      const text=el('span','notebook-option-text');text.append(el('strong','',node.title),el('small','',C.ancestors(node).slice(0,-1).map(p=>p.title).join(' / ')+(inherited?' · 随上级隐藏':count(node)?' · 含下级 '+count(node)+' 篇':'')));
      row.append(check,text);list.append(row);check.onchange=()=>{check.checked?draft.add(node.id):draft.delete(node.id);renderHiddenList();const next=list.querySelector('input[value="'+node.id+'"]');if(next)next.focus();};
    }
    if(!matches.length)list.append(el('p','preview-placeholder',documents.length?'没有匹配的笔记。':'当前展示范围没有笔记。'));
    if(matches.length>state.hideLimit){const more=el('button','text-button','再显示 '+Math.min(200,matches.length-state.hideLimit)+' 项');more.onclick=()=>{state.hideLimit+=200;renderHiddenList();};list.append(more);}
    $('hidden-count').textContent='当前范围将隐藏 '+documents.filter(n=>H.covered(n,draft)).length+' / '+documents.length+' 篇笔记';
  }
  async function notebookDialog(){
    const dialog=$('notebook-dialog'),list=$('notebook-list');list.replaceChildren(el('p','preview-placeholder','正在读取笔记本列表…'));
    $('notebook-selection-error').hidden=true;$('notebook-apply').disabled=true;
    if(!dialog.open)dialog.showModal();
    try{
      const data=await api('/api/notebook/lsNotebooks',{});state.catalog=(data.notebooks||[]).filter(book=>S.valid(book.id));
      list.replaceChildren();const wanted=selectedNow();
      for(const book of state.catalog){
        const row=el('label','notebook-option'),checkbox=el('input');checkbox.type='checkbox';checkbox.value=book.id;checkbox.checked=wanted.has(book.id);checkbox.disabled=!S.available(book);
        const text=el('span','notebook-option-text');text.append(el('strong','',book.name||'未命名笔记本'),el('small','',book.closed?'已关闭，请先在思源中打开':book.encrypted&&!book.unlocked?'已锁定，请先解锁':'可展示'));
        row.append(checkbox,text);list.append(row);checkbox.onchange=selectionCount;
      }
      if(!state.catalog.length)list.append(el('p','preview-placeholder','暂未找到笔记本。'));
      selectionCount();$('notebook-apply').disabled=false;
    }catch(error){list.replaceChildren(el('p','error-message',error.message));}
  }
  function selectionCount(){const checks=[...$('notebook-list').querySelectorAll('input:checked')];$('notebook-selection-count').textContent='已勾选 '+checks.length+' 个笔记本'+(checks.some(c=>c.disabled)?'，不可用的笔记本暂不读取':'');}
  function applySelection(){
    const ids=[...$('notebook-list').querySelectorAll('input:checked')].map(c=>c.value);
    try{state.selection=S.write(localStorage,ids);}catch{const error=$('notebook-selection-error');error.hidden=false;error.textContent='无法保存选择，请检查本地存储是否可用。';return;}
    $('notebook-dialog').close();resetScope();load();
  }
  function focus(node){state.focus=node;state.selected=node;state.collapsed.delete(node.id);state.query='';$('search').value='';for(const p of C.ancestors(node))state.treeOpen.add(p.id);renderTree();renderMap(true);renderDetails();}
  function select(node,{reveal=false}={}){
    state.selected=node;for(const p of C.ancestors(node))state.treeOpen.add(p.id);
    const rebuild=reveal&&!state.visible.some(n=>n.id===node.id);
    if(rebuild){state.focus=node.parent||node;state.collapsed.delete(state.focus.id);}
    renderTree();
    if(rebuild)renderMap(true);
    else document.querySelectorAll('#viewport [data-node-id]').forEach(g=>g.classList.toggle('selected',g.dataset.nodeId===node.id));
    if(!rebuild){drawReferences();updateLabels();}
    renderDetails();
  }
  function renderTree(){
    const tree=$('tree');tree.replaceChildren();if(!state.root)return;
    const query=state.query.toLocaleLowerCase();
    const matches=query?[...state.map.values()].filter(n=>isDocument(n)&&n.title.toLocaleLowerCase().includes(query)):null;
    $('search-info').hidden=!query;$('search-info').textContent=matches?'找到 '+matches.length+' 篇笔记'+(matches.length>60?'，目录显示前 60 项':''):'';
    function row(node,depth,flat=false){
      const r=el('div','tree-row'+(state.selected?.id===node.id?' selected':''));r.setAttribute('role','treeitem');r.setAttribute('aria-level',String(depth+1));r.setAttribute('aria-selected',String(state.selected?.id===node.id));r.style.paddingLeft=Math.min(depth,6)*12+'px';
      const toggle=el('button','tree-toggle',node.children.length?(state.treeOpen.has(node.id)?'▾':'▸'):'');toggle.setAttribute('aria-label',(state.treeOpen.has(node.id)?'折叠':'展开')+node.title);toggle.disabled=!node.children.length;toggle.onclick=()=>{state.treeOpen.has(node.id)?state.treeOpen.delete(node.id):state.treeOpen.add(node.id);renderTree();};r.append(toggle);
      const dot=el('span','tree-dot');dot.style.background=node===state.root?'#263e60':C.color(node);r.append(dot);
      const label=el('button','tree-label',node.title);label.title=node.title;label.onclick=()=>select(node,{reveal:true});label.ondblclick=()=>focus(node);r.append(label);
      if(count(node))r.append(el('span','tree-count',count(node)));tree.append(r);
      if(!flat&&state.treeOpen.has(node.id)){
        const children=node.children.slice(0,100);
        children.forEach(c=>row(c,depth+1));
        if(node.children.length>100){const note=el('p','preview-placeholder','另有 '+(node.children.length-100)+' 篇，可搜索定位');note.style.paddingLeft=(depth+1)*12+28+'px';tree.append(note);}
      }
    }
    if(matches)matches.slice(0,60).forEach(n=>row(n,0,true));else row(state.root,0);
  }
  function renderBreadcrumbs(){const b=$('breadcrumbs');b.replaceChildren();C.ancestors(state.focus).forEach((n,i)=>{if(i)b.append(el('span','', '›'));const button=el('button','',n.title);button.title=n.title;button.onclick=()=>focus(n);b.append(button);});}
  function renderMap(reset=false){
    if(!state.root)return;
    document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===state.view);b.setAttribute('aria-pressed',String(b.dataset.view===state.view));});
    $('label-control').hidden=false;$('label-mode').value=state.labelMode;
    renderBreadcrumbs();
    const result=C.visibleTree(state.focus,{depth:Number($('depth').value),limit:Number($('limit').value),query:state.query,collapsed:state.collapsed,selected:state.selected});state.visible=result.nodes;
    const viewport=$('viewport');viewport.replaceChildren();
    if(state.view==='sunburst')drawSunburst(result);else drawNetwork(result);
    drawReferences();
    const shown=result.nodes.filter(n=>n.parent&&isDocument(n.original)).length,total=count(state.focus);
    $('graph-count').textContent='显示 '+shown+' / '+total+' 篇'+(shown<total?' · 可搜索、聚焦或增加展开范围':'');
    if(state.query&&shown===0){$('empty').hidden=false;$('empty').textContent='没有匹配的笔记标题';}else $('empty').hidden=true;
    if(reset){state.zoom=1;state.panX=0;state.panY=0;}
    fitScale();transform();
  }
  function interactions(shape,node){
    shape.setAttribute('tabindex','0');shape.setAttribute('role','button');shape.setAttribute('aria-label',node.title+'，下级 '+count(node)+' 篇');shape.dataset.nodeId=node.id;
    shape.append(svg('title',{},node.title));
    shape.addEventListener('click',e=>{if(state.moved)return;e.stopPropagation();select(node.original);});
    shape.addEventListener('dblclick',e=>{e.stopPropagation();focus(node.original);});
    shape.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();select(node.original);}if(e.key===' '){e.preventDefault();focus(node.original);}});
    shape.addEventListener('pointerenter',e=>{const t=$('tooltip');t.replaceChildren(el('strong','',node.title),el('div','',count(node)?'下级 '+count(node)+' 篇 · 双击聚焦':isDocument(node.original)?'单击查看笔记':'此笔记本暂无笔记'));const rect=$('canvas-wrap').getBoundingClientRect();t.style.left=Math.max(8,Math.min(e.clientX-rect.left+14,rect.width-265))+'px';t.style.top=Math.max(65,e.clientY-rect.top-50)+'px';t.hidden=false;});
    shape.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;});
  }
  function drawNetwork({root,nodes}){
    if(state.view==='grouped')C.grouped(root);else C.radial(root);
    const v=$('viewport');state.networkGroups=new Map();state.networkLabelKey=null;
    if(state.view==='grouped')root.children.filter(n=>n.children.length).forEach(n=>{const radius=Math.min(270,115+Math.sqrt(n.children.length)*10);v.append(svg('circle',{cx:n.x,cy:n.y,r:radius,fill:C.color(n),stroke:C.color(n),class:'graph-cluster'}));});
    nodes.filter(n=>n.parent).forEach(n=>{const p=n.parent;v.append(svg('path',{d:`M${p.x},${p.y}Q${(p.x+n.x)*.38},${(p.y+n.y)*.38} ${n.x},${n.y}`,class:'graph-link'}));});
    nodes.forEach(n=>{
      const rootNode=!n.parent;const radius=rootNode?25:n.children.length?Math.min(16,8+Math.sqrt(n.descendants)*.45):4;
      n.nodeRadius=radius;
      const g=svg('g',{transform:`translate(${n.x},${n.y})`,class:'graph-node'+(state.selected?.id===n.id?' selected':'')});
      if(rootNode)g.append(svg('circle',{r:33,fill:'none',stroke:'#4779bd','stroke-opacity':.16,'stroke-width':1}));
      g.append(svg('circle',{r:radius,fill:rootNode?'#365775':C.color(n),'fill-opacity':rootNode?1:n.children.length?.95:.6}));
      interactions(g,n);v.append(g);state.networkGroups.set(n.id,g);
    });
    state.bounds=nodes.reduce((b,n)=>({minX:Math.min(b.minX,n.x-105),maxX:Math.max(b.maxX,n.x+105),minY:Math.min(b.minY,n.y-70),maxY:Math.max(b.maxY,n.y+70)}),{minX:-100,maxX:100,minY:-80,maxY:80});
  }
  function drawSunburst({root,nodes}){
    C.partition(root);const v=$('viewport');let maxRadius=86;state.sunLabelKey=null;
    nodes.filter(n=>n.parent).forEach(n=>{
      const inner=83+(n.depth-1)*75,outer=inner+73;maxRadius=Math.max(maxRadius,outer);
      const path=svg('path',{d:C.arcPath(inner,outer,n.start,n.end),fill:C.color(n),class:'sun-sector'+(state.selected?.id===n.id?' selected':'')});interactions(path,n);v.append(path);
    });
    nodes.forEach(n=>{const r=n.parent?83+(n.depth-1)*75+37:0;n.x=Math.cos(n.angle)*r;n.y=Math.sin(n.angle)*r;});
    const center=svg('g',{class:'graph-node'});center.append(svg('circle',{r:80,class:'sun-center'}));center.append(svg('text',{x:0,y:-2,'text-anchor':'middle',class:'root-label'},brief(root.title,10)));center.append(svg('text',{x:0,y:22,'text-anchor':'middle',class:'node-count'},count(root)+' 篇笔记'));interactions(center,root);v.append(center);
    state.bounds={minX:-maxRadius-18,maxX:maxRadius+18,minY:-maxRadius-18,maxY:maxRadius+18};
  }
  const labelMeasure=document.createElement('canvas').getContext('2d');
  const labelFont=getComputedStyle(document.body).fontFamily;
  function fitLabel(title,width,fontSize){
    const characters=Array.from(title),measure=text=>labelMeasure?labelMeasure.measureText(text).width:Array.from(text).length*fontSize;
    if(labelMeasure)labelMeasure.font=fontSize+'px '+labelFont;
    if(measure(title)<=width)return title;
    let low=1,high=characters.length;
    while(low<high){const middle=Math.ceil((low+high)/2);if(measure(characters.slice(0,middle).join('')+'…')<=width)low=middle;else high=middle-1;}
    return characters.slice(0,low).join('')+'…';
  }
  function updateLabels(){if(state.view==='sunburst')updateSunburstLabels();else updateNetworkLabels();}
  function updateNetworkLabels(){
    if(state.view==='sunburst')return;
    const scale=state.baseScale*state.zoom,selectedId=state.selected?.id;
    const key=[state.view,scale,state.labelMode,selectedId,state.query].join('|');if(state.networkLabelKey===key)return;state.networkLabelKey=key;
    $('viewport').querySelectorAll('[data-network-label]').forEach(n=>n.remove());
    const all=state.labelMode==='all',query=state.query.toLocaleLowerCase(),occupied=[];
    const priority=n=>!n.parent?0:n.id===selectedId?1:query&&n.title.toLocaleLowerCase().includes(query)?2:n.depth===1?3:4;
    const nodes=state.visible.slice().sort((a,b)=>priority(a)-priority(b)||a.depth-b.depth);
    for(const n of nodes){
      const group=state.networkGroups.get(n.id);if(!group)continue;
      const root=!n.parent,right=n.x>=0,anchor=root?'middle':right?'start':'end';
      const x=root?0:(right?1:-1)*(n.nodeRadius+7),y=root?49:3;
      const fontSize=Math.min(root?26:20,(root?15:n.depth===1?12:10.5)/scale),counterSize=Math.min(16,9/scale);
      const text=fitLabel(n.title,root?230:n.depth===1?180:150,fontSize);
      if(labelMeasure)labelMeasure.font=fontSize+'px '+labelFont;
      let width=(labelMeasure?labelMeasure.measureText(text).width:Array.from(text).length*fontSize)*scale;
      const counter=n.children.length||root?count(n)+' 篇'+(n.hidden?' · '+n.hidden+' 项未展开':''):null;
      const counterY=y+fontSize+4/scale;
      if(counter){if(labelMeasure)labelMeasure.font=counterSize+'px '+labelFont;width=Math.max(width,(labelMeasure?labelMeasure.measureText(counter).width:counter.length*counterSize)*scale);}
      const left=(n.x+x)*scale-(anchor==='end'?width:anchor==='middle'?width/2:0);
      const box={left:left-3,right:left+width+3,top:(n.y+y-fontSize)*scale-3,bottom:(n.y+(counter?counterY:y))*scale+4};
      // Filter overlapping screen-space labels in automatic mode; every visible node
      // keeps its label in all mode. Selection and search results always get a name.
      if(!all&&priority(n)>2&&occupied.some(b=>box.left<b.right&&box.right>b.left&&box.top<b.bottom&&box.bottom>b.top))continue;
      occupied.push(box);
      const title=svg('text',{x,y,'text-anchor':anchor,class:root?'root-label':n.depth===1?'branch-label':'leaf-label','data-network-label':'true','data-label-id':n.id},text);title.style.fontSize=fontSize+'px';group.append(title);
      if(counter){const label=svg('text',{x,y:counterY,'text-anchor':anchor,class:'node-count','data-network-label':'true'},counter);label.style.fontSize=counterSize+'px';group.append(label);}
    }
  }
  function updateSunburstLabels(){
    if(state.view!=='sunburst')return;
    const scale=state.baseScale*state.zoom,selectedId=state.selected?.id;
    const key=[scale,state.labelMode,selectedId,state.query].join('|');if(state.sunLabelKey===key)return;state.sunLabelKey=key;
    const viewport=$('viewport');viewport.querySelector('[data-sun-labels]')?.remove();
    const labels=svg('g',{'data-sun-labels':'true','aria-hidden':'true'}),all=state.labelMode==='all';
    for(const n of state.visible){
      if(!n.parent)continue;
      const radius=83+(n.depth-1)*75+37,angle=(n.start+n.end)/2,arc=(n.end-n.start)*radius;
      const selected=n.id===selectedId,matched=state.query&&n.title.toLocaleLowerCase().includes(state.query.toLocaleLowerCase());
      // Automatic density is measured on screen, so zoom and window size reveal labels.
      if(!all&&arc*scale<8&&!selected&&!matched)continue;
      const radial=arc<90,fontSize=Math.min(16,Math.max((all?6:8)/scale,Math.min(11/scale,arc*.78)));
      const width=radial?61:Math.min(arc-12,190);
      let degrees=angle*180/Math.PI+(radial?0:90);const normalized=(degrees%360+360)%360;if(normalized>90&&normalized<270)degrees+=180;
      const text=svg('text',{x:0,y:0,transform:`translate(${Math.cos(angle)*radius},${Math.sin(angle)*radius}) rotate(${degrees})`,'text-anchor':'middle','dominant-baseline':'central',class:'sun-label'+(selected?' selected-label':''),'data-label-id':n.id,'data-orientation':radial?'radial':'tangent'},fitLabel(n.title,width,fontSize));
      text.style.fontSize=fontSize+'px';labels.append(text);
    }
    viewport.append(labels);
  }
  function drawReferences(){
    const viewport=$('viewport');viewport.querySelector('[data-reference-layer]')?.remove();
    viewport.querySelector('[data-reference-defs]')?.remove();
    viewport.querySelectorAll('.reference-neighbor').forEach(n=>n.classList.remove('reference-neighbor'));
    const status=$('reference-status');
    $('show-references').checked=state.showReferences;$('selected-references').checked=state.selectedReferences;$('selected-references').disabled=!state.showReferences;
    status.title='';
    if(state.referenceError){status.textContent='双链暂不可用';status.title=state.referenceError;return;}
    if(!state.showReferences){status.textContent='双链已隐藏';return;}
    if(state.selectedReferences&&!isDocument(state.selected)){status.textContent='请选择笔记查看双链';return;}
    const selectedId=isDocument(state.selected)?state.selected.id:null;
    const shown=R.visible(state.references,state.visible,{selectedOnly:state.selectedReferences,selectedId});
    status.textContent='双链 '+shown.edges.length+' 条可见 / '+state.references.length+' 组引用'+(state.referenceLimited?'＋':'');
    status.title=state.referenceLimited?'引用较多，可缩小笔记本范围以查看完整关联。':state.references.length?'虚线箭头从引用方指向被引用方；折叠或未显示的笔记，可在右侧双链列表中查看。':'当前所选范围没有思源原生块引用。建立引用后刷新即可显示。';
    if(shown.total>shown.edges.length)status.textContent+=' · 可切换为仅看当前笔记';
    if(!shown.edges.length)return;
    const defs=svg('defs',{'data-reference-defs':'true'}),marker=svg('marker',{id:'atlas-ref-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:5,markerHeight:5,orient:'auto',markerUnits:'strokeWidth'});
    marker.append(svg('path',{d:'M0,0L10,5L0,10Z',class:'reference-arrow'}));defs.append(marker);viewport.prepend(defs);
    const layer=svg('g',{'data-reference-layer':'true','aria-hidden':'true'}),positions=new Map(state.visible.map(n=>[n.id,n]));
    const pairs=new Set(state.references.map(e=>e.source+'>'+e.target)),neighbors=new Set();
    for(const edge of shown.edges){
      const source=positions.get(edge.source),target=positions.get(edge.target);if(!source||!target)continue;
      const d=R.path(source,target,pairs.has(edge.target+'>'+edge.source));if(!d)continue;
      const related=edge.source===selectedId||edge.target===selectedId;
      if(related){neighbors.add(edge.source);neighbors.add(edge.target);}
      layer.append(svg('path',{d,class:'reference-edge'+(related?' related':selectedId?' subdued':''),'marker-end':'url(#atlas-ref-arrow)','data-source':edge.source,'data-target':edge.target,'data-count':edge.count}));
    }
    // Layouts have already been calculated exclusively from the document tree.
    // The separate layer never participates in hierarchy or layout algorithms.
    const firstNode=viewport.querySelector('.graph-node');viewport.insertBefore(layer,firstNode||null);
    if(selectedId)viewport.querySelectorAll('[data-node-id]').forEach(n=>{if(n.dataset.nodeId!==selectedId&&neighbors.has(n.dataset.nodeId))n.classList.add('reference-neighbor');});
  }
  function renderReferenceDetails(){
    const host=$('reference-details'),node=state.selected;if(!host||!isDocument(node))return;
    host.replaceChildren(el('h3','section-heading','双链关系'));
    if(state.referenceError){host.append(el('p','preview-placeholder','暂时无法取得双链，点击“刷新”重试。'));return;}
    const links=R.forNote(state.references,node.id);
    if(!links.outgoing.length&&!links.incoming.length){host.append(el('p','preview-placeholder','当前展示范围内暂无引用或反向引用。在思源中建立块引用后，刷新即可显示。'));return;}
    for(const [name,edges,field] of [['引用了',links.outgoing,'target'],['被引用',links.incoming,'source']]){
      if(!edges.length)continue;
      const section=el('div','reference-section');section.append(el('p','reference-section-title',name+' · '+edges.length+' 篇'));
      const list=el('div','reference-list');section.append(list);host.append(section);let limit=20;
      const draw=()=>{
        list.replaceChildren();
        for(const edge of edges.slice(0,limit)){
          const other=state.map.get(edge[field]);if(!other)continue;
          const button=el('button','reference-note');button.append(el('span','',other.title),el('small','',edge.count+' 处'));
          button.title=other.title+' · '+edge.count+' 处引用';button.onclick=()=>select(other,{reveal:true});list.append(button);
        }
        if(edges.length>limit){const more=el('button','text-button','再显示 '+Math.min(20,edges.length-limit)+' 篇');more.onclick=()=>{limit+=20;draw();};list.append(more);}
      };draw();
    }
    host.append(el('p','reference-direction','箭头表示引用方向。块级引用归到所属笔记，同一笔记中的引用不画自连线。'));
  }
  function fitScale(){const b=state.bounds,rect=$('graph').getBoundingClientRect();if(!b)return;state.baseScale=Math.max(.15,Math.min((rect.width-60)/(b.maxX-b.minX),(rect.height-150)/(b.maxY-b.minY),1.35));}
  function transform(){const rect=$('graph').getBoundingClientRect(),b=state.bounds||{minX:0,maxX:0,minY:0,maxY:0},scale=state.baseScale*state.zoom;const cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2;$('viewport').setAttribute('transform',`translate(${rect.width/2+state.panX},${rect.height/2+state.panY+5}) scale(${scale}) translate(${-cx},${-cy})`);updateLabels();}
  function zoom(factor){
    state.zoom=Math.min(8,Math.max(.3,state.zoom*factor));transform();
  }
  function renderDetails(){
    const host=$('details'),n=state.selected||state.root;host.replaceChildren();
    host.append(el('div','detail-eyebrow',isDocument(n)?'KNOWLEDGE NOTE':'KNOWLEDGE ATLAS'));
    host.append(el('h2','detail-title',n.title));host.append(el('div','detail-path',C.ancestors(n).map(p=>p.title).join(' / ')));
    const stats=el('div','stats-grid');for(const [value,label]of [[count(n),'下级笔记'],[n.children.length,n.kind==='collection'?'笔记本':'直接下级']]){const stat=el('div','stat');stat.append(el('strong','',value),el('span','',label));stats.append(stat);}host.append(stats);
    if(isDocument(n)){const open=el('button','open-note','在思源中打开并编辑 ↗');open.onclick=()=>openNote(n);host.append(open);const hide=el('button','hide-note text-button',n.children.length?'隐藏此笔记及下级':'在图谱中隐藏');hide.onclick=()=>hideNote(n);host.append(hide);}
    if(n.children.length){const button=el('button','focus-note','聚焦此主题');button.onclick=()=>focus(n);host.append(button);host.append(el('h3','section-heading','下级笔记'));for(const child of n.children.slice(0,12))host.append(branchCard(child));if(n.children.length>12)host.append(el('p','preview-placeholder','还有 '+(n.children.length-12)+' 篇，可通过左侧搜索定位。'));}
    if(!isDocument(n)){
      host.append(el('h3','section-heading',n.kind==='collection'?'所选笔记本':'知识分区'));for(const child of n.children){const row=el('div','legend-row'),label=el('span'),dot=el('i');dot.style.background=C.color(child);label.append(dot,document.createTextNode(child.title));row.append(label,el('small','',count(child)+(isDocument(child)?1:0)));host.append(row);}
      host.append(el('p','detail-tip','这里展示思源的真实文档层级。你在思源中整理目录，图谱便会随之更新。点击节点查看笔记，双击进入主题。'));
    }else{const links=el('section','reference-details');links.id='reference-details';host.append(links);renderReferenceDetails();host.append(el('h3','section-heading','笔记内容'));const preview=el('div','preview');preview.id='preview';preview.append(el('p','preview-placeholder','正在读取笔记…'));host.append(preview);renderPreview(n);}
  }
  function branchCard(n){const card=el('button','branch-card');const dot=el('span','dot');dot.style.background=C.color(n);card.append(dot,el('span','name',n.title),el('span','count',count(n)?'+'+count(n):isDocument(n)?'↗':'0 篇'));card.title=n.title;card.onclick=()=>select(n,{reveal:true});card.ondblclick=()=>focus(n);return card;}
  async function renderPreview(node){
    const id=++state.previewGeneration;
    state.previewController?.abort();const controller=new AbortController();state.previewController=controller;
    try{
      if(!isDocument(node)||!state.map.has(node.id)||!selectedNow().has(node.notebookId))throw new Error('此笔记不在当前展示范围');
      const info=await api('/api/block/getBlockInfo',{id:node.id},controller.signal);
      if(!selectedNow().has(info.box)||info.box!==node.notebookId||info.rootID!==node.id)throw new Error('此笔记已移出当前展示范围，请刷新图谱');
      if(id!==state.previewGeneration||state.selected?.id!==node.id||!state.map.has(node.id))return;
      const result=await api('/api/block/getBlockKramdown',{id:node.id},controller.signal);if(id!==state.previewGeneration||state.selected?.id!==node.id||!state.map.has(node.id)||!selectedNow().has(node.notebookId))return;
      const host=$('preview');if(!host)return;host.replaceChildren();
      const text=String(result.kramdown||'').replace(/\{:[^}\n]*\}/g,'').trim();
      if(!text){host.append(el('p','preview-placeholder','这篇笔记还没有正文。可以在思源中打开并填写。'));return;}
      let inCode=false,code=[];
      for(const line of text.split('\n').slice(0,450)){
        if(/^\s*```/.test(line)){if(inCode){host.append(el('pre','',code.join('\n')));code=[];}inCode=!inCode;continue;}
        if(inCode){code.push(line);continue;}if(!line.trim())continue;
        const heading=/^#{1,6}\s+(.+)/.exec(line);if(heading){host.append(el('h3','',heading[1]));continue;}
        const image=/^!\[([^\]]*)\]\(([^)]+)\)/.exec(line);
        if(image&&/^\/?assets\//.test(image[2])){const img=el('img');img.alt=image[1];img.src='/'+image[2].replace(/^\//,'');img.loading='lazy';host.append(img);continue;}
        const p=el('p');appendInline(p,line.replace(/^[-*]\s+/,'• '));host.append(p);
      }
      if(inCode&&code.length)host.append(el('pre','',code.join('\n')));
      if(text.split('\n').length>450)host.append(el('p','preview-placeholder','正文较长，完整内容请在思源中打开。'));
    }catch(error){if(error.name!=='AbortError'&&id===state.previewGeneration&&$('preview'))$('preview').replaceChildren(el('p','error-message',error.message));}
  }
  function appendInline(host,text){
    const pattern=/\[([^\]]*)\]\(([^)]+)\)|\*\*(.+?)\*\*/g;let last=0;
    for(const m of text.matchAll(pattern)){
      host.append(document.createTextNode(text.slice(last,m.index)));
      if(m[3]!==undefined)host.append(el('strong','',m[3]));
      else{
        const url=m[2];const note=/^siyuan:\/\/blocks\/(\d{14}-[a-z0-9]{7})$/.exec(url);
        if(note&&state.map.has(note[1])){const a=el('a','',m[1]);a.href='#';a.onclick=e=>{e.preventDefault();select(state.map.get(note[1]),{reveal:true});};host.append(a);}
        else if(/^https?:\/\//i.test(url)||/^\/?assets\//.test(url)){const a=el('a','',m[1]);a.href=/^\/?assets\//.test(url)?'/'+url.replace(/^\//,''):url;a.target='_blank';a.rel='noopener noreferrer';host.append(a);}
        else host.append(document.createTextNode(m[1]));
      }last=m.index+m[0].length;
    }host.append(document.createTextNode(text.slice(last)));
  }
  async function openNote(node){
    if(!isDocument(node)||!valid(node.id)||!state.map.has(node.id)||!selectedNow().has(node.notebookId))return;
    try{
      const info=await api('/api/block/getBlockInfo',{id:node.id});if(!state.map.has(node.id)||!selectedNow().has(info.box)||info.box!==node.notebookId||info.rootID!==node.id)throw new Error('此笔记已移出当前展示范围，请刷新');
      if(window.parent!==window)window.parent.postMessage({type:'personal-atlas-open',id:node.id},location.origin);
      else location.href='siyuan://blocks/'+node.id;
    }catch(error){$('preview')?.replaceChildren(el('p','error-message',error.message));}
  }
  $('choose-notebooks').onclick=notebookDialog;
  $('choose-notebooks-header').onclick=notebookDialog;
  for(const id of ['notebook-close','notebook-cancel'])$(id).onclick=()=>$('notebook-dialog').close();
  $('notebook-clear').onclick=()=>{$('notebook-list').querySelectorAll('input').forEach(c=>{c.checked=false;});selectionCount();};
  $('notebook-apply').onclick=applySelection;
  $('workspace-open').onclick=openWorkspace;$('workspace-close').onclick=()=>$('workspace-dialog').close();$('profile-name').oninput=profileSaveLabel;$('profile-save').onclick=saveProfile;
  $('settings-export').onclick=exportSettings;$('settings-pick').onclick=()=>$('settings-file').click();
  $('settings-file').onchange=async()=>{const generation=++importGeneration;importData=null;$('import-summary').textContent='';$('settings-restore').disabled=true;$('workspace-error').hidden=true;try{const file=$('settings-file').files[0];if(!file)return;if(file.size>W.MAX_BYTES)throw Error('备份文件过大，最多支持 4 MB。');const data=W.parse(await file.text());if(generation!==importGeneration)return;importData=data;$('import-summary').textContent='包含 '+data.profiles.length+' 个常用视角，选择 '+data.current.selection.length+' 个笔记本，隐藏 '+data.current.hidden.length+' 项。';$('settings-restore').disabled=false;}catch(error){if(generation===importGeneration)workspaceError(error.message);}};
  $('settings-restore').onclick=async()=>{if(!importData)return;if(await applySnapshot(importData.current,{library:{profiles:importData.profiles,last:importData.current}})){renderProfiles();$('workspace-error').hidden=true;$('workspace-status').textContent='已恢复备份中的图谱设置。';}};
  $('nav-back').onclick=()=>moveHistory(-1);$('nav-forward').onclick=()=>moveHistory(1);
  $('manage-hidden').onclick=()=>hiddenDialog();$('manage-hidden-header').onclick=()=>hiddenDialog();
  for(const id of ['hidden-close','hidden-cancel'])$(id).onclick=()=>$('hidden-dialog').close();
  $('hidden-search').oninput=()=>{state.hideLimit=200;renderHiddenList();};$('hidden-only').onchange=()=>{state.hideLimit=200;renderHiddenList();};
  $('hidden-restore').onclick=()=>{if(!state.hideDraft)return;for(const n of state.rawMap.values())if(isDocument(n))state.hideDraft.delete(n.id);renderHiddenList();};
  $('hidden-apply').onclick=()=>{if(!state.hideDraft||!saveHidden(state.hideDraft))return;$('hidden-dialog').close();state.hideDraft=null;applyVisibility();};
  $('refresh').onclick=()=>load();$('home').onclick=()=>state.root&&focus(state.root);
  $('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=$('search').value.trim();if(state.query)state.focus=state.root;renderTree();renderMap(true);},160);});
  $('depth').onchange=()=>renderMap(true);$('limit').onchange=()=>renderMap(true);
  $('label-mode').onchange=()=>{state.labelMode=$('label-mode').value;preferences();updateLabels();};
  $('show-references').onchange=()=>{state.showReferences=$('show-references').checked;preferences();drawReferences();};
  $('selected-references').onchange=()=>{state.selectedReferences=$('selected-references').checked;preferences();drawReferences();};
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;preferences();renderMap(true);});
  $('theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';preferences();};
  $('zoom-in').onclick=()=>zoom(1.25);$('zoom-out').onclick=()=>zoom(.8);$('fit').onclick=()=>{state.zoom=1;state.panX=0;state.panY=0;fitScale();transform();};
  const graph=$('graph');
  graph.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.12:1/1.12);},{passive:false});
  graph.addEventListener('pointerdown',e=>{if(e.button!==0)return;state.drag={x:e.clientX,y:e.clientY,panX:state.panX,panY:state.panY};state.moved=false;});
  graph.addEventListener('pointermove',e=>{if(!state.drag)return;const dx=e.clientX-state.drag.x,dy=e.clientY-state.drag.y;if(Math.abs(dx)+Math.abs(dy)>5){state.moved=true;if(!graph.hasPointerCapture(e.pointerId))graph.setPointerCapture(e.pointerId);graph.classList.add('dragging');$('tooltip').hidden=true;}state.panX=state.drag.panX+dx;state.panY=state.drag.panY+dy;transform();});
  graph.addEventListener('pointerup',e=>{state.drag=null;graph.classList.remove('dragging');if(graph.hasPointerCapture(e.pointerId))graph.releasePointerCapture(e.pointerId);setTimeout(()=>{state.moved=false;},0);});
  graph.addEventListener('pointercancel',()=>{state.drag=null;state.moved=false;graph.classList.remove('dragging');});
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{fitScale();transform();},100);});
  window.addEventListener('message',event=>{if(event.source!==window.parent||event.origin!==location.origin)return;if(event.data?.type==='personal-atlas-backup-status'){$('workspace-status').textContent=event.data.ok?'设置已保存到思源工作空间，也可导出一份文件。':'工作空间备份暂不可用，可导出文件备份。';return;}if(event.data?.type!=='personal-atlas-refresh'||!$('auto').checked)return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>load(true),1200);});
  window.addEventListener('storage',event=>{if(event.key===W.KEY){workspaceLibrary=W.read(localStorage);if($('workspace-dialog').open)renderProfiles();return;}if(event.key===H.KEY){state.hidden=H.read(localStorage);$('hidden-dialog').close();state.hideDraft=null;applyVisibility();return;}if(event.key!==S.KEY&&event.key!==null)return;state.hidden=H.read(localStorage);state.selection=S.read(localStorage);restorePending=null;resetScope();load();});
  for(const name of ['pointerdown','keydown'])document.addEventListener(name,()=>{if(!applyingSnapshot)remember();},true);
  document.addEventListener('wheel',()=>{if(Date.now()-lastWheel>300)remember();lastWheel=Date.now();scheduleSession();},{capture:true,passive:true});
  for(const name of ['click','change','pointerup'])document.addEventListener(name,()=>scheduleSession(true));
  for(const name of ['input','keyup'])document.addEventListener(name,()=>scheduleSession());
  const interval=setInterval(()=>{if($('auto').checked&&!document.hidden)load(true);},30000);
  window.addEventListener('beforeunload',()=>{if(sessionDirty)saveSession();state.destroyed=true;state.loadController?.abort();state.previewController?.abort();clearInterval(interval);clearTimeout(sessionTimer);clearTimeout(historyTimer);clearTimeout(refreshTimer);clearTimeout(searchTimer);clearTimeout(resizeTimer);});
  async function start(){
    if(window.parent!==window){
      const initial=await new Promise(resolve=>{const timer=setTimeout(()=>{window.removeEventListener('message',handler);resolve(null);},1500);const handler=event=>{if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='personal-atlas-backup-initial')return;clearTimeout(timer);window.removeEventListener('message',handler);resolve(event.data.settings);};window.addEventListener('message',handler);window.parent.postMessage({type:'personal-atlas-ready'},location.origin);});
      if(initial&&!W.hasLocal(localStorage)){try{workspaceLibrary=W.restore(localStorage,initial);state.selection=S.read(localStorage);state.hidden=H.read(localStorage);restorePending=W.current(localStorage);}catch(error){workspaceError('工作空间备份未能恢复：'+error.message);}}
    }
    await load();if(state.root)notifyBackup();
  }
  start();
})();
