(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasVisibility=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEY='personal-atlas-hidden';
  const valid=id=>typeof id==='string'&&/^\d{14}-[a-z0-9]{7}$/.test(id);
  const normalize=ids=>Array.isArray(ids)?[...new Set(ids.filter(valid))]:[];
  function read(storage){try{return new Set(normalize(JSON.parse(storage.getItem(KEY)||'[]')));}catch{return new Set();}}
  function write(storage,ids){const values=normalize([...ids]);storage.setItem(KEY,JSON.stringify(values));return new Set(values);}
  function covered(node,hidden){for(let n=node;n;n=n.parent)if(n.kind==='document'&&hidden.has(n.id))return true;return false;}
  function project(root,hidden){
    function copy(node){
      if(node.kind==='document'&&hidden.has(node.id))return null;
      const result={};for(const [key,value]of Object.entries(node))if(!['parent','children'].includes(key))result[key]=value;
      result.children=node.children.map(copy).filter(Boolean);return result;
    }
    return copy(root);
  }
  function nearest(node,map){for(let n=node;n;n=n.parent)if(map.has(n.id))return map.get(n.id);return null;}
  const references=(edges,map)=>edges.filter(e=>map.has(e.source)&&map.has(e.target));
  return {KEY,normalize,read,write,covered,project,nearest,references};
});
