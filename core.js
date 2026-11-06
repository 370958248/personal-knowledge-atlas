(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const COLORS = ['#4779bd','#3b9a82','#b18350','#8d75bb','#c06f74','#5c9ba8','#8a995a'];
  function indexTree(root) {
    const map = new Map();
    function visit(node, parent, depth, branch) {
      if (map.has(node.id)) throw new Error('重复的笔记编号：' + node.id);
      node.parent = parent; node.depth = depth;
      node.branch = branch; node.children ||= [];
      map.set(node.id, node);
      let descendants = 0,documentCount=0;
      node.children.forEach((child, i) => { visit(child, node, depth + 1, parent ? branch : i); descendants += child.descendants + 1;documentCount+=child.documentCount+(['notebook','collection'].includes(child.kind)?0:1); });
      node.descendants = descendants;
      node.documentCount=documentCount;
      return node;
    }
    visit(root, null, 0, 0);
    return map;
  }
  function ancestors(node) {
    const list = [];
    for (let p = node; p; p = p.parent) list.unshift(p);
    return list;
  }
  function visibleTree(root, {depth=2, limit=180, query='', collapsed=new Set(), selected=null}={}) {
    // Zero means all. Keep this distinct from the saved numeric display caps.
    depth=depth===0?Infinity:depth;limit=limit===0?Infinity:limit;
    const q = query.trim().toLocaleLowerCase();
    let allowed = null;
    if (q) {
      allowed = new Set([root.id]);
      (function walk(n) {
        if (!['notebook','collection'].includes(n.kind)&&n.title.toLocaleLowerCase().includes(q)) for (const p of ancestors(n)) allowed.add(p.id);
        n.children.forEach(walk);
      })(root);
    }
    const copy = (node, parent=null) => ({id:node.id, title:node.title, original:node, parent, children:[], depth:parent ? parent.depth+1 : 0, branch:node.branch, descendants:node.descendants,documentCount:node.documentCount});
    const view = copy(root), list=[view], queue=[view];
    const priority = new Set(selected ? ancestors(selected).map(n=>n.id) : []);
    for (let cursor=0;cursor<queue.length;cursor++) {
      const n = queue[cursor];
      if ((!q && n.depth >= depth) || collapsed.has(n.id)) continue;
      const children = n.original.children.filter(c=>!allowed || allowed.has(c.id));
      const ordered = children.slice().sort((a,b)=>Number(priority.has(b.id))-Number(priority.has(a.id)));
      for (const child of ordered) {
        if (list.length >= limit) break;
        const item=copy(child,n); n.children.push(item);list.push(item);queue.push(item);
      }
      n.hidden = children.length - n.children.length;
    }
    return {root:view, nodes:list};
  }
  function partition(node, start=-Math.PI/2, end=3*Math.PI/2) {
    node.start=start; node.end=end; node.angle=(start+end)/2;
    const weight=n=>n.children.length ? n.children.reduce((sum,c)=>sum+weight(c),0) : 1;
    const total=node.children.reduce((sum,n)=>sum+weight(n),0);
    let cursor=start;
    for (const child of node.children) {
      const next=cursor+(end-start)*weight(child)/total;
      partition(child,cursor,next);cursor=next;
    }
  }
  function radial(root) {
    partition(root);
    // Give primary sections equal angular space so a large imported folder
    // does not squeeze small first-level documents into overlapping labels.
    root.children.forEach((child,i)=>partition(child,-Math.PI/2+i*2*Math.PI/root.children.length,-Math.PI/2+(i+1)*2*Math.PI/root.children.length));
    const walk=n=>{const r=n.depth*155;n.x=n.depth?Math.cos(n.angle)*r:0;n.y=n.depth?Math.sin(n.angle)*r:0;n.centerX=0;n.centerY=0;n.children.forEach(walk);};
    walk(root);
  }
  function grouped(root) {
    root.x=0;root.y=0;root.angle=0;
    const count=root.children.length;
    root.children.forEach((branch,i)=>{
      const angle=-Math.PI/2+i*2*Math.PI/Math.max(1,count);
      const distance=count>1?360:200;
      branch.x=Math.cos(angle)*distance;branch.y=Math.sin(angle)*distance;branch.angle=angle;branch.centerX=0;branch.centerY=0;
      partition(branch,angle-Math.PI,angle+Math.PI);
      function walk(n,depth) {
        if(n!==branch){const r=depth*110;n.x=branch.x+Math.cos(n.angle)*r;n.y=branch.y+Math.sin(n.angle)*r;n.centerX=branch.x;n.centerY=branch.y;}
        n.children.forEach(c=>walk(c,depth+1));
      }
      walk(branch,0);
    });
  }
  function hierarchyCurve(parent,child) {
    const dx=child.x-parent.x,dy=child.y-parent.y,distance=Math.hypot(dx,dy);
    if(distance<1e-6)return `M${parent.x},${parent.y}L${child.x},${child.y}`;
    const ux=dx/distance,uy=dy/distance;
    // Leave each parent toward this child. Approach along the child's local
    // radial direction only when it agrees with that direction; never use
    // the global origin as a control point.
    let tx=child.x-(child.centerX??parent.x),ty=child.y-(child.centerY??parent.y);
    const length=Math.hypot(tx,ty);
    if(length>1e-6){tx/=length;ty/=length;}else{tx=ux;ty=uy;}
    if(tx*ux+ty*uy<.5){tx=ux;ty=uy;}
    const a=Math.min(parent.nodeRadius||0,distance*.2),b=Math.min(child.nodeRadius||0,distance*.2);
    const start={x:parent.x+ux*a,y:parent.y+uy*a},end={x:child.x-tx*b,y:child.y-ty*b};
    const handle=Math.max(0,distance-a-b)*.3;
    return `M${start.x},${start.y}C${start.x+ux*handle},${start.y+uy*handle} ${end.x-tx*handle},${end.y-ty*handle} ${end.x},${end.y}`;
  }
  function polar(r,a){return [Math.cos(a)*r,Math.sin(a)*r];}
  function arcPath(inner,outer,start,end) {
    const gap=Math.min(.012,(end-start)/10);start+=gap;end-=gap;
    if(end-start>=Math.PI*2-.001) end=start+Math.PI*2-.001;
    const a=polar(outer,start),b=polar(outer,end),c=polar(inner,end),d=polar(inner,start);
    const large=end-start>Math.PI?1:0;
    return `M${a}A${outer},${outer} 0 ${large} 1 ${b}L${c}A${inner},${inner} 0 ${large} 0 ${d}Z`;
  }
  function color(node){return COLORS[(node.original?.branch ?? node.branch ?? 0)%COLORS.length];}
  return {COLORS,indexTree,ancestors,visibleTree,partition,radial,grouped,hierarchyCurve,arcPath,color};
});
