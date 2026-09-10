/* 契約済通知書の品名・規格を座標で抽出。日別の重複は照合時にまとめる。 */
(function (global) {
  'use strict';
  function trim(s) { return String(s || '').replace(/^\s+|\s+$/g, ''); }
  function key(s) {
    return trim(s).replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); })
      .replace(/\s/g, '').replace(/[〜～]/g, '~');
  }
  function join(items) {
    items.sort(function (a, b) { return Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x; });
    var result = '', previous = null;
    items.forEach(function (x) {
      if (previous && (Math.abs(x.y - previous.y) > 2 || /\s$/.test(previous.raw) || /^\s/.test(x.raw))) result += ' ';
      result += x.s;
      previous = x;
    });
    return result;
  }
  function parse(pages) {
    var records = [], vendors = [], contracts = [];
    pages.forEach(function (page, pageIndex) {
      var where = (pageIndex + 1) + 'ページ目：';
      if (Math.abs(page.width / page.height - 842 / 595) > 0.03) throw new Error(where + '対応する済通知の様式ではありません。');
      var items = page.items.map(function (x) {
        return { raw: x.str, s: trim(x.str), x: x.transform[4] * 842 / page.width, y: x.transform[5] * 595 / page.height };
      }).filter(function (x) { return x.s; });
      if (!items.some(function (x) { return key(x.s) === '契約済通知書'; })) throw new Error(where + '契約済通知書の文字を検出できません。');
      var vendor = join(items.filter(function (x) { return x.x >= 120 && x.x < 285 && Math.abs(x.y - 447.57) < 2; }));
      var contract = join(items.filter(function (x) { return x.x >= 120 && x.x < 285 && Math.abs(x.y - 480) < 2; }));
      if (!vendor || !contract) throw new Error(where + '業者名・契約番号を読み取れません。');
      if (vendors.indexOf(vendor) === -1) vendors.push(vendor);
      if (contracts.indexOf(contract) === -1) contracts.push(contract);
      var codes = items.filter(function (x) { return x.x >= 115 && x.x < 135 && x.y < 390 && /^\d{4}$/.test(x.s); });
      codes.sort(function (a, b) { return b.y - a.y; });
      if (!codes.length) throw new Error(where + '品目を読み取れません。');
      codes.forEach(function (code) {
        var name = join(items.filter(function (x) { return x.x >= 156 && x.x < 486 && Math.abs(x.y - code.y) < 3; }));
        var spec = join(items.filter(function (x) { return x.x >= 156 && x.x < 486 && Math.abs(x.y - (code.y - 10.8)) < 3; }));
        if (!name) throw new Error(where + '品目 ' + code.s + ' の品名を読み取れません。');
        records.push({ name: name, spec: spec, vendor: vendor, contract: contract, page: pageIndex + 1, no: code.s });
      });
    });
    if (!records.length) throw new Error('済通知の品目を読み取れません。');
    return { records: records, vendors: vendors, contracts: contracts, pageCount: pages.length };
  }
  function match(rows, notice) {
    var byName = {}, result = { matches: [], conflicts: [], noSpec: 0, unmatched: 0 };
    notice.records.forEach(function (record) {
      var k = '$' + key(record.name);
      if (!byName[k]) byName[k] = [];
      if (trim(record.spec) && !byName[k].some(function (r) { return key(r.spec) === key(record.spec); })) byName[k].push(record);
    });
    rows.forEach(function (row, index) {
      var candidates = byName['$' + key(row.name)];
      if (!candidates) result.unmatched++;
      else if (!candidates.length) result.noSpec++;
      else if (candidates.length > 1) result.conflicts.push({ index: index, name: row.name, candidates: candidates });
      else result.matches.push({ index: index, spec: candidates[0].spec, source: candidates[0] });
    });
    return result;
  }
  global.parseNoticePdfPages = parse;
  global.matchNoticeSpecifications = match;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parse: parse, match: match, key: key };
})(this);
