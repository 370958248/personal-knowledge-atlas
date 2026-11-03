(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasWorkspace=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEY='personal-atlas-workspace',SELECTION='personal-atlas-notebooks',HIDDEN='personal-atlas-hidden',PREFERENCES='personal-atlas-preferences',FORMAT='personal-atlas-settings',MAX_BYTES=4*1024*1024;
  const keys=[SELECTION,HIDDEN,PREFERENCES,KEY];
  const valid=id=>typeof id==='string'&&/^\d{14}-[a-z0-9]{7}$/.test(id);
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  function ids(value,fallback=[],max=20000){if(value===undefined)return fallback.slice();if(!Array.isArray(value)||value.length>max||value.some(v=>!valid(v)))throw Error('设置中的笔记编号无效');return [...new Set(value)];}
  function choice(value,allowed,fallback){if(value===undefined)return fallback;if(!allowed.includes(value))throw Error('设置中的选项无效');return value;}
  function number(value,min,max,fallback){if(value===undefined)return fallback;if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('设置中的视野数值无效');return value;}
  function boolean(value,fallback){if(value===undefined)return fallback;if(typeof value!=='boolean')throw Error('设置中的开关无效');return value;}
  function nodeId(value){if(value===undefined||value===null)return null;if(value==='atlas-root'||valid(value))return value;throw Error('设置中的位置无效');}
  function snapshot(value={}){
    if(!object(value))throw Error('设置格式不正确');
    if(value.query!==undefined&&(typeof value.query!=='string'||value.query.length>200))throw Error('搜索文字过长');
    const camera=value.camera===undefined?{}:value.camera;if(!object(camera))throw Error('视野格式不正确');
    return {selection:ids(value.selection,[],200),hidden:ids(value.hidden),view:choice(value.view,['radial','grouped','sunburst'],'radial'),theme:choice(value.theme,['light','dark'],'light'),labelMode:choice(value.labelMode,['all','auto'],'all'),showReferences:boolean(value.showReferences,true),selectedReferences:boolean(value.selectedReferences,false),auto:boolean(value.auto,true),depth:choice(value.depth,[1,2,3,4,12],2),limit:choice(value.limit,[80,180,360,800],180),query:value.query||'',focusId:nodeId(value.focusId),selectedId:nodeId(value.selectedId),treeOpen:ids(value.treeOpen),collapsed:ids(value.collapsed),camera:{zoom:number(camera.zoom,.3,8,1),panX:number(camera.panX,-64,64,0),panY:number(camera.panY,-64,64,0)}};
  }
  function profiles(values=[]){
    if(!Array.isArray(values)||values.length>40)throw Error('最多保存 40 个常用视角');const seen=new Set();
    return values.map(p=>{if(!object(p)||typeof p.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(p.id)||seen.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>60||!object(p.snapshot))throw Error('常用视角格式不正确');seen.add(p.id);return {id:p.id,name:p.name.trim(),snapshot:snapshot(p.snapshot)};});
  }
  function library(value={}){if(!object(value))throw Error('设置库格式不正确');return {profiles:profiles(value.profiles),last:value.last==null?null:snapshot(value.last)};}
  function parseJSON(text){if(typeof text!=='string'||text.length>MAX_BYTES)throw Error('设置文件过大');return JSON.parse(text);}
  function read(storage){try{return library(parseJSON(storage.getItem(KEY)||'{}'));}catch{return {profiles:[],last:null};}}
  function legacy(storage,key,fallback){try{return JSON.parse(storage.getItem(key)||JSON.stringify(fallback));}catch{return fallback;}}
  function current(storage){
    const lib=read(storage),selection=storage.getItem(SELECTION)===null?[]:legacy(storage,SELECTION,[]),hidden=legacy(storage,HIDDEN,[]),prefs=legacy(storage,PREFERENCES,{});
    try{return snapshot({...lib.last,...(object(prefs)?prefs:{}),selection:Array.isArray(selection)?selection.filter(valid):[],hidden:Array.isArray(hidden)?hidden.filter(valid):[]});}catch{return snapshot({selection:[],hidden:[]});}
  }
  function size(value){const text=JSON.stringify(value);if(text.length>MAX_BYTES)throw Error('设置过大，请减少常用视角数量后重试');return text;}
  function save(storage,value){const clean=library(value);storage.setItem(KEY,size(clean));return clean;}
  function preferences(s){return {view:s.view,theme:s.theme,labelMode:s.labelMode,showReferences:s.showReferences,selectedReferences:s.selectedReferences};}
  function commit(storage,value,lib){
    const s=snapshot(value),clean=library({...lib,last:s}),before=keys.map(k=>[k,storage.getItem(k)]);
    const writes=[[SELECTION,JSON.stringify(s.selection)],[HIDDEN,JSON.stringify(s.hidden)],[PREFERENCES,JSON.stringify(preferences(s))],[KEY,size(clean)]];
    try{for(const [key,text]of writes)storage.setItem(key,text);}catch(error){
      let rolledBack=true;try{for(const [key]of before)storage.removeItem(key);for(const [key,text]of before)if(text!==null)storage.setItem(key,text);}catch{rolledBack=false;}
      throw Error(rolledBack?'无法保存设置，已保留原设置。':'设置写入失败，回退不完整；请保留备份文件并重新恢复。');
    }
    return clean;
  }
  function envelope(value,lib){return {format:FORMAT,version:1,createdAt:new Date().toISOString(),current:snapshot(value),profiles:profiles(lib.profiles)};}
  function parse(value){const data=typeof value==='string'?parseJSON(value):value;if(!object(data)||data.format!==FORMAT||data.version!==1||!object(data.current))throw Error('不是受支持的图谱设置备份');return {format:FORMAT,version:1,createdAt:typeof data.createdAt==='string'?data.createdAt:'',current:snapshot(data.current),profiles:profiles(data.profiles)};}
  function restore(storage,value){const data=parse(value);return commit(storage,data.current,{profiles:data.profiles,last:data.current});}
  function hasLocal(storage){return keys.some(key=>storage.getItem(key)!==null);}
  function history(limit=60){
    let entries=[],index=-1;
    return {push(value){const s=snapshot(value);if(index>=0&&JSON.stringify(entries[index])===JSON.stringify(s))return;entries=entries.slice(0,index+1);entries.push(s);if(entries.length>limit)entries.shift();index=entries.length-1;},replace(value){if(index>=0)entries[index]=snapshot(value);},move(delta){const next=index+delta;if(next<0||next>=entries.length)return null;index=next;return snapshot(entries[index]);},get canBack(){return index>0;},get canForward(){return index>=0&&index<entries.length-1;}};
  }
  return {KEY,SELECTION,HIDDEN,PREFERENCES,FORMAT,MAX_BYTES,snapshot,library,read,current,save,commit,envelope,parse,restore,hasLocal,history};
});
