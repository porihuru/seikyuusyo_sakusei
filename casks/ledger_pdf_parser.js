/* 納入台帳（A4横・提示された様式）専用。PDFの座標から各列を読み取る。 */
(function (global) {
  'use strict';
  function trim(s) { return String(s || '').replace(/^\s+|\s+$/g, ''); }
  function number(s) {
    s = trim(s).replace(/[,\\¥￥]/g, '').replace(/-$/, '');
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  function format(n) {
    var p = n.toFixed(2).split('.');
    return p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + p[1];
  }
  function join(items) {
    items.sort(function (a, b) { return Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x; });
    return items.map(function (x) { return x.s; }).join('');
  }
  function parsePages(pages) {
    var rows = [], summary = null, firstVendor = '', firstPeriod = '', seen = {};
    pages.forEach(function (page, pageIndex) {
      var where = (pageIndex + 1) + 'ページ目：';
      if (Math.abs(page.width / page.height - 842 / 595) > 0.03) {
        throw new Error(where + '対応する納入台帳の用紙サイズではありません。');
      }
      var items = page.items.map(function (item) {
        return { s: trim(item.str), x: item.transform[4] * 842 / page.width,
          y: item.transform[5] * 595 / page.height };
      }).filter(function (x) { return x.s !== ''; });
      if (!items.some(function (x) { return x.s.replace(/\s/g, '') === '納入台帳'; })) {
        throw new Error(where + '納入台帳の文字を検出できません。画像のみのPDFは読み込めません。');
      }
      var vendor = join(items.filter(function (x) { return x.x >= 490 && x.y > 477 && x.y < 485; }));
      var site = join(items.filter(function (x) { return x.x >= 105 && x.x < 440 && x.y > 477 && x.y < 485; }));
      var period = join(items.filter(function (x) { return x.y > 503 && x.y < 514; })).replace(/\s/g, '');
      if (!vendor || !site || !period) throw new Error(where + '業者名・納地・対象月を読み取れません。');
      if (pageIndex && (firstVendor !== site + vendor || firstPeriod !== period)) {
        throw new Error(where + '業者・納地・対象月の異なる台帳が含まれています。PDFを分けてください。');
      }
      firstVendor = site + vendor;
      firstPeriod = period;
      var codes = items.filter(function (x) { return x.x >= 69 && x.x < 86 && /^\d{4}$/.test(x.s); });
      codes.sort(function (a, b) { return b.y - a.y; });
      if (!codes.length) throw new Error(where + '明細を読み取れません。');
      codes.forEach(function (code) {
        var label = where + 'No ' + code.s + '：';
        if (seen[code.s]) throw new Error(label + '明細番号が重複しています。');
        seen[code.s] = true;
        var band = items.filter(function (x) { return Math.abs(x.y - code.y) < 8; });
        function cell(minX, maxX, upper) {
          return join(band.filter(function (x) {
            return x.x >= minX && x.x < maxX && (upper ? x.y > code.y : x.y < code.y);
          }));
        }
        var name = join(band.filter(function (x) { return x.x >= 86 && x.x < 142; }));
        var unit = join(band.filter(function (x) { return x.x >= 142 && x.x < 152; }));
        var qty = cell(742, 782, true), price = cell(782, 821, true), amount = cell(742, 821, false);
        var q = number(qty), p = number(price), a = number(amount);
        if (!name || !/^(PC|BG|KG|EA|CA|CN|SH)$/.test(unit) || !isFinite(q) || !isFinite(p) || !isFinite(a)) {
          throw new Error(label + '品名・単位・数量・単価・金額を読み取れません。');
        }
        if (Math.abs(Math.round(q * p * 100) / 100 - a) > 0.005) {
          throw new Error(label + '数量×単価と原本金額が一致しません。');
        }
        var daily = band.filter(function (x) { return x.x >= 152 && x.x < 742; });
        var dailySum = 0;
        daily.forEach(function (x) {
          var v = number(x.s);
          if (!isFinite(v)) throw new Error(label + '日別数量を読み取れません。');
          dailySum += v;
        });
        if (Math.abs(dailySum - q) > 0.005) throw new Error(label + '日別数量の合計が一致しません。');
        rows.push({ vendor: firstVendor, site: site, vendorName: vendor, no: code.s, name: name, spec: '', unit: unit,
          qty: qty, price: price, amount: amount, originalAmount: amount, note: '', sourcePage: pageIndex + 1 });
      });
      var footer = {};
      ['課税対象額', '消費税', '合計'].forEach(function (label) {
        var anchors = items.filter(function (x) { return x.y < 65 && x.s.replace(/\s/g, '') === label; });
        if (anchors.length === 1) {
          var anchor = anchors[0];
          footer[label] = join(items.filter(function (x) { return x.x > anchor.x + 25 && Math.abs(x.y - anchor.y) < 2; }));
        }
      });
      if (footer['課税対象額'] || footer['消費税'] || footer['合計']) {
        if (summary || pageIndex !== pages.length - 1) throw new Error(where + '複数の台帳が含まれています。1台帳ずつ選択してください。');
        summary = { base: footer['課税対象額'], tax: footer['消費税'], total: footer['合計'] };
      }
    });
    if (!rows.length || !summary) throw new Error('明細または最終ページの集計を読み取れません。全ページを含むPDFを選択してください。');
    var sum = rows.reduce(function (a, row) { return a + number(row.amount); }, 0);
    var b = number(summary.base), t = number(summary.tax), total = number(summary.total);
    if (!isFinite(b) || !isFinite(t) || !isFinite(total) || Math.abs(sum - b) > 0.005 ||
        Math.abs(Math.floor(b + t + 0.000001) - total) > 0.005 || Math.floor(b * 0.08 + 0.000001) !== t) {
      throw new Error('原本の課税対象額・消費税・合計と明細の計算結果が一致しません。');
    }
    summary.total = format(total).replace(/\.00$/, '');
    summary.calcBase = sum;
    summary.calcBaseStr = format(sum);
    summary.baseCheckMark = '<';
    return { rows: rows, summary: summary, period: firstPeriod, pageCount: pages.length };
  }
  global.parseLedgerPdfPages = parsePages;
  if (typeof module !== 'undefined' && module.exports) module.exports = parsePages;
})(this);
