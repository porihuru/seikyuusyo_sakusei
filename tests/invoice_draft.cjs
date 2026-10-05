const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const D=require('../casks/invoice_draft.js');
const draft={format:'invoice-draft',version:1,billDate:'2026-10-05',toText:'宛先\n住所',vendorText:'業者\n口座',bulkSpecText:'規格表のとおり',printSettings:{first:18,later:25},rows:[{no:'1',name:'品名',spec:'規格\n2行目',unit:'個',qty:'2.5',price:'100',amount:'250',note:'*'}]};
const copy=v=>JSON.parse(JSON.stringify(v));
assert.equal(D.parse('\uFEFF'+JSON.stringify(draft)).rows[0].spec,draft.rows[0].spec);
for(const change of [v=>v.version=2,v=>v.rows=[],v=>v.billDate='2026-02-30',v=>v.rows[0].amount='NaN',v=>v.printSettings.first=0,v=>v.toText={},v=>v.rows[0].qty='1e309']){
 const d=copy(draft);change(d);assert.throws(()=>D.validate(d));
}
const hostile=copy(draft);hostile.rows[0].createdBy={id:'fake'};hostile.rows[0]._noticeSpec='old';
const clean=D.validate(hostile);assert(!clean.rows[0].createdBy);assert(!clean.rows[0]._noticeSpec);assert(clean.rows[0]._specManual);
const ids={};for(const id of ['btnSaveDraft','btnLoadDraft','invoiceDraftInput','billDate','toText','vendorText','bulkSpecText','printFirstRows','printLaterRows','copyMsg','pdfInput','pdfStatus'])ids[id]={value:'',click(){}};
for(const key of ['billDate','toText','vendorText','bulkSpecText'])ids[key].value=draft[key];
const state={confirm:true,alerts:[],renders:0,cancel:0,clear:0,masters:[],totals:0};
const ctx={Blob,document:{getElementById:id=>ids[id],createElement:()=>({click(){}}),body:{appendChild(){},removeChild(){}}},alert:m=>state.alerts.push(m),confirm:()=>state.confirm,validateInvoice:()=>true,currentRows:copy(draft.rows),InvoicePrint:{fileName:(v,d,e)=>{assert.equal(v,draft.vendorText);assert(e);return '請求書_編集用_業者.json';},readSettings:()=>draft.printSettings},navigator:{msSaveOrOpenBlob:b=>state.blob=b},FileReader:class{readAsText(file){this.result=file.text;this.onload();}},cancelPdfLoad:()=>state.cancel++,clearNoticePdf:()=>state.clear++,renderTable:rows=>{state.renders++;ctx.currentRows=rows;ids.vendorText.value='PDF由来の業者';},invoiceMasterChanged:k=>state.masters.push(k),recalcTotalsFromRows:()=>state.totals++};
vm.runInNewContext(fs.readFileSync(require.resolve('../casks/invoice_draft.js'),'utf8'),ctx);
function load(text){ids.invoiceDraftInput.files=[{size:text.length,text}];ids.invoiceDraftInput.onchange.call(ids.invoiceDraftInput);}
(async()=>{
 ids.btnSaveDraft.onclick();const saved=await state.blob.text();assert.equal(D.parse(saved).vendorText,draft.vendorText);
 load('{broken');assert.equal(state.renders,0);assert.equal(state.cancel,0);
 state.confirm=false;load(saved);assert.equal(state.renders,0);assert.equal(state.cancel,0);
 state.confirm=true;load(saved);assert.equal(state.renders,1);assert.equal(state.cancel,1);assert.equal(state.clear,1);
 assert.equal(ids.vendorText.value,draft.vendorText);assert.equal(ids.toText.value,draft.toText);assert.equal(ids.printFirstRows.value,18);
 assert.deepEqual(state.masters,['address','vendor']);assert.equal(state.totals,1);assert(ctx.currentRows[0]._specManual);
 ctx.currentRows[0].name='修正後';ctx.currentRows[0].qty='3';ctx.currentRows[0].amount='300';ids.btnSaveDraft.onclick();
 const changed=D.parse(await state.blob.text());assert.equal(changed.rows[0].name,'修正後');assert.equal(changed.rows[0].amount,'300');
 console.log('編集用保存: 往復復元・改行/金額/設定保持・再編集再保存・不正ファイル/取消は無変更・旧PDF停止・マスタ紐付け解除: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
