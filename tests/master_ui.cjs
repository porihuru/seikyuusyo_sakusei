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
  const ids={}, requests=[], saves=[], connections=[], state={connectError:options.connectError,saveError:null,storageReads:0,connectModes:[]};
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
  ids.systemLogPanel.hidden=true;
  const document={getElementById:id=>ids[id],createElement:tag=>new Element(tag)};
  const cookieJar=options.cookieJar || {}, cookieWrites=[];
  Object.defineProperty(document,'cookie',{
    get(){if(options.cookieBlocked)throw new Error('Cookies blocked');return Object.keys(cookieJar).map(name=>name+'='+cookieJar[name]).join('; ');},
    set(value){
      if(options.cookieBlocked)throw new Error('Cookies blocked');
      cookieWrites.push(value);
      const pair=value.split(';')[0], split=pair.indexOf('=');cookieJar[pair.slice(0,split)]=pair.slice(split+1);
    }
  });
  const context={document,Promise,Date,URL,console,InvoiceMasterData:D,INVOICE_SHAREPOINT_CONFIG:options.live?config:{},
    location:{pathname:'/invoice/index.html',protocol:options.protocol || 'http:'},
    // 旧版のブラウザ個別設定が残っていても、configファイル以外を参照しないことを検証する。
    localStorage:{getItem:()=>{state.storageReads++;return JSON.stringify({...config,siteUrl:'https://old.sharepoint.com/sites/old'});},setItem(){},removeItem(){}},confirm:()=>true,
    XMLHttpRequest:class {
      open(method,url){this.url=url;} overrideMimeType(){}
      send(){requests.push(this.url);Promise.resolve().then(()=>{this.status=options.csvError?404:200;this.responseText=fs.readFileSync(path.join(root,this.url),'utf8');this.onload();});}
    },
    InvoiceSharePoint:{validateConfig:SP.validateConfig,createClient:connectionConfig=>(connections.push(connectionConfig),{
      connect:async interactive=>{state.connectModes.push(interactive);if(options.holdConnection)await new Promise(resolve=>{state.releaseConnection=resolve;});if(state.connectError)throw state.connectError;return {user:{id:'alice',name:'Alice',email:'alice@example.invalid'},
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
  return {ids,requests,saves,connections,state,context,click,input,use,confirm,buttons,cookieJar,cookieWrites};
}
(async()=>{
  const t=setup();await next();
  assert.match(t.ids.masterStatus.textContent,/テストCSV/);assert.equal(t.requests.length,2);
  assert.equal(t.state.storageReads,0,'config未設定時も過去の個別設定を読み込まない');
  assert.equal(t.connections.length,0,'過去の個別設定から接続しない');
  assert(t.ids.systemLogPanel.hidden,'ログは初期状態で閉じる');
  assert.match(t.ids.systemLogEntries.textContent,/接続先が未設定/);
  assert.match(t.ids.systemLogEntries.textContent,/宛先 2件・業者 2件/);
  assert.equal(t.ids.systemLogEntries.children.length,3);
  assert(!isNaN(Date.parse(t.ids.systemLogEntries.children[0].children[0].datetime)),'確認日時を記録');
  const initialLog=t.ids.systemLogEntries.textContent;
  t.ids.btnSystemLog.onclick();assert(!t.ids.systemLogPanel.hidden);assert.equal(t.ids.btnSystemLog['aria-expanded'],'true');
  t.ids.btnCloseSystemLog.onclick();assert(t.ids.systemLogPanel.hidden);assert.equal(t.ids.btnSystemLog['aria-expanded'],'false');
  t.ids.btnSystemLog.onclick();t.ids.systemLogPanel.listeners.keydown({key:'Escape',preventDefault(){}});assert(t.ids.systemLogPanel.hidden);
  assert.equal(t.requests.length,2,'ログの開閉でCSVを再取得しない');
  assert(t.buttons('addressEditor').every(b=>b.disabled));
  t.use('TEST-A001');assert.match(t.ids.toText.value,/第一会計隊/);assert.match(t.ids.addressProvenance.textContent,/佐藤/);
  t.input('toText','今回だけの宛先');assert.match(t.ids.addressProvenance.textContent,/編集あり/);
  t.ids.addressSelect.value='TEST-A002';t.ids.addressSelect.onchange();assert.equal(t.ids.toText.value,'今回だけの宛先','候補選択だけでは上書きしない');
  t.ids.masterTest.onclick();await next();assert.equal(t.ids.toText.value,'今回だけの宛先','テスト再読込で保持');
  assert.equal(t.ids.systemLogEntries.textContent,initialLog,'手動でテストCSVを読み込んでも起動ログを変更しない');
  t.context.invoiceMasterChanged('address');assert.match(t.ids.addressProvenance.textContent,/未選択/);assert.equal(t.ids.toText.value,'今回だけの宛先');
  const live=setup({live:true});await next();assert.match(live.ids.masterStatus.textContent,/接続済み/);
  assert.equal(live.ids.masterSignIn,undefined,'専用サインインボタンなし');
  assert.deepEqual(live.state.connectModes,[false],'起動時は対話認証なし');
  assert.equal(live.connections[0],config,'configファイルの設定をそのまま接続に使用');
  assert.equal(live.state.storageReads,0,'ブラウザ個別設定による上書きなし');
  assert.match(live.ids.masterUser.textContent,/Alice/);
  assert.match(live.ids.systemLogEntries.textContent,/SharePointに接続しました。宛先 2件・業者 0件/);
  const liveLog=live.ids.systemLogEntries.textContent;
  live.ids.btnSystemLog.onclick();live.ids.btnSystemLog.onclick();
  assert.deepEqual(live.state.connectModes,[false],'ログの開閉で再接続しない');
  live.use('2');assert(live.buttons('addressEditor').find(b=>b.textContent==='登録内容を更新').disabled);
  live.use('1');live.input('toText','修正後\n住所\n電話');
  live.click('addressEditor','登録内容を更新');assert.equal(live.saves.length,0,'確認前には書き込まない');
  live.confirm();await next();assert.equal(live.saves.length,1);assert.equal(live.saves[0].existing.etag,'"v1"');
  assert.match(live.ids.addressProvenance.textContent,/alice/);assert.equal(live.ids.addressSelect.value,'1');
  live.state.saveError=SP.httpError(412);live.input('toText','競合時の入力');
  live.click('addressEditor','登録内容を更新');live.confirm();await next();
  assert.equal(live.ids.toText.value,'競合時の入力');assert(live.buttons('addressEditor').find(b=>b.textContent==='登録内容を更新').disabled);
  live.ids.masterReload.onclick();await next();assert.equal(live.ids.toText.value,'競合時の入力');
  assert.deepEqual(live.state.connectModes,[false,true],'再読込の操作時は必要に応じて認証可能');
  assert.equal(live.ids.systemLogEntries.textContent,liveLog,'保存・手動再接続では起動ログを変更しない');
  assert(live.buttons('addressEditor').find(b=>b.textContent==='登録内容を更新').disabled,'再読込だけでは古い版を新版にしない');
  live.use('1');live.state.saveError=Object.assign(new Error('保存結果不明'),{uncertain:true});
  live.click('addressEditor','SharePointに新規登録');live.confirm();await next();
  assert(live.buttons('addressEditor').every(b=>b.disabled),'保存結果不明なら再保存を止める');
  const missing=setup({live:true,connectError:SP.httpError(404)});await next();assert.match(missing.ids.masterStatus.textContent,/テストCSV/);
  assert.match(missing.ids.systemLogEntries.textContent,/サイトまたはリストが見つかりません/);
  assert.match(missing.ids.systemLogEntries.textContent,/テストCSVへ切り替え/);
  const denied=setup({live:true,connectError:SP.httpError(403)});await next();assert.match(denied.ids.masterStatus.textContent,/権限/);assert.equal(denied.requests.length,0);
  assert.match(denied.ids.systemLogEntries.textContent,/アクセス権限がありません/);
  const csvFailed=setup({csvError:true});await next();assert.match(csvFailed.ids.systemLogEntries.textContent,/テストCSVを読み込めませんでした/);
  const signin=setup({live:true,connectError:D.error('SIGNIN','認証応答の秘密')});await next();
  assert.match(signin.ids.systemLogEntries.textContent,/認証が必要/);assert(!signin.ids.systemLogEntries.textContent.includes('秘密'));
  const network=setup({live:true,connectError:D.error('NETWORK','内部エラー')});await next();assert.match(network.ids.systemLogEntries.textContent,/通信できないかタイムアウト/);
  const waiting=setup({live:true,holdConnection:true});waiting.ids.btnSystemLog.onclick();
  assert.match(waiting.ids.systemLogEntries.textContent,/確認を開始/);assert.equal(waiting.ids.systemLogEntries.children.length,1);
  waiting.state.releaseConnection();await next();assert.match(waiting.ids.systemLogEntries.textContent,/接続しました/);
  assert.deepEqual(waiting.state.connectModes,[false],'確認中にログを開いても接続処理は1回だけ');
  const empty=setup({live:true,empty:true});await next();assert.match(empty.ids.masterStatus.textContent,/接続済み/);assert.equal(empty.requests.length,0);
  assert(!empty.buttons('addressEditor').find(b=>b.textContent==='SharePointに新規登録').disabled);
  const preferences=setup({protocol:'https:'});await next();
  assert.equal(preferences.ids.addressMine.disabled,false,'テスト表示中もチェック設定を変更できる');
  preferences.ids.addressMine.checked=true;preferences.ids.addressMine.onchange();
  assert.equal(preferences.ids.vendorMine.checked,false,'宛先と業者は独立');
  assert.match(preferences.cookieWrites[0],/Path=\/invoice\//);
  assert.match(preferences.cookieWrites[0],/Max-Age=31536000/);
  assert.match(preferences.cookieWrites[0],/SameSite=Lax; Secure/);
  const restored=setup({cookieJar:preferences.cookieJar});await next();
  assert.equal(restored.ids.addressMine.checked,true,'画面の再表示で復元');
  assert.equal(restored.ids.addressSelect.children.length,3,'テストCSVは本人の代用をせず全件表示');
  assert.match(restored.ids.addressMineHint.textContent,/SharePoint接続後/);
  const filtered=setup({live:true,cookieJar:preferences.cookieJar});await next();
  assert.equal(filtered.ids.addressMine.checked,true);
  assert.equal(filtered.ids.addressSelect.children.length,2,'接続時に本人の1件だけ表示');
  assert.equal(filtered.ids.addressSelect.children[1].value,'1');
  filtered.use('1');filtered.input('toText','保存しても設定保持');
  filtered.click('addressEditor','登録内容を更新');filtered.confirm();await next();
  assert.equal(filtered.ids.addressMine.checked,true,'共有情報の更新後もチェック状態を保持');
  filtered.ids.masterTest.onclick();await next();assert.equal(filtered.ids.addressMine.checked,true,'テスト切替で消さない');
  filtered.ids.masterReload.onclick();await next();assert.equal(filtered.ids.addressSelect.children.length,2,'再接続時に絞り込み復元');
  filtered.ids.vendorMine.checked=true;filtered.ids.vendorMine.onchange();
  filtered.ids.addressMine.checked=false;filtered.ids.addressMine.onchange();
  assert(!filtered.cookieWrites[0].includes('; Secure'),'HTTP開発環境でも保存可能');
  const unchecked=setup({live:true,cookieJar:preferences.cookieJar});await next();
  assert.equal(unchecked.ids.addressMine.checked,false,'チェック解除も保存');
  assert.equal(unchecked.ids.vendorMine.checked,true,'業者の設定は独立して復元');
  assert.equal(unchecked.ids.addressSelect.children.length,3,'チェック解除後は他の人の情報も表示');
  const blocked=setup({live:true,cookieBlocked:true});await next();
  blocked.ids.addressMine.checked=true;blocked.ids.addressMine.onchange();
  assert.equal(blocked.ids.addressSelect.children.length,2,'Cookieが使えなくても現在の画面は操作可能');
  console.log('Cookie: 宛先/業者別の保存と復元・解除・テスト切替・保存後保持・パス/HTTPS・Cookie制限時: OK');
  console.log('起動ログ: 開閉時の通信なし・日時・成功・認証/権限/通信失敗・CSV切替/失敗・起動時のみ記録: OK');
  console.log('マスタ画面: CSV切替・入力保持・登録者表示・本人/他人・保存確認・競合・保存結果不明・403/404/0件: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
