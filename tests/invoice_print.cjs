const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fields = {billDate:{value:'2026-10-05'},toText:{value:'宛先\n住所'},vendorText:{value:'業者'},printFirstRows:{value:'15'},printLaterRows:{value:'25'},btnResetPrintRows:{}};
const state={alerts:[],cookie:'',clicked:0,revoked:0};
const document={getElementById:id=>fields[id]||null,body:{appendChild(){},removeChild(){}},createElement:()=>({click(){state.clicked++;state.filename=this.download;}})};
Object.defineProperty(document,'cookie',{get:()=>state.cookie,set:v=>{state.cookie=v;}});
const sandbox={document,Blob,Date,alert:m=>state.alerts.push(m),navigator:{},URL:{createObjectURL:b=>{state.blob=b;return 'blob:test';},revokeObjectURL:()=>state.revoked++},setTimeout:fn=>fn(),open:()=>({document:{open(){},write:h=>state.print=h,close(){}},focus(){},print(){state.autoPrint=true;}})};
sandbox.window=sandbox;
const source=fs.readFileSync(require.resolve('../casks/print.js'),'utf8');
vm.runInNewContext(source,sandbox);
function text(n){return 'No\t品名\t規格\t単位\t合計数量\t契約単価\t金額\t備考\n'+Array.from({length:n},(_,i)=>[String(i+1),'品名'+i,'規格','個','1','100','100',''].join('\t')).join('\n');}
(async()=>{
  for(const n of [1,15,16,40,41,42,60,100])for(const first of [1,15,18,60])for(const later of [1,25,60]){
    const data=sandbox.InvoicePrint.parse(text(n)), html=sandbox.InvoicePrint.buildHtml(data,{first,later});
    const pages=1+Math.ceil(Math.max(0,n-first)/later);
    assert.equal((html.match(/class="page"/g)||[]).length,pages);
    assert.equal((html.match(/class="item-name"/g)||[]).length,n);
    for(let i=0;i<n;i++)assert.equal(html.split('>品名'+i+'</div>').length-1,1);
    assert.equal((html.match(/>総合計</g)||[]).length,1);
    assert.equal((html.match(/>小計</g)||[]).length,pages>1?pages:0);
    assert.equal(data.totalAmount,Math.floor(n*108));
  }
  for(const value of ['0','61','-1','1.5','','x']){
    fields.printFirstRows.value=value;const before=state.clicked;sandbox.saveLedgerInvoice(text(42));assert.equal(state.clicked,before);assert(state.alerts.length);
  }
  fields.printFirstRows.value='18';fields.printLaterRows.value='25';fields.printFirstRows.onchange();assert.match(state.cookie,/18,25/);
  sandbox.printLedgerData(text(42));sandbox.saveLedgerInvoice(text(42));
  assert(!state.autoPrint,'プレビューは自動で印刷しない');
  const saved=(await state.blob.text()).replace(/^\uFEFF/,'');
  assert(!saved.includes('class="version"'));
  assert.match(saved, /size:A4 portrait/);
  assert.match(saved, /ご請求金額（税込）/);
  assert.match(saved, /\.invoice-title \{[^}]*text-align:left/);
  assert.match(saved, /\.amount-box \{[^}]*border-left:4px/);
  assert.match(fs.readFileSync(require.resolve('../index.html'),'utf8'), /casks\/print\.js\?v=20261006-02/);
  assert.equal((saved.match(/class="grand-total"/g)||[]).length,1);
  assert.match(sandbox.InvoicePrint.fileName('株式会社テスト\n住所','2026-10-05',true),/^請求書_編集用_株式会社テスト_20261005_/);
  assert(!/[<>:"/\\|?*]/.test(sandbox.InvoicePrint.fileName('A/B:*?\\C','',false)));
  assert.match(sandbox.InvoicePrint.fileName('','',false),/業者名未入力/);
  assert.equal(saved,state.print,'保存と印刷は同じ帳票');assert.equal((saved.match(/class="page"/g)||[]).length,2);
  assert.match(state.filename,/^請求書_業者_20261005_\d+\.html$/);assert.equal(state.revoked,1);
  assert(!/<(?:script|link|img)[^>]*(?:src|href)=/i.test(saved),'外部ファイルなし');
  fields.toText.value='<script>alert(1)</script>';sandbox.saveLedgerInvoice(text(1));assert.match(await state.blob.text(),/&lt;script&gt;/);
  sandbox.navigator.msSaveOrOpenBlob=(b,n)=>{state.ieBlob=b;state.ieName=n;};sandbox.saveLedgerInvoice(text(1));assert(state.ieBlob);assert.match(state.ieName,/\.html$/);
  state.cookie='invoicePrintRows=20,28';vm.runInNewContext(source,sandbox);assert.equal(fields.printFirstRows.value,20);assert.equal(fields.printLaterRows.value,28);
  fields.btnResetPrintRows.onclick();assert.equal(fields.printFirstRows.value,15);assert.equal(fields.printLaterRows.value,25);
  const before=state.clicked;sandbox.saveLedgerInvoice('');assert.equal(state.clicked,before);assert.match(state.alerts.at(-1),/明細がありません/);
  console.log('印刷行数: 境界・42品目2ページ・明細欠落/重複なし・合計・Cookie・不正値: OK');
  console.log('保存: 印刷HTML一致・日付固定・外部依存なし・文字エスケープ・Blob/IE保存経路: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
