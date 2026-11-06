const assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const fields = {}, document = {getElementById(id){return fields[id] || (fields[id]={value:'',hidden:true,setAttribute(){}});},getElementsByClassName(){return [];}};
let saved, failExtraction = true;
const ctx = {document, Blob, currentRows:[],renderTable(){},rebuildDetailsText(){},
 navigator:{msSaveOrOpenBlob(b){saved=b;}},
 FileReader:class {readAsArrayBuffer(){this.result=Buffer.from('%PDF-1.4');this.onload();}},
 pdfjsLib:{GlobalWorkerOptions:{},version:'test',getDocument(){return {destroy(){},promise:Promise.resolve({numPages:2,getPage:async n=>({view:[0,0,842,595],cleanup(){},getTextContent:async()=>{
 if(n===2 && failExtraction)throw Error('fixture extraction failure');
 return {items:[]};}})})};}}};
for(const file of ['pdf_file_reader','ledger_pdf_parser','notice_pdf_parser','pdf_input'])
 vm.runInNewContext(fs.readFileSync(require.resolve('../casks/'+file+'.js'),'utf8'),ctx);
async function select(id,name){fields[id].files=[{name,size:123}];fields[id].onchange();await new Promise(setImmediate);}
(async()=>{
 await select('pdfInput','broken.pdf');
 assert.equal(fields.pdfLogPanel.hidden,false);
 assert.match(fields.pdfErrorLog.value,/broken.pdf \(123 bytes\)/);assert.match(fields.pdfErrorLog.value,/ページ内の文字抽出/);
 assert.match(fields.pdfErrorLog.value,/2 \/ 2/);assert.match(fields.pdfErrorLog.value,/fixture extraction failure/);
 failExtraction=false;await select('noticeInput','empty.pdf');assert.match(fields.pdfErrorLog.value,/契約済通知書/);
 assert.match(fields.pdfErrorLog.value,/1 \/ 2/);assert.match(fields.pdfErrorLog.value,/文字要素数: 0/);
 fields.savePdfLog.onclick();assert.equal((await saved.text()).replace(/\r\n/g,'\n'),fields.pdfErrorLog.value.replace(/\r\n/g,'\n'));
 for(let i=0;i<10;i++)await select('pdfInput',i+'.txt');
 assert(!fields.pdfErrorLog.value.includes('broken.pdf'));assert.match(fields.pdfErrorLog.value.split('\r\n\r\n')[0],/9.txt/);
 console.log('PDF取込失敗: 文字抽出・帳票解析・種別・ページ・TXT保存・履歴上限 OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
