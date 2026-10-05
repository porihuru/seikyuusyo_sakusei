const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const SP = require('../casks/sharepoint_intranet.js');
const D = require('../casks/master_data.js');
const config = {mode:'intranet',siteUrl:'/sites/invoices',addressList:'宛先',vendorList:'業者',adminUserIds:['99']};
const page = 'https://intranet.example/sites/invoices/app/index.html';
const base = SP.siteUrl(config,page);
const columns = ['Title','Line1','Line2','Line3','Line4','Line5','MatchName','Active'].map(InternalName=>({InternalName,TypeAsString:InternalName==='Active'?'Boolean':'Text'}));
const item = {Id:42,Title:'宛先',Line1:'住所',Active:true,Author:{Id:7,Title:'本人',EMail:'a@example.invalid'},Editor:{Id:7,Title:'本人'},Created:'2026-10-01',Modified:'2026-10-05',__metadata:{etag:'"1"'}};
const calls = [], state = {};
async function request(method,path,body,headers) {
  calls.push({method,path,body,headers});
  if(path==='contextinfo') return {GetContextWebInformation:{FormDigestValue:'digest'}};
  if(method==='POST') { if(state.conflict) throw D.error('412','競合'); return {Id:42}; }
  if(path.includes('ListItemEntityTypeFullName')) return {Id:path.includes(encodeURIComponent('宛先'))?'a':'v',ListItemEntityTypeFullName:'SP.Data.MasterListItem'};
  if(path.includes('/fields?')) return {results:state.badSchema?[]:columns};
  if(path.includes('/items(42)')) {if(state.refreshFailure) throw Error('offline');return item;}
  if(path.includes('skiptoken')) return {results:[item]};
  if(path.includes('/items?')) return {results:state.empty?[]:[item],...(!state.empty?{__next:base+'/_api/web/lists/items?skiptoken=2'}:{})};
  throw Error('Unexpected '+path);
}
(async()=>{
  assert.equal(base,'https://intranet.example/sites/invoices');
  for(const url of ['https://other.example/sites/a','//other.example/sites/a','file:///tmp/index.html']) assert.throws(()=>SP.siteUrl({...config,siteUrl:url},page));
  for(const url of ['/sites/a/Lists/List/AllItems.aspx','/sites/a?x=1','https://user:pass@intranet.example/a']) assert.throws(()=>SP.siteUrl({...config,siteUrl:url},page));
  const store=SP.createStore(request,config,{id:'7'});
  const loaded=await store.load();assert.equal(loaded.address.length,2);assert.equal(loaded.address[0].createdBy.id,'7');
  const fields=D.fields('address','宛先','住所','',true);fields.AuthorId=99;
  const saved=await store.save('address',fields,null);assert.equal(saved.createdBy.id,'7');
  const post=calls.find(c=>c.method==='POST'&&c.body);
  assert.equal(post.headers['X-RequestDigest'],'digest');assert(!('AuthorId' in post.body));assert.equal(post.body.__metadata.type,'SP.Data.MasterListItem');
  await store.save('address',fields,saved);
  assert(calls.some(c=>c.headers&&c.headers['X-HTTP-Method']==='MERGE'&&c.headers['If-Match']==='"1"'));
  await assert.rejects(store.save('address',fields,{...saved,createdBy:{id:'8'}}),e=>e.code==='403');
  await assert.rejects(store.save('address',fields,{...saved,etag:''}),e=>e.code==='CONFLICT');
  state.conflict=true;await assert.rejects(store.save('address',fields,saved),e=>e.code==='412');state.conflict=false;
  state.refreshFailure=true;await assert.rejects(store.save('address',fields,null),e=>e.committed);state.refreshFailure=false;
  state.empty=true;assert.deepEqual(await store.load(),{address:[],vendor:[]});state.empty=false;
  state.badSchema=true;await assert.rejects(store.load(),e=>e.code==='SCHEMA');state.badSchema=false;
  const xhrs=[];let response={status:200,text:'{"d":{"results":[]}}'};
  const send=SP.createRequest(base,()=>{
    const xhr={headers:{},open(method,url){this.method=method;this.url=url;},setRequestHeader(k,v){this.headers[k]=v;},send(body){this.body=body;this.status=response.status;this.responseText=response.text; if(response.network)this.onerror();else this.onload();}};
    xhrs.push(xhr);return xhr;
  });
  await send('GET','web/currentuser');assert.equal(xhrs[0].url,base+'/_api/web/currentuser');assert(!xhrs[0].headers.Authorization);
  await assert.rejects(send('GET','https://other.example/_api/web'),e=>e.code==='ENDPOINT');
  await assert.rejects(send('GET',base+'/_api/../outside'),e=>e.code==='ENDPOINT');assert.equal(xhrs.length,1);
  response={status:412};await assert.rejects(send('POST','web/lists/items',{},{}),e=>e.status===412&&!e.uncertain);
  response={status:403};await assert.rejects(send('GET','web/currentuser'),e=>e.status===403);
  response={status:500};await assert.rejects(send('POST','web/lists/items',{},{}),e=>e.uncertain);
  response={network:true};await assert.rejects(send('POST','contextinfo'),e=>!e.uncertain);
  await assert.rejects(send('POST','web/lists/items',{},{}),e=>e.uncertain);
  response={status:200,text:'<html>login</html>'};await assert.rejects(send('GET','web/currentuser'),e=>e.code==='RESPONSE'&&!e.uncertain);
  response={status:204};assert.deepEqual(await send('POST','web/lists/items',{},{}),{});
  // 実際のブラウザ公開APIを通してイントラへ振り分け、MSAL/Graphを呼ばない。
  const sandbox={InvoiceMasterData:D,Promise,URL,location:{href:page},XMLHttpRequest:class{
    open(method,url){this.method=method;this.url=url;}setRequestHeader(){}
    send(){const path=this.url.split('/_api/')[1];Promise.resolve(path.startsWith('web/currentuser')?{Id:7,Title:'本人',Email:''}:request(this.method,path)).then(data=>{this.status=200;this.responseText=JSON.stringify({d:data});this.onload();});}
  }};
  for(const file of ['sharepoint_intranet.js','sharepoint_client.js']) vm.runInNewContext(fs.readFileSync(require.resolve('../casks/'+file),'utf8'),sandbox);
  const connected=await sandbox.InvoiceSharePoint.createClient(config).connect(false);assert.equal(connected.user.id,'7');assert.equal(connected.records.address.length,2);
  console.log('イントラREST: 同一接続元・本人取得・一覧/ページ送り・列検証・登録・digest/MERGE/ETag・競合・権限・保存結果不明・外部接続拒否・クライアント統合: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
