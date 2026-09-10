const assert = require('assert');
const parse = require('../casks/ledger_pdf_parser.js');
function item(str, x, y) { return { str, transform: [1, 0, 0, 1, x, y] }; }
function fixture() {
  return [{ width: 842, height: 595, items: [
    item('納入台帳', 394, 521), item('令和7年10月分', 399, 508),
    item('納地', 114, 480), item('業者', 502, 480),
    item('0001', 73, 445), item('商品', 88, 449), item('KG', 143, 445),
    item('0.50', 221, 449), item('0.50', 744, 449),
    item('1,000.00', 784, 449), item('500.00', 759, 440),
    item('課税対象額', 690, 40), item('500.00', 760, 40),
    item('消費税', 690, 31), item('40', 760, 31),
    item('合計', 690, 22), item('540', 760, 22)
  ] }];
}
const original = fixture();
const result = parse(original);
assert.equal(result.rows[0].qty, '0.50');
assert.equal(result.rows[0].price, '1,000.00');
assert.equal(result.rows[0].amount, '500.00');
assert.equal(result.summary.total, '540');
const fractional = fixture();
fractional[0].items.forEach(x => {
  if (x.str === '0.50') x.str = '0.501';
  if (x.str === '1,000.00') x.str = '500.00';
  else if (x.str === '500.00') x.str = '250.50';
  if (x.str === '40') x.str = '20';
  if (x.str === '540') x.str = '270';
});
assert.equal(parse(fractional).summary.total, '270', '原本の請求総額は1円未満切捨て');
original[0].items.reverse();
assert.deepEqual(parse(original), result, 'PDF内部の文字順序に依存しない');
let bad = fixture(); bad[0].items.find(x => x.str === '500.00' && x.transform[5] === 440).str = '490.00';
assert.throws(() => parse(bad), /原本金額/);
bad = fixture(); bad[0].items.find(x => x.transform[4] === 221).str = '0.25';
assert.throws(() => parse(bad), /日別数量/);
bad = fixture(); bad[0].items.find(x => x.str === '540').str = '541';
assert.throws(() => parse(bad), /一致しません/);
bad = fixture(); bad[0].items.push(item('0001', 73, 427));
assert.throws(() => parse(bad), /重複/);
bad = fixture(); bad[0].items = [];
assert.throws(() => parse(bad), /文字を検出/);
bad = fixture(); bad[0].items = bad[0].items.filter(x => x.transform[5] > 65);
assert.throws(() => parse(bad), /最終ページ/);
console.log('PDF座標抽出・小数数量・文字順序・照合エラー: OK');
