const fs = require('fs');
const path = require('path');
const assert = require('assert');
const pdfjs = require('../vendor/pdfjs/pdf.js');
const parse = require('../casks/ledger_pdf_parser.js');
const expected = [[121, 969582, 1047148], [9, 60452, 65288], [5, 72924, 78757],
  [28, 475667, 513720], [7, 71780, 77522], [59, 1386742, 1497681]];
(async () => {
  if (!process.argv[2]) throw new Error('元PDFのフォルダーを指定してください。');
  for (let i = 0; i < 6; i++) {
    const name = '納入台帳' + '①②③④⑤⑥'[i] + '.pdf';
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(process.argv[2], name))),
      isEvalSupported: false, cMapUrl: path.resolve(__dirname, '../vendor/pdfjs/cmaps') + path.sep, cMapPacked: true }).promise;
    try {
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        pages.push({ width: page.view[2] - page.view[0], height: page.view[3] - page.view[1], items: (await page.getTextContent()).items });
      }
      const data = parse(pages);
      assert.equal(data.rows.length, expected[i][0]);
      assert.equal(data.summary.calcBase, expected[i][1]);
      assert.equal(Number(data.summary.total.replace(/,/g, '')), expected[i][2]);
      assert(data.rows.every(row => row.name && row.unit));
      console.log(name + ': ' + data.rows.length + '明細・原本照合 OK');
    } finally { await pdf.destroy(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
