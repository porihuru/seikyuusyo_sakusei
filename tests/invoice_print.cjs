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
  assert.match(fs.readFileSync(require.resolve('../index.html'),'utf8'), /casks\/print\.js\?v=20261110/);
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
  sandbox.invoiceTaxPercent=10;const standard=sandbox.InvoicePrint.parse(text(1));assert.equal(standard.totalAmount,110);
  const html=sandbox.InvoicePrint.buildHtml(standard);assert.match(html,/消費税額１０％/);assert(!html.includes('軽減税率対象'));

  // 添付PDFと同じ金額で、下部は50銭を保持、上部は整数になることを確認。
  const amounts=[6960,7080,27420,33560,6508,65280,33331.50,156552,34621,5835,32680,18204,48711,27294];
  const draft=require('../casks/invoice_draft.js').validate({format:'invoice-draft',version:1,billDate:'2026-11-10',toText:'',vendorText:'',bulkSpecText:'',printSettings:{first:15,later:25},rows:amounts.map((a,i)=>({no:String(i+1),name:'試験品目',qty:'1',price:String(a),amount:String(a)}))});
  const sample=text(1).split('\n')[0]+'\n'+draft.rows.map(r=>[r.no,r.name,'','個',r.qty,r.price,r.amount,''].join('\t')).join('\n');
  sandbox.invoiceTaxPercent=draft.taxPercent;
  const actual=sandbox.InvoicePrint.parse(sample);
  assert.equal(actual.baseAmount,504036.50);assert.equal(actual.taxAmount,40322);assert.equal(actual.totalAmount,544358.50);
  sandbox.printLedgerData(sample);sandbox.saveLedgerInvoice(sample);
  assert.equal(await state.ieBlob.text(),state.print);
  assert.match(state.print,/￥544,358ー/);assert.match(state.print,/544,358\.50/);
  assert(!state.print.includes('544,358.00'));
  const app=fs.readFileSync(require.resolve('../index.html'),'utf8');
  let summary;
  const recalc={currentRows:draft.rows,invoiceTaxPercent:8,displaySummary:s=>summary=s};
  for(const name of ['parseNumberForCalc','formatAmount','formatInt','recalcTotalsFromRows'])vm.runInNewContext(app.match(new RegExp('function '+name+'\\([^]*?^}', 'm'))[0],recalc);
  recalc.recalcTotalsFromRows();assert.equal(summary.total,'544,358.50');assert.equal(summary.tax,'40,322');
  for(const rate of [8,10]){
    sandbox.invoiceTaxPercent=rate;recalc.invoiceTaxPercent=rate;
    for(const amount of [100.01,100.50,100.99,100]){
      recalc.currentRows=[{amount:String(amount)}];recalc.recalcTotalsFromRows();
      const data=sandbox.InvoicePrint.parse(text(1).replace(/100\t100\t/, '100\t'+amount+'\t'));
      assert.equal(data.taxAmount,rate);assert.equal(data.totalAmount,amount+rate);
      assert.equal(summary.total,data.totalAmount.toFixed(2));
      assert.match(sandbox.InvoicePrint.buildHtml(data),new RegExp('￥'+(100+rate)+'ー'));
    }
  }
  const before=state.clicked;sandbox.saveLedgerInvoice('');assert.equal(state.clicked,before);assert.match(state.alerts.at(-1),/明細がありません/);
  console.log('印刷行数: 境界・42品目2ページ・明細欠落/重複なし・合計・Cookie・不正値: OK');
  console.log('保存: 印刷HTML一致・日付固定・外部依存なし・文字エスケープ・Blob/IE保存経路: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
