'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../core.js'),W=require('../workspace.js');
const id=n=>'20000101'+String(n).padStart(6,'0')+'-testdoc';
const doc=n=>({id:id(n),title:'Note '+n,kind:'document',children:[]});

test('All nodes covers a large multi-notebook tree without spending the cap on containers',()=>{
 const root={id:'atlas-root',kind:'collection',title:'All',children:[1,2,3].map(n=>({id:id(n),kind:'notebook',title:'Book '+n,children:[]}))};
 for(let n=0;n<1205;n++)root.children[n%3].children.push(doc(n+10));
 C.indexTree(root);
 const capped=C.visibleTree(root,{depth:0,limit:800}),all=C.visibleTree(root,{depth:0,limit:0});
 assert.equal(capped.nodes.length,800);assert.equal(all.nodes.length,1209);
 assert.equal(all.nodes.filter(n=>n.original.kind==='document').length,1205);
 assert.equal(all.root.documentCount,1205);
});

test('All levels reaches notes deeper than the former 12-level ceiling',()=>{
 const root={id:id(1),kind:'notebook',title:'Book',children:[]};let parent=root;
 for(let n=2;n<33;n++){const child=doc(n);parent.children.push(child);parent=child;}
 C.indexTree(root);assert.equal(C.visibleTree(root,{depth:0,limit:0}).nodes.length,32);
 assert.equal(C.visibleTree(root,{depth:4,limit:0}).nodes.length,5);
});

test('All nodes still respects collapsed branches and title search',()=>{
 const root={id:id(1),kind:'notebook',title:'Book',children:[doc(2),doc(3)]};root.children[0].children.push(doc(4));C.indexTree(root);
 assert.equal(C.visibleTree(root,{depth:0,limit:0,collapsed:new Set([id(2)])}).nodes.length,3);
 assert.deepEqual(C.visibleTree(root,{depth:0,limit:0,query:'Note 4'}).nodes.map(n=>n.id),[id(1),id(2),id(4)]);
});

test('Unlimited choice survives settings export, restore and saved views; older caps stay valid',()=>{
 const map=new Map(),store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const current={selection:[id(1)],hidden:[id(2)],depth:12,limit:0};
 const value=W.envelope(current,{profiles:[{id:'all-notes',name:'All',snapshot:current}]});
 W.restore(store,W.parse(JSON.stringify(value)));assert.equal(W.current(store).limit,0);assert.equal(W.read(store).profiles[0].snapshot.limit,0);
 assert.equal(W.snapshot({limit:800}).limit,800);assert.throws(()=>W.snapshot({limit:-1}));
});

const points=d=>Array.from(d.matchAll(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi),m=>Number(m[0]));
function near(a,b){assert.equal(a.length,b.length);a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,`${i}: ${v} != ${b[i]}`));}

test('Every quadrant leaves the parent toward its own child with clipped endpoints',()=>{
 const parent={x:420,y:-310,nodeRadius:16};
 for(let i=0;i<16;i++){
  const a=i*Math.PI/8,child={x:parent.x+Math.cos(a)*180,y:parent.y+Math.sin(a)*180,centerX:parent.x,centerY:parent.y,nodeRadius:4};
  const p=points(C.hierarchyCurve(parent,child));assert.equal(p.length,8);
  const ux=Math.cos(a),uy=Math.sin(a),sx=p[2]-p[0],sy=p[3]-p[1];
  assert.ok(sx*ux+sy*uy>0);assert.ok(Math.abs(sx*uy-sy*ux)<1e-8);
  assert.ok(Math.abs(Math.hypot(p[0]-parent.x,p[1]-parent.y)-16)<1e-8);
  assert.ok(Math.abs(Math.hypot(p[6]-child.x,p[7]-child.y)-4)<1e-8);
 }
});

test('Curves follow a translated or rotated group instead of the global origin',()=>{
 const parent={x:380,y:260,nodeRadius:16},child={x:515,y:182,centerX:320,centerY:310,nodeRadius:4};
 const before=points(C.hierarchyCurve(parent,child));
 const translate=n=>({...n,x:n.x+1300,y:n.y-800,...('centerX' in n?{centerX:n.centerX+1300,centerY:n.centerY-800}:{})});
 near(points(C.hierarchyCurve(translate(parent),translate(child))),before.map((v,i)=>v+(i%2?-800:1300)));
 const angle=1.27,rot=(x,y)=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)];
 const rotate=n=>{const [x,y]=rot(n.x,n.y),[cx,cy]=rot(n.centerX??0,n.centerY??0);return {...n,x,y,...('centerX' in n?{centerX:cx,centerY:cy}:{})};};
 const rotated=[];for(let i=0;i<before.length;i+=2)rotated.push(...rot(before[i],before[i+1]));
 near(points(C.hierarchyCurve(rotate(parent),rotate(child))),rotated);
});

test('Radial and grouped layouts attach correct local centers, including single and coincident nodes',()=>{
 const root={id:id(1),title:'Book',kind:'notebook',children:[doc(2),doc(3)]};root.children[0].children.push(doc(4));C.indexTree(root);
 for(const layout of [C.radial,C.grouped]){
  const result=C.visibleTree(root,{depth:0,limit:0});layout(result.root);
  for(const n of result.nodes.filter(n=>n.parent)){assert.ok(Number.isFinite(n.centerX)&&Number.isFinite(n.centerY));assert.ok(points(C.hierarchyCurve(n.parent,n)).every(Number.isFinite));}
 }
 assert.equal(C.hierarchyCurve({x:1,y:2},{x:1,y:2}),'M1,2L1,2');
});
