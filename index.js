'use strict';
const { Plugin, openTab, showMessage } = require('siyuan');
function selectedBooks() {
  try {
    const raw=localStorage.getItem('personal-atlas-notebooks');
    const value=raw===null?[]:JSON.parse(raw);
    return new Set(Array.isArray(value)?value.filter(id=>typeof id==='string'&&/^\d{14}-[a-z0-9]{7}$/.test(id)):[]);
  } catch { return new Set(); }
}
const TYPE = 'atlas';
module.exports = class KnowledgeAtlas extends Plugin {
  async onload() {
    const plugin = this;
    this.views = new Set();
    this.restoreCandidate=null;this.backupChain=Promise.resolve();
    if(typeof this.loadData==='function'){try{this.restoreCandidate=await this.loadData('atlas-settings.json');}catch{this.restoreCandidate=null;}}
    this.addIcons('<symbol id="iconPersonalAtlas" viewBox="0 0 32 32"><path d="M16 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM6 21a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm20 0a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM15 12h2v4l9 4-1 2-9-4-9 4-1-2 9-4Z"/></symbol>');
    this.addTab({
      type: TYPE,
      init() {
        const frame = document.createElement('iframe');
        frame.src = '/plugins/' + plugin.name + '/atlas.html?v=0.8.4';
        frame.title = '图谱';
        frame.style.cssText = 'border:0;width:100%;height:100%;display:block;min-height:300px;background:#f5f7fb';
        this.element.style.cssText = 'height:100%;overflow:hidden';
        this.element.replaceChildren(frame);
        this.atlasFrame = frame;
        this.atlasHandler = async event => {
          if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
          if(event.data?.type==='personal-atlas-ready'){
            const hasLocal=['personal-atlas-notebooks','personal-atlas-hidden','personal-atlas-preferences','personal-atlas-workspace'].some(key=>localStorage.getItem(key)!==null);
            frame.contentWindow.postMessage({type:'personal-atlas-backup-initial',settings:hasLocal?null:plugin.restoreCandidate},location.origin);return;
          }
          if(event.data?.type==='personal-atlas-settings-changed'){
            const data=event.data.settings;
            if(!data||data.format!=='personal-atlas-settings'||data.version!==1||!data.current||!Array.isArray(data.profiles))return;
            let text;try{text=JSON.stringify(data);}catch{return;}if(text.length>4*1024*1024)return;
            plugin.pendingBackup={settings:JSON.parse(text),frame};clearTimeout(plugin.backupTimer);plugin.backupTimer=setTimeout(()=>plugin.flushBackup(),400);return;
          }
          if (event.data?.type !== 'personal-atlas-open') return;
          const id = event.data.id;
          if (!/^\d{14}-[a-z0-9]{7}$/.test(id || '')) return;
          try {
            const result = await fetch('/api/block/getBlockInfo', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({id}) }).then(r => r.json());
            if (result.code !== 0 || !selectedBooks().has(result.data?.box) || result.data.rootID !== (event.data.rootID || id)) throw new Error('此笔记不在当前选择的笔记本中');
            openTab({ app: plugin.app, doc: {id}, position: 'right', keepCursor: false });
          } catch (error) { showMessage('打开笔记失败：' + error.message, 5000, 'error'); }
        };
        window.addEventListener('message', this.atlasHandler);
        plugin.views.add(this);
      },
      destroy() {
        window.removeEventListener('message', this.atlasHandler);
        this.atlasFrame?.remove();
        plugin.views.delete(this);
      }
    });
    this.refreshHandler = event => {
      if (['transactions', 'rename', 'moveDoc', 'removeDoc', 'createDoc', 'reloadFiletree', 'refreshFiletree'].includes(event.detail?.cmd)) {
        for (const view of this.views) view.atlasFrame?.contentWindow?.postMessage({type:'personal-atlas-refresh',command:event.detail.cmd}, location.origin);
      }
    };
    this.eventBus.on('ws-main', this.refreshHandler);
    this.addCommand({ langKey:'openPersonalAtlas', langText:'打开图谱', hotkey:'⌥⇧K', callback:() => this.openAtlas() });
  }
  onLayoutReady() {
    this.addTopBar({icon:'iconPersonalAtlas', title:'图谱', position:'right', callback:() => this.openAtlas()});
  }
  flushBackup(){
    const pending=this.pendingBackup;if(!pending)return;this.pendingBackup=null;
    this.backupChain=this.backupChain.catch(()=>{}).then(async()=>{let ok=false;try{if(typeof this.saveData==='function'){const result=await this.saveData('atlas-settings.json',pending.settings);ok=!(result&&typeof result.code==='number'&&result.code!==0);if(ok)this.restoreCandidate=pending.settings;}}catch{}try{pending.frame.contentWindow?.postMessage({type:'personal-atlas-backup-status',ok},location.origin);}catch{}});
  }
  openAtlas() {
    for (const view of this.views) {
      if (view.element?.isConnected && view.parent?.headElement) {
        view.parent.headElement.click();
        return;
      }
    }
    openTab({app:this.app, custom:{id:this.name + TYPE, icon:'iconPersonalAtlas', title:'图谱'}});
  }
  onunload() {
    clearTimeout(this.backupTimer);this.flushBackup();
    this.eventBus.off('ws-main', this.refreshHandler);
    for (const view of this.views) {
      window.removeEventListener('message', view.atlasHandler);
      view.atlasFrame?.remove();
    }
    this.views.clear();
  }
};
