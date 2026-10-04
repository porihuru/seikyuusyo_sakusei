/* DOMと通信を置換し、表示モード・保存フローの状態遷移を検証する。実通信は行わない。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const D = require('../casks/master_data.js');
const SP = require('../casks/sharepoint_client.js');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const source = fs.readFileSync(path.join(root,'casks/master_ui.js'),'utf8');
const next = () => new Promise(resolve=>setImmediate(resolve));
const config = {tenantId:'11111111-1111-1111-1111-111111111111',clientId:'22222222-2222-2222-2222-222222222222',
  siteUrl:'https://sample.sharepoint.com/sites/invoices',addressList:'宛先',vendorList:'業者',adminObjectIds:[]};
function record(id,owner) {
  return {id,title:'宛先'+id,lines:['宛先'+id,'住所','電話','',''],matchName:'',active:true,source:'sharepoint',etag:'"v1"',
    createdBy:{id:owner,name:owner},modifiedBy:{id:owner,name:owner},createdAt:'2026-10-01T00:00:00Z',modifiedAt:'2026-10-01T00:00:00Z'};
}
function setup(options={}) {
  const ids={}, requests=[], saves=[], connections=[], state={connectError:options.connectError,saveError:null,storageReads:0};
  class Element {
    constructor(tag) {this.tag=tag;this.children=[];this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.listeners={};this._text='';}
    set id(id){this._id=id;ids[id]=this;} get id(){return this._id;}
    set textContent(text){this._text=String(text);this.children=[];} get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    appendChild(child){child.parentNode=this;this.children.push(child);return child;}
    removeChild(child){this.children=this.children.filter(c=>c!==child);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(event,fn){this.listeners[event]=fn;}
    querySelector(selector){const m=selector.match(/label\[for="([^"]+)"\]/);return this.children.find(c=>c.tag==='label'&&c.htmlFor===m[1]);}
    focus(){}
  }
  for(const m of html.matchAll(/\bid="([^"]+)"/g)){const e=new Element('div');e.id=m[1];}
  const document={getElementById:id=>ids[id],createElement:tag=>new Element(tag)};
  const context={document,Promise,Date,URL,console,InvoiceMasterData:D,INVOICE_SHAREPOINT_CONFIG:options.live?config:{},
    // 旧版のブラウザ個別設定が残っていても、configファイル以外を参照しないことを検証する。
    localStorage:{getItem:()=>{state.storageReads++;return JSON.stringify({...config,siteUrl:'https://old.sharepoint.com/sites/old'});},setItem(){},removeItem(){}},confirm:()=>true,
    XMLHttpRequest:class {
      open(method,url){this.url=url;} overrideMimeType(){}
      send(){requests.push(this.url);Promise.resolve().then(()=>{this.status=200;this.responseText=fs.readFileSync(path.join(root,this.url),'utf8');this.onload();});}
    },
    InvoiceSharePoint:{validateConfig:SP.validateConfig,createClient:connectionConfig=>(connections.push(connectionConfig),{
      connect:async()=>{if(state.connectError)throw state.connectError;return {user:{id:'alice',name:'Alice',email:'alice@example.invalid'},
        records:{address:options.empty?[]:[record('1','alice'),record('2','bob')],vendor:[]}};},
      save:async(kind,fields,existing)=>{saves.push({kind,fields,existing});if(state.saveError)throw state.saveError;
        return {...record(existing?existing.id:'3','alice'),title:fields.Title,lines:[fields.Line1,fields.Line2,fields.Line3,fields.Line4,fields.Line5],etag:'"v2"'};}
    })}
  };
  vm.runInNewContext(source,context,{filename:'master_ui.js'});
  const buttons = id=>ids[id].children.filter(c=>c.tag==='button');
  const click=(id,label)=>{const button=buttons(id).find(b=>b.textContent===label);assert(button,'missing button '+label);assert(!button.disabled,'disabled '+label);button.onclick();};
  const input=(id,value)=>{ids[id].value=value;if(ids[id].oninput)ids[id].oninput();if(ids[id].listeners.input)ids[id].listeners.input();};
  const use=(id)=>{ids.addressSelect.value=id;ids.addressSelect.onchange();click('addressMaster','この宛先を使用');};
  function confirm(){const p=ids.addressEditor.children.find(c=>c.className==='master-review');assert(p);p.children.find(c=>c.tag==='button').onclick();}
  return {ids,requests,saves,connections,state,context,click,input,use,confirm,buttons};
}
(async()=>{
  const t=setup();await next();
  assert.match(t.ids.masterStatus.textContent,/テストCSV/);assert.equal(t.requests.length,2);
  assert.equal(t.state.storageReads,0,'config未設定時も過去の個別設定を読み込まない');
  assert.equal(t.connections.length,0,'過去の個別設定から接続しない');
  assert(t.buttons('addressEditor').every(b=>b.disabled));
  t.use('TEST-A001');assert.match(t.ids.toText.value,/第一会計隊/);assert.match(t.ids.addressProvenance.textContent,/佐藤/);
  t.input('toText','今回だけの宛先');assert.match(t.ids.addressProvenance.textContent,/編集あり/);
  t.ids.addressSelect.value='TEST-A002';t.ids.addressSelect.onchange();assert.equal(t.ids.toText.value,'今回だけの宛先','候補選択だけでは上書きしない');
  t.ids.masterTest.onclick();await next();assert.equal(t.ids.toText.value,'今回だけの宛先','テスト再読込で保持');
  t.context.invoiceMasterChanged('address');assert.match(t.ids.addressProvenance.textContent,/未選択/);assert.equal(t.ids.toText.value,'今回だけの宛先');
  const live=setup({live:true});await next();assert.match(live.ids.masterStatus.textContent,/接続済み/);
  assert.equal(live.connections[0],config,'configファイルの設定をそのまま接続に使用');
  assert.equal(live.state.storageReads,0,'ブラウザ個別設定による上書きなし');
  assert.match(live.ids.masterUser.textContent,/Alice/);
  live.use('2');assert(live.buttons('addressEditor').find(b=>b.textContent==='登録内容を更新').disabled);
  live.use('1');live.input('toText','修正後\n住所\n電話');
  live.click('addressEditor','登録内容を更新');assert.equal(live.saves.length,0,'確認前には書き込まない');
  live.confirm();await next();assert.equal(live.saves.length,1);assert.equal(live.saves[0].existing.etag,'"v1"');
  assert.match(live.ids.addressProvenance.textContent,/alice/);assert.equal(live.ids.addressSelect.value,'1');
  live.state.saveError=SP.httpError(412);live.input('toText','競合時の入力');
  live.click('addressEditor','登録内容を更新');live.confirm();await next();
  assert.equal(live.ids.toText.value,'競合時の入力');assert(live.buttons('addressEditor').find(b=>b.textContent==='登録内容を更新').disabled);
  live.ids.masterReload.onclick();await next();assert.equal(live.ids.toText.value,'競合時の入力');
  assert(live.buttons('addressEditor').find(b=>b.textContent==='登録内容を更新').disabled,'再読込だけでは古い版を新版にしない');
  live.use('1');live.state.saveError=Object.assign(new Error('保存結果不明'),{uncertain:true});
  live.click('addressEditor','SharePointに新規登録');live.confirm();await next();
  assert(live.buttons('addressEditor').every(b=>b.disabled),'保存結果不明なら再保存を止める');
  const missing=setup({live:true,connectError:SP.httpError(404)});await next();assert.match(missing.ids.masterStatus.textContent,/テストCSV/);
  const denied=setup({live:true,connectError:SP.httpError(403)});await next();assert.match(denied.ids.masterStatus.textContent,/権限/);assert.equal(denied.requests.length,0);
  const empty=setup({live:true,empty:true});await next();assert.match(empty.ids.masterStatus.textContent,/接続済み/);assert.equal(empty.requests.length,0);
  assert(!empty.buttons('addressEditor').find(b=>b.textContent==='SharePointに新規登録').disabled);
  console.log('マスタ画面: CSV切替・入力保持・登録者表示・本人/他人・保存確認・競合・保存結果不明・403/404/0件: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
