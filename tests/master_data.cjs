const assert = require('node:assert/strict');
const fs = require('node:fs');
const D = require('../casks/master_data.js');
const addresses = fs.readFileSync(require.resolve('../data/addresses.test.csv'), 'utf8');
const vendors = fs.readFileSync(require.resolve('../data/vendors.test.csv'), 'utf8');
const a = D.parseCsv('\ufeff' + addresses.replace(/\n/g, '\r\n'));
const v = D.parseCsv(vendors);
assert.equal(a.length, 2); assert.equal(v.length, 2);
assert.equal(a[0].createdBy.name, '佐藤 花子（架空）');
assert.equal(v[1].lines[4], 'TEL 000-000-0003');
const quoted = addresses.replace('【テスト】第一会計隊,', '"会計隊,\n""支部""",');
assert.equal(D.parseCsv(quoted)[0].title, '会計隊,\n"支部"');
assert.throws(() => D.parseCsv(addresses.replace('TEST-A002', 'TEST-A001')), /重複/);
assert.throws(() => D.parseCsv(addresses.replace(',true,', ',maybe,')), /active/);
assert.throws(() => D.parseCsv(addresses + 'bad,row'), /列数/);
assert.throws(() => D.parseCsv(addresses + '"unclosed'), /引用符/);
assert.throws(() => D.fields('address', '住所', '1\n2\n3\n4', ''), /3行/);
assert.throws(() => D.fields('vendor', '', '業者', ''), /登録名/);
assert.throws(() => D.fields('vendor', 'a'.repeat(256), '業者', ''), /255/);
assert.deepEqual(D.fields('address', '宛先', '会計隊\r\n住所\r\n電話\r\n', '', true), {
  Title: '宛先', Line1: '会計隊', Line2: '住所', Line3: '電話', Line4: '', Line5: '', MatchName: '', Active: true
});
assert.equal(D.filter(a, '佐藤', false, null, false).length, 1);
assert.equal(D.filter(a, '', true, {id:'test-yamada'}, false).length, 1);
assert.equal(D.filter(a, '', true, null, false).length, 0);
assert.equal(D.canEdit(a[0], {id:'test-sato'}, []), false, 'テストデータは更新不可');
const item = {id:'1',fields:{Title:'宛先',Line1:'会計隊',Active:false}, eTag:'"1"',
  createdBy:{user:{id:'u1',displayName:'登録者'}}, lastModifiedBy:{user:{id:'u2',displayName:'更新者'}},
  createdDateTime:'2026-10-01T00:00:00Z',lastModifiedDateTime:'2026-10-04T00:00:00Z'};
const record = D.fromGraph(item);
assert.equal(record.createdBy.name,'登録者'); assert.equal(record.modifiedBy.name,'更新者');
assert.equal(record.etag,'"1"'); assert.equal(record.active,false);
assert.equal(D.filter([record],'',false,null,false).length,0);
assert.equal(D.canEdit(record,{id:'u1'},[]),true);
assert.equal(D.canEdit(record,{id:'u2'},[]),false);
assert.equal(D.canEdit(record,{id:'admin'},['admin']),true);
console.log('マスタCSV・引用符/改行・入力検証・検索・登録者/更新者・編集者判定: OK');
