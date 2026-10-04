const assert = require('node:assert/strict');
const SP = require('../casks/sharepoint_client.js');
const D = require('../casks/master_data.js');
const config = {tenantId:'11111111-1111-1111-1111-111111111111',clientId:'22222222-2222-2222-2222-222222222222',
  siteUrl:'https://sample.sharepoint.com/sites/invoices',addressList:'宛先',vendorList:'業者',adminObjectIds:[]};
function fixture() {
  const calls = [], state = {failure:null, empty:false, missing:false, schemaBad:false, saved:false, refreshFailure:false};
  const item = {id:'42',eTag:'"version-1"',fields:{Title:'登録済み',Line1:'住所',Active:true},
    createdBy:{user:{id:'u1',displayName:'本人'}},lastModifiedBy:{user:{id:'u1',displayName:'本人'}},
    createdDateTime:'2026-10-01T00:00:00Z',lastModifiedDateTime:'2026-10-04T00:00:00Z'};
  const columns = ['Title','Line1','Line2','Line3','Line4','Line5','MatchName'].map(name=>({name,text:{}})).concat([{name:'Active',boolean:{}}]);
  async function request(method,path,body,etag) {
    calls.push({method,path,body,etag});
    if(method!=='GET') {
      if(state.failure) throw state.failure;
      state.saved = true; item.fields = method==='POST' ? body.fields : body; item.eTag='"version-2"';
      return method==='POST' ? {id:item.id} : item.fields;
    }
    if(path.startsWith('/sites/sample.sharepoint.com:')) return {id:'site-id'};
    if(path.endsWith('/lists?$select=id,displayName')) return {value:[{id:'list-a',displayName:'宛先'}],
      '@odata.nextLink':'https://graph.microsoft.com/v1.0/sites/site-id/lists?next=2'};
    if(path.endsWith('lists?next=2')) return {value:state.missing?[]:[{id:'list-v',displayName:'業者'}]};
    if(path.includes('/columns?')) return {value:state.schemaBad?columns.slice(1):columns};
    if(path.includes('/items?$expand')) return {value:state.empty?[]:[structuredClone(item)]};
    if(path.endsWith('/items/42?$expand=fields')) {
      if(state.refreshFailure) throw new Error('network unavailable');
      return structuredClone(item);
    }
    throw new Error('Unexpected request: '+path);
  }
  return {calls,state,item,store:SP.createStore(request,config,{id:'u1'})};
}
(async()=>{
  SP.validateConfig(config);
  for(const url of ['http://sample.sharepoint.com/sites/a','https://sample.sharepoint.com.evil.test/sites/a','https://user:secret@sample.sharepoint.com','https://sample.sharepoint.com/sites/a?x=1']) {
    assert.throws(()=>SP.validateConfig({...config,siteUrl:url}));
  }
  assert.throws(()=>SP.graphUrl('https://evil.test/steal'));
  assert.throws(()=>SP.graphUrl('//evil.test/steal'));
  const f=fixture(), loaded=await f.store.load();
  assert.equal(loaded.address[0].createdBy.id,'u1');
  assert.equal(loaded.vendor.length,1,'リストのページ送り');
  const fields=D.fields('address','新しい宛先','宛先\n住所\n電話','',true);
  fields.createdBy={user:{id:'spoof'}};
  const created=await f.store.save('address',fields,null);
  assert.equal(created.createdBy.name,'本人');
  const post=f.calls.find(c=>c.method==='POST');
  assert.equal(post.path,'/sites/site-id/lists/list-a/items');
  assert(!('createdBy' in post.body.fields),'作成者はクライアントから設定しない');
  await f.store.save('address',fields,created);
  assert.equal(f.calls.find(c=>c.method==='PATCH').etag,'"version-2"','ETagを条件付き更新に渡す');
  assert.equal(f.calls.find(c=>c.method==='PATCH').path,'/sites/site-id/lists/list-a/items/42/fields');
  const before=f.calls.length;
  await assert.rejects(f.store.save('address',fields,{...created,createdBy:{id:'other'}}),e=>e.code==='403');
  await assert.rejects(f.store.save('address',fields,{...created,etag:''}),e=>e.code==='CONFLICT');
  assert.equal(f.calls.length,before,'権限/版が不正な書き込みは送らない');
  for(const code of [403,412,429]) {
    f.state.failure=SP.httpError(code);
    await assert.rejects(f.store.save('address',fields,created),e=>e.status===code);
  }
  f.state.failure=null; f.state.refreshFailure=true;
  await assert.rejects(f.store.save('address',fields,null),e=>e.committed && e.code==='SAVED_REFRESH');
  const empty=fixture(); empty.state.empty=true;
  assert.deepEqual(await empty.store.load(),{address:[],vendor:[]},'0件は接続成功');
  const missing=fixture(); missing.state.missing=true;
  await assert.rejects(missing.store.load(),e=>e.code==='404');
  const bad=fixture(); bad.state.schemaBad=true;
  await assert.rejects(bad.store.load(),e=>e.code==='SCHEMA');
  let captured, tokens=0;
  const request=SP.createRequest(async(url,options)=>{captured={url,options};return {ok:true,status:200,json:async()=>({ok:true})};},async()=>{tokens++;return 'test-token';});
  await request('PATCH','/sites/s/lists/l/items/1/fields',{Title:'a'},'"tag"');
  assert.equal(captured.options.headers['If-Match'],'"tag"');
  assert.equal(captured.options.headers.Authorization,'Bearer test-token');
  await assert.rejects(request('GET','https://graph.microsoft.com.evil.test/steal'),e=>e.code==='ENDPOINT');
  assert.equal(tokens,1,'別ホストへトークンを送らない');
  const denied=SP.createRequest(async()=>({ok:false,status:403}),async()=>'test-token');
  await assert.rejects(denied('GET','/me'),e=>e.status===403 && !e.uncertain);
  const offline=SP.createRequest(async()=>{throw new TypeError('offline');},async()=>'test-token');
  await assert.rejects(offline('POST','/sites/s/lists/l/items',{}),e=>e.uncertain && e.code==='NETWORK');
  await assert.rejects(offline('GET','/me'),e=>!e.uncertain);
  console.log('SharePoint取得/ページ送り・本人登録・条件付き更新・403/404/412/429・保存結果不明・トークン送信先: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
