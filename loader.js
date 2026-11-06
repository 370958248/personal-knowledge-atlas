(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasLoader=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const valid=id=>typeof id==='string'&&/^\d{14}-[a-z0-9]{7}$/.test(id);
  const pathValid=path=>typeof path==='string'&&/^\/(?:\d{14}-[a-z0-9]{7}\/)*\d{14}-[a-z0-9]{7}\.sy$/.test(path);
  async function read(books,{hidden=new Set(),request,signal,onProgress=()=>{},concurrency=4}={}){
    if(!Array.isArray(books)||books.some(b=>!valid(b.id)))throw Error('笔记本范围不符');
    const roots=books.map(b=>({id:b.id,title:b.name||'未命名笔记本',notebookId:b.id,kind:'notebook',path:'/',children:[],childrenLoaded:false}));
    const root=roots.length===1?roots[0]:{id:'atlas-root',title:'我的知识图谱',kind:'collection',children:roots,childrenLoaded:true};
    const selected=new Set(books.map(b=>b.id)),hiddenIds=new Set(hidden),seen=new Set([root.id,...roots.map(n=>n.id)]);
    const queue=roots.slice();let cursor=0,active=0,finished=false,requests=0;
    const maximum=Number.isInteger(concurrency)?Math.max(1,Math.min(8,concurrency)):4;
    const abort=()=>{const error=new Error('目录读取已取消');error.name='AbortError';return error;};
    async function branch(parent){
      if(signal?.aborted)throw abort();
      if(!selected.has(parent.notebookId)||hiddenIds.has(parent.id))throw Error('目录不在展示范围');
      const result=await request(parent,signal);
      if(signal?.aborted)throw abort();
      if(result.box&&result.box!==parent.notebookId)throw Error('返回数据不属于所选笔记本');
      if(!Array.isArray(result.files))throw Error('文档目录格式不正确');
      for(const file of result.files){
        if(!valid(file.id)||seen.has(file.id))continue;
        if(!pathValid(file.path))throw Error('文档路径格式不正确');
        seen.add(file.id);
        const childCount=Math.max(0,Number(file.subFileCount)||0);
        parent.children.push({id:file.id,title:file.name||'未命名',notebookId:parent.notebookId,kind:'document',path:file.path,
          children:[],childrenLoaded:childCount===0,updated:file.mtime??file.hMtime??'',childCount});
      }
      if(parent.childCount&&parent.children.length<parent.childCount)throw Error('思源返回的目录不完整，请稍后刷新');
      parent.childrenLoaded=true;
      return parent.children.filter(n=>n.childCount>0&&!hiddenIds.has(n.id));
    }
    await new Promise((resolve,reject)=>{
      const finish=error=>{if(finished)return;finished=true;signal?.removeEventListener('abort',cancel);error?reject(error):resolve();};
      const cancel=()=>finish(abort());
      function pump(){
        if(finished)return;
        if(signal?.aborted){cancel();return;}
        while(active<maximum&&cursor<queue.length){
          const parent=queue[cursor++];active++;
          branch(parent).then(children=>{
            if(finished)return;
            queue.push(...children);requests++;onProgress({requests,documents:seen.size-roots.length-(root.kind==='collection'?1:0)});
          }).catch(finish).finally(()=>{active--;pump();});
        }
        if(!active&&cursor===queue.length)finish();
      }
      signal?.addEventListener('abort',cancel,{once:true});pump();
    });
    return root;
  }
  return {read};
});
