const assert = require('assert');
const { parse, match } = require('../casks/notice_pdf_parser.js');
function item(str, x, y) { return { str, transform: [1, 0, 0, 1, x, y] }; }
const page = { width: 842, height: 595, items: [
  item('契 約 済 通 知 書', 390, 491), item('業者', 122, 447.57), item('契約001', 122, 480),
  item('0001', 118, 370.53), item('商品（大）', 158, 370.53), item('1kg ', 158, 359.73),
  item('袋入り', 200, 359.73), item('配送先（規格に混入しない）', 679, 359.73),
  item('商品番号（規格に混入しない）', 158, 381.33),
  item('0002', 118, 338.13), item('規格なし', 158, 338.13)
] };
const parsed = parse([page]);
assert.equal(parsed.records.length, 2);
assert.equal(parsed.records[0].name, '商品（大）');
assert.equal(parsed.records[0].spec, '1kg 袋入り');
assert.equal(parsed.records[1].spec, '');
page.items.reverse();
assert.deepEqual(parse([page]), parsed, '文字順序に依存しない');
let result = match([{ name: '商品(大)' }, { name: '規格なし' }, { name: '別商品' }], parsed);
assert.equal(result.matches.length, 1); assert.equal(result.noSpec, 1); assert.equal(result.unmatched, 1);
parsed.records.push({ name: '商品（大）', spec: '' });
parsed.records.push({ name: '商品（大）', spec: '１kg袋入り' });
result = match([{ name: '商品（大）' }], parsed);
assert.equal(result.matches.length, 1, '同一規格の繰返しと空欄は競合にしない');
parsed.records.push({ name: '商品（大）', spec: '500g袋入り' });
result = match([{ name: '商品（大）' }], parsed);
assert.equal(result.matches.length, 0); assert.equal(result.conflicts.length, 1);
assert.throws(() => parse([{ width: 842, height: 595, items: [] }]), /検出できません/);
console.log('済通知の列抽出・空欄・品名照合・重複・規格競合: OK');
