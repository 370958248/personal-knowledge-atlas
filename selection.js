(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasSelection=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEY='personal-atlas-notebooks';
  const valid=id=>typeof id==='string'&&/^\d{14}-[a-z0-9]{7}$/.test(id);
  function normalize(ids){return Array.isArray(ids)?[...new Set(ids.filter(valid))]:[];}
  function read(storage){
    try{const raw=storage.getItem(KEY);return raw===null?[]:normalize(JSON.parse(raw));}catch{return [];}
  }
  function write(storage,ids){const selection=normalize(ids);storage.setItem(KEY,JSON.stringify(selection));return selection;}
  function available(book){return !book.closed&&(!book.encrypted||book.unlocked===true);}
  function selectedBooks(catalog,ids){const wanted=new Set(normalize(ids));return catalog.filter(book=>wanted.has(book.id)&&available(book));}
  return {KEY,valid,normalize,read,write,available,selectedBooks};
});
