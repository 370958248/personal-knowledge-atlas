'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../loader.js'),C=require('../core.js'),H=require('../visibility.js'),R=require('../references.js');
const id=n=>'20000101'+String(n).padStart(6,'0')+'-testdoc',book=id(1),other=id(2);
const file=(n,count=0,parent='')=>({id:id(n),name:'Note '+n,path:parent+'/'+id(n)+'.sy',subFileCount:count});
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('Load only chosen notebooks and stop before a hidden subtree, even when it is large',async()=>{
 const hidden=file(10,5000),shown=file(11,1),leaf=file(12,0,'/'+id(11));const calls=[];
 const root=await L.read([{id:book,name:'Chosen'}],{hidden:new Set([hidden.id]),request:async parent=>{
  calls.push(parent.path);assert.equal(parent.notebookId,book);
  if(parent.path==='/')return {box:book,files:[hidden,shown]};
  assert.equal(parent.id,shown.id);return {box:book,files:[leaf]};
 }});
 assert.deepEqual(calls,['/',shown.path]);C.indexTree(root);
 assert.equal(root.children[0].childrenLoaded,false);assert.equal(root.children[0].children.length,0);
 const visible=H.project(root,new Set([hidden.id]));C.indexTree(visible);assert.equal(visible.documentCount,2);
});

test('Removing a hidden rule loads the branch again',async()=>{
 const folder=file(10,1),leaf=file(11,0,'/'+id(10));let requests=0;
 const request=async n=>{requests++;return {box:book,files:n.path==='/'?[folder]:[leaf]};};
 await L.read([{id:book}],{hidden:new Set([folder.id]),request});assert.equal(requests,1);
 const root=await L.read([{id:book}],{request});assert.equal(requests,3);assert.equal(root.children[0].children[0].id,leaf.id);
});

test('Sibling and notebook requests run concurrently under a fixed ceiling',async()=>{
 let active=0,peak=0;const requests=[];
 const root=await L.read([{id:book},{id:other}],{concurrency:4,request:async n=>{
  active++;peak=Math.max(peak,active);requests.push(n.id);await wait(5);active--;
  return {box:n.notebookId,files:n.path==='/'?Array.from({length:8},(_,i)=>file((n.notebookId===book?10:30)+i,1)):[file(n.notebookId===book?100+Number(n.id.slice(8,14)):200+Number(n.id.slice(8,14)),0,n.path.slice(0,-3))]};
 }});
 assert.equal(root.children.length,2);assert.ok(peak>1);assert.ok(peak<=4);assert.equal(requests.length,18);
});

test('An explicit empty selection never requests any directories',async()=>{
 const root=await L.read([],{request:()=>{throw Error('Unexpected request');}});assert.equal(root.children.length,0);
});

test('Abort promptly stops scheduling and publishing a previous scope',async()=>{
 const controller=new AbortController();let progress=0,requests=0;
 const task=L.read([{id:book}],{signal:controller.signal,onProgress:()=>progress++,request:async()=>{requests++;await wait(15);return {box:book,files:[file(10,1)]};}});
 controller.abort();await assert.rejects(task,{name:'AbortError'});await wait(20);assert.equal(progress,0);assert.equal(requests,1);
});

test('Wrong notebook responses and malformed paths fail closed',async()=>{
 await assert.rejects(L.read([{id:book}],{request:async()=>({box:other,files:[]})}),/不属于/);
 await assert.rejects(L.read([{id:book}],{request:async()=>({box:book,files:[{...file(10),path:'/../bad.sy'}]})}),/路径/);
});

test('Reference SQL excludes hidden roots and descendants for both directions, within chosen books',()=>{
 const hidden={box:book,path:'/'+id(10)+'.sy'},sql=R.query([book],null,[hidden]);
 for(const alias of ['s','t']){
  assert.ok(sql.includes(`${alias}.path='${hidden.path}'`));assert.ok(sql.includes(`${alias}.path LIKE '/${id(10)}/%'`));
 }
 assert.throws(()=>R.query([book],null,[{...hidden,box:other}]),/隐藏范围/);
 assert.throws(()=>R.query([book],null,[{...hidden,path:"/bad' OR 1=1"}]),/隐藏范围/);
});

test('No visible notes means no reference SQL at all',async()=>{
 const result=await R.read([book],new Map([[book,{id:book,kind:'notebook'}]]),()=>{throw Error('Unexpected SQL');});
 assert.deepEqual(result,{edges:[],limited:false});
});

test('Many hidden rules produce a balanced SQL expression',()=>{
 const sql=R.query([book],null,Array.from({length:1200},(_,i)=>({box:book,path:'/'+id(i+10)+'.sy'})));
 let depth=0,peak=0;for(const ch of sql){if(ch==='(')peak=Math.max(peak,++depth);else if(ch===')')depth--;}
 assert.equal(depth,0);assert.ok(peak<20);
});

test('Directory refresh uses stable modification time instead of changing relative-time text',async()=>{
 const request=hMtime=>async()=>({box:book,files:[{...file(10),mtime:42,hMtime}]});
 const a=await L.read([{id:book}],{request:request('刚刚')});
 const b=await L.read([{id:book}],{request:request('半分钟前')});
 assert.equal(a.children[0].updated,42);assert.equal(b.children[0].updated,42);
});
