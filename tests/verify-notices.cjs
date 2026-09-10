const fs = require('fs'), path = require('path'), assert = require('assert');
const pdfjs = require('../vendor/pdfjs/pdf.js');
const ledger = require('../casks/ledger_pdf_parser.js');
const notice = require('../casks/notice_pdf_parser.js');
async function pages(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), isEvalSupported: false,
    cMapUrl: path.resolve(__dirname, '../vendor/pdfjs/cmaps') + path.sep, cMapPacked: true }).promise;
  try {
    const result = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      result.push({ width: page.view[2], height: page.view[3], items: (await page.getTextContent()).items });
    }
    return result;
  } finally { await doc.destroy(); }
}
(async () => {
  if (!process.argv[2]) throw new Error('8件のPDFがあるフォルダーを指定してください。');
  const expected = [[53, 315, 16, '3,799,259'], [9, 20, 7, '205,308'], [27, 161, 6, '1,288,064'], [42, 68, 41, '1,044,300']];
  for (let n = 1; n <= 4; n++) {
    const id = '0' + n;
    const l = ledger(await pages(path.join(process.argv[2], id + '納入台帳.pdf')));
    const s = notice.parse(await pages(path.join(process.argv[2], id + '済通知番号.pdf')));
    const m = notice.match(l.rows, s), e = expected[n - 1];
    assert.equal(l.rows.length, e[0]); assert.equal(s.records.length, e[1]);
    assert.equal(m.matches.length, e[2]); assert.equal(l.summary.total, e[3]);
    assert.equal(m.unmatched, 0); assert.equal(m.conflicts.length, 0);
    assert(m.matches.every(x => x.spec));
    if (n === 1) {
      assert.equal(m.matches[0].spec, '1個300～400g');
      assert(s.records.filter(r => r.name === 'ささがき生ごぼう').every(r => r.spec.includes('薬品による漂白は不可') && r.spec.includes('休日納品可')));
    }
    if (n === 4) assert(s.records.find(r => r.name === '(特)冷凍カットほうれんそう').spec.includes('茎50%'));
    console.log(id + ': 台帳' + l.rows.length + '明細・済通知' + s.records.length + '品目・規格' + m.matches.length + '件・原本照合 OK');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
