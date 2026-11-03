(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasReferences=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const valid=id=>typeof id==='string'&&/^\d{14}-[a-z0-9]{7}$/.test(id);
  const PAGE_SIZE=64,MAX_PAIRS=10000;
  function query(books,cursor){
    if(!Array.isArray(books)||!books.length||books.some(id=>!valid(id)))throw new Error('双链查询需要明确的笔记本范围');
    const scope=[...new Set(books)].sort().map(id=>"'"+id+"'").join(',');
    let after='';
    if(cursor){
      if(!valid(cursor.source)||!valid(cursor.target))throw new Error('双链分页位置无效');
      after=` AND (r.root_id>'${cursor.source}' OR (r.root_id='${cursor.source}' AND t.root_id>'${cursor.target}'))`;
    }
    return `SELECT r.root_id AS source_id,t.root_id AS target_id,COUNT(*) AS count FROM refs r JOIN blocks s ON s.id=r.root_id JOIN blocks t ON t.id=r.def_block_id WHERE r.box IN (${scope}) AND s.box IN (${scope}) AND t.box IN (${scope}) AND r.root_id<>t.root_id${after} GROUP BY r.root_id,t.root_id ORDER BY source_id,target_id LIMIT ${PAGE_SIZE}`;
  }
  async function read(books,map,request){
    if(!books.length)return {edges:[],limited:false};
    const rows=[];let cursor=null,limited=false;
    while(true){
      const page=await request(query(books,cursor),{books,cursor});
      if(!Array.isArray(page))throw new Error('双链数据格式不正确');
      if(!page.length)break;
      const last=page[page.length-1],next={source:last.source_id,target:last.target_id};
      if(!valid(next.source)||!valid(next.target))throw new Error('双链分页位置无效');
      if(cursor&&(next.source<cursor.source||(next.source===cursor.source&&next.target<=cursor.target)))throw new Error('双链分页未前进');
      rows.push(...page);cursor=next;
      if(page.length<PAGE_SIZE)break;
      if(rows.length>=MAX_PAIRS){limited=true;break;}
    }
    return {edges:normalize(rows,map,books),limited};
  }
  function normalize(rows,map,books){
    const allowed=new Set(books),pairs=new Map();
    for(const row of rows){
      const source=map.get(row.source_id),target=map.get(row.target_id);
      if(!source||!target||source.kind!=='document'||target.kind!=='document'||source.id===target.id)continue;
      if(!allowed.has(source.notebookId)||!allowed.has(target.notebookId))continue;
      const key=source.id+'>'+target.id;
      const previous=pairs.get(key);
      const count=Math.max(1,Number.isFinite(Number(row.count))?Math.floor(Number(row.count)):1);
      if(previous)previous.count+=count;else pairs.set(key,{source:source.id,target:target.id,count});
    }
    return [...pairs.values()].sort((a,b)=>a.source.localeCompare(b.source)||a.target.localeCompare(b.target));
  }
  function forNote(edges,id){return {outgoing:edges.filter(e=>e.source===id),incoming:edges.filter(e=>e.target===id)};}
  function visible(edges,nodes,{selectedOnly=false,selectedId=null,limit=600}={}){
    const ids=new Set(nodes.map(n=>n.id));
    const candidates=edges.filter(e=>ids.has(e.source)&&ids.has(e.target)&&(!selectedOnly||e.source===selectedId||e.target===selectedId));
    candidates.sort((a,b)=>Number(b.source===selectedId||b.target===selectedId)-Number(a.source===selectedId||a.target===selectedId)||a.source.localeCompare(b.source)||a.target.localeCompare(b.target));
    return {edges:candidates.slice(0,limit),total:candidates.length};
  }
  function path(a,b,mutual=false){
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(length<.01)return '';
    const margin=Math.min(20,length*.2),start={x:a.x+dx/length*margin,y:a.y+dy/length*margin},end={x:b.x-dx/length*margin,y:b.y-dy/length*margin};
    // Reverse directions use opposite curves, making two-way references legible.
    const bend=mutual?Math.min(45,length*.15):Math.min(32,length*.08);
    return `M${start.x},${start.y}Q${(start.x+end.x)/2-dy/length*bend},${(start.y+end.y)/2+dx/length*bend} ${end.x},${end.y}`;
  }
  return {PAGE_SIZE,MAX_PAIRS,query,read,normalize,forNote,visible,path};
});
