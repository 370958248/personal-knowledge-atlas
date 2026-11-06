'use strict';
window.AtlasScopePicker = function createScopePicker({state, readCatalog, readChildren, apply}) {
  const S=window.AtlasSelection, H=window.AtlasVisibility, W=window.AtlasWorkspace;
  const $=id=>document.getElementById(id);
  const dialog=$('notebook-dialog');
  let draft=null, revision=0;
  const element=(tag,cls,text)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=text;
    return node;
  };
  function close() {
    revision++;
    draft?.controller.abort();
    draft=null;
    if(dialog.open)dialog.close();
  }
  function error(message) {
    $('notebook-selection-error').hidden=false;
    $('notebook-selection-error').textContent=message;
  }
  function covered(node) { return H.covered(node,draft.hidden); }
  function render() {
    if(!draft)return;
    const list=$('notebook-list'), scroll=list.scrollTop;
    list.replaceChildren();
    const search=$('scope-search').value.trim().toLocaleLowerCase();
    const hiddenOnly=$('scope-hidden-only').checked;
    let matchCount=0;
    function row(node,depth,flat=false) {
      const book=node.kind==='notebook';
      const hasChildren=book || node.childCount>0 || node.children.length>0;
      const selected=draft.books.has(node.notebookId);
      const available=S.available(draft.catalog.find(b=>b.id===node.notebookId)||{closed:true});
      const line=element('div','scope-row');
      line.style.paddingLeft=(Math.min(depth,8)*17+4)+'px';
      const toggle=element('button','scope-toggle',draft.expanded.has(node.id)?'▾':'▸');
      toggle.type='button';
      toggle.setAttribute('aria-label',(draft.expanded.has(node.id)?'收起 ':'展开 ')+node.title);
      toggle.setAttribute('aria-expanded',String(draft.expanded.has(node.id)));
      toggle.disabled=!hasChildren||!selected||!available||flat;
      if(!hasChildren||flat)toggle.style.visibility='hidden';
      toggle.onclick=()=>expand(node);
      const check=element('input');
      check.type='checkbox';check.value=node.id;
      check.dataset.scopeKind=book?'book':'hidden';
      check.setAttribute('aria-label',(book?'展示笔记本 ':'隐藏 ')+node.title);
      check.checked=book?selected:covered(node);
      check.disabled=book?!available:!selected||!available||covered(node.parent);
      const title=element('label','scope-label');
      const text=element('span','scope-text');
      text.append(element('strong','',node.title));
      const path=[];
      for(let p=node.parent;p;p=p.parent)path.unshift(p.title);
      const description=book?(available?'勾选展示 · 展开后选择要隐藏的目录': '请先在思源中打开或解锁'):
        (flat?path.join(' / ')+' · ':'')+(covered(node.parent)?'随上级隐藏':check.checked?'已隐藏，含全部下级':hasChildren?'隐藏此目录及下级':'隐藏此笔记');
      text.append(element('small','',description));
      title.append(check,text);
      line.append(toggle,title);list.append(line);matchCount++;
      check.onchange=()=>{
        if(book) {
          check.checked?draft.books.add(node.id):draft.books.delete(node.id);
          if(!check.checked)draft.expanded.delete(node.id);
        }else check.checked?draft.hidden.add(node.id):draft.hidden.delete(node.id);
        render();
      };
      if(!flat&&hasChildren&&draft.expanded.has(node.id)&&selected) {
        if(draft.loading.has(node.id))list.append(element('p','scope-loading','正在读取目录…'));
        const children=node.children;
        const count=draft.limits.get(node.id)||100;
        for(const child of children.slice(0,count))row(child,depth+1);
        if(children.length>count) {
          const more=element('button','text-button scope-more','再显示 100 项');
          more.onclick=()=>{draft.limits.set(node.id,count+100);render();};
          list.append(more);
        }
        if(draft.loaded.has(node.id)&&!children.length)list.append(element('p','scope-loading','此处没有下级笔记。'));
      }
    }
    if(search||hiddenOnly) {
      const matches=[...draft.nodes.values()].filter(n=>n.kind==='document'&&draft.books.has(n.notebookId))
        .filter(n=>(!hiddenOnly||covered(n))&&(!search||[n.title,...ancestors(n)].join(' / ').toLocaleLowerCase().includes(search)));
      for(const node of matches.slice(0,draft.searchLimit))row(node,0,true);
      if(matches.length>draft.searchLimit) {
        const more=element('button','text-button scope-more','再显示 100 项');
        more.onclick=()=>{draft.searchLimit+=100;render();};list.append(more);
      }
      if(!matchCount)list.append(element('p','preview-placeholder','已载入的目录中没有匹配项。可先展开笔记本载入目录。'));
    }else for(const book of draft.catalog)row(draft.nodes.get(book.id),0);
    $('notebook-selection-count').textContent='已选 '+draft.books.size+' 个笔记本 · 隐藏规则 '+draft.hidden.size+' 项';
    list.scrollTop=scroll;
  }
  function ancestors(node) {
    const names=[];
    for(let p=node.parent;p;p=p.parent)names.unshift(p.title);
    return names;
  }
  async function expand(node) {
    const current=draft;
    if(!current)return;
    if(current.expanded.has(node.id)){current.expanded.delete(node.id);render();return;}
    current.expanded.add(node.id);
    if(current.loaded.has(node.id)){render();return;}
    if(current.loading.has(node.id)){render();return;}
    current.loading.add(node.id);render();
    try {
      const result=await readChildren(node,current);
      if(draft!==current||current.controller.signal.aborted||!current.books.has(node.notebookId))return;
      if(result.box&&result.box!==node.notebookId||!Array.isArray(result.files))throw Error('目录返回范围不符');
      const children=[];
      for(const file of result.files) {
        if(!S.valid(file.id)||!/^\/(?:\d{14}-[a-z0-9]{7}\/)*\d{14}-[a-z0-9]{7}\.sy$/.test(file.path))continue;
        const child={id:file.id,title:file.name||'未命名',notebookId:node.notebookId,path:file.path,
          childCount:Number(file.subFileCount||0),childrenLoaded:!Number(file.subFileCount||0),children:[],parent:node,kind:'document'};
        current.nodes.set(child.id,child);children.push(child);
      }
      node.children=children;node.childrenLoaded=true;current.loaded.add(node.id);
    } catch(e) {
      if(draft===current&&!current.controller.signal.aborted){current.expanded.delete(node.id);error(e.message);}
    } finally {
      current.loading.delete(node.id);
      if(draft===current)render();
    }
  }
  async function open(hidden) {
    close();
    const token=revision;
    const controller=new AbortController();
    const current={controller,books:new Set(S.read(localStorage)),hidden:new Set(hidden||H.read(localStorage)),
      expanded:new Set(),loaded:new Set(),loading:new Set(),limits:new Map(),nodes:new Map(),catalog:[],searchLimit:100,
      baseBooks:localStorage.getItem(S.KEY),baseHidden:localStorage.getItem(H.KEY)};
    draft=current;
    $('scope-search').value='';$('scope-hidden-only').checked=false;
    $('notebook-selection-error').hidden=true;$('notebook-apply').disabled=true;
    $('notebook-list').replaceChildren(element('p','preview-placeholder','正在读取笔记本…'));
    dialog.showModal();
    try {
      const result=await readCatalog(controller.signal);
      if(draft!==current||revision!==token)return;
      if(!Array.isArray(result.notebooks))throw Error('无法读取笔记本');
      current.catalog=result.notebooks.filter(b=>S.valid(b.id));
      function copy(raw,parent) {
        const n={...raw,parent,children:[]};
        current.nodes.set(n.id,n);if(raw.childrenLoaded!==false)current.loaded.add(n.id);
        n.children=raw.children.map(child=>copy(child,n));return n;
      }
      for(const b of current.catalog) {
        const raw=state.rawMap.get(b.id);
        if(raw)copy(raw,null);
        else current.nodes.set(b.id,{id:b.id,notebookId:b.id,title:b.name||'未命名笔记本',path:'/',kind:'notebook',children:[]});
      }
      render();$('notebook-apply').disabled=false;
    }catch(e){if(draft===current&&!controller.signal.aborted)error(e.message);}
  }
  $('scope-search').oninput=()=>{if(draft){draft.searchLimit=100;render();}};
  $('scope-hidden-only').onchange=render;
  $('scope-collapse').onclick=()=>{if(draft){draft.expanded.clear();render();}};
  $('scope-restore').onclick=()=>{
    if(!draft)return;
    for(const n of draft.nodes.values())if(n.kind==='document'&&draft.books.has(n.notebookId))draft.hidden.delete(n.id);
    render();
  };
  for(const id of ['notebook-close','notebook-cancel'])$(id).onclick=close;
  dialog.addEventListener('cancel',()=>close());
  $('notebook-clear').onclick=()=>{if(draft){draft.books.clear();draft.expanded.clear();render();}};
  $('notebook-apply').onclick=()=>{
    if(!draft)return;
    try{
      if(localStorage.getItem(S.KEY)!==draft.baseBooks||localStorage.getItem(H.KEY)!==draft.baseHidden)throw Error('范围或隐藏设置已在其他窗口更新，请重新打开此窗口。');
      const next={...W.current(localStorage),selection:[...draft.books],hidden:[...draft.hidden]};
      W.restore(localStorage,W.envelope(next,W.read(localStorage)));
      close();apply();
    }catch(e){error(e.message);}
  };
  return {open,close,isDraft:current=>current===draft&&dialog.open,allows:(node,current)=>current===draft&&dialog.open&&current.books.has(node.notebookId)&&S.available(current.catalog.find(b=>b.id===node.notebookId)||{closed:true})};
};
