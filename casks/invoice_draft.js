/* 編集用JSON。外部通信なし。保存データはホワイトリスト検証後にだけ画面へ反映。 */
(function (root) {
  'use strict';
  var MAX_SIZE = 5 * 1024 * 1024;
  function fail() { throw new Error('編集用データの形式が不正、または未対応のバージョンです。'); }
  function string(value, limit) { if (typeof value !== 'string' || value.length > limit) fail(); return value; }
  function validate(value) {
    if (!value || value.format !== 'invoice-draft' || value.version !== 1 || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 5000) fail();
    var date = string(value.billDate, 10), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (date) {
      var d = m && new Date(+m[1], +m[2] - 1, +m[3]);
      if (!m || d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) fail();
    }
    var p = value.printSettings;
    if (!p || typeof p.first !== 'number' || typeof p.later !== 'number' || p.first % 1 || p.later % 1 || p.first < 1 || p.first > 60 || p.later < 1 || p.later > 60) fail();
    return { format: 'invoice-draft', version: 1, billDate: date,
      toText: string(value.toText, 20000), vendorText: string(value.vendorText, 20000),
      bulkSpecText: string(value.bulkSpecText, 20000), printSettings: { first: p.first, later: p.later },
      rows: value.rows.map(function (input) {
        if (!input || typeof input !== 'object') fail();
        var row = {};
        ['no', 'name', 'spec', 'unit', 'qty', 'price', 'amount', 'note', 'vendor', 'site', 'vendorName'].forEach(function (key) {
          row[key] = string(input[key] === undefined ? '' : input[key], 20000);
        });
        ['qty', 'price', 'amount'].forEach(function (key) {
          var n = row[key].replace(/,/g, '');
          if (!/^\d+(\.\d+)?$/.test(n) || !isFinite(Number(n)) || Number(n) > 1000000000000) fail();
        });
        // 復元した規格を、後から選ぶ済通知で勝手に上書きしない。
        row._specManual = true;
        return row;
      }) };
  }
  function parse(text) { if (typeof text !== 'string' || text.length > MAX_SIZE) fail(); return validate(JSON.parse(text.replace(/^\uFEFF/, ''))); }
  root.InvoiceDraft = { validate: validate, parse: parse };
  if (typeof module !== 'undefined' && module.exports) { module.exports = root.InvoiceDraft; return; }
  function el(id) { return document.getElementById(id); }
  function snapshot() {
    return validate({ format: 'invoice-draft', version: 1, rows: root.currentRows,
      billDate: el('billDate').value, toText: el('toText').value, vendorText: el('vendorText').value,
      bulkSpecText: el('bulkSpecText').value, printSettings: root.InvoicePrint.readSettings() });
  }
  el('btnSaveDraft').onclick = function () {
    if (!root.validateInvoice()) return;
    try {
      var text = JSON.stringify(snapshot(), null, 2), blob = new Blob(['\uFEFF', text], { type: 'application/json;charset=utf-8' });
      if (blob.size > MAX_SIZE) throw new Error('編集用データが5MBを超えています。');
      var name = '請求書_編集用_' + new Date().getTime() + '.json';
      if (root.navigator.msSaveOrOpenBlob) root.navigator.msSaveOrOpenBlob(blob, name);
      else {
        var url = root.URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = name; document.body.appendChild(link); link.click(); document.body.removeChild(link);
        root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 60000);
      }
      el('copyMsg').textContent = '編集用データのダウンロードを開始しました。後で「保存データを開く」で修正できます。';
    } catch (e) { alert('保存できません：' + e.message); }
  };
  var loading = false;
  el('btnLoadDraft').onclick = function () { if (!loading) el('invoiceDraftInput').click(); };
  el('invoiceDraftInput').onchange = function () {
    var input = this, file = input.files && input.files[0]; input.value = '';
    if (!file || loading) return;
    if (file.size > MAX_SIZE) { alert('5MB以下の編集用JSONファイルを選択してください。'); return; }
    var reader = new FileReader(); loading = true; el('btnLoadDraft').disabled = true;
    function done() { loading = false; el('btnLoadDraft').disabled = false; }
    reader.onerror = reader.onabort = function () { done(); alert('ファイルを読み込めませんでした。現在の内容は変更していません。'); };
    reader.onload = function () {
      var data;
      try { data = parse(reader.result); } catch (e) { done(); alert('読み込めません：' + e.message + '\n現在の内容は変更していません。'); return; }
      if (!confirm('現在の明細・日付・宛先・業者情報を保存データに置き換えます。未保存の編集内容は失われます。続けますか？')) { done(); return; }
      try {
        if (root.cancelPdfLoad) root.cancelPdfLoad();
        if (root.clearNoticePdf) root.clearNoticePdf();
        root.renderTable(data.rows, null);
        ['billDate', 'toText', 'vendorText', 'bulkSpecText'].forEach(function (key) { el(key).value = data[key]; });
        el('printFirstRows').value = data.printSettings.first; el('printLaterRows').value = data.printSettings.later;
        root.InvoicePrint.readSettings();
        if (root.invoiceMasterChanged) { root.invoiceMasterChanged('address'); root.invoiceMasterChanged('vendor'); }
        root.recalcTotalsFromRows();
        el('pdfInput').value = '';
        el('pdfStatus').textContent = '編集用データを復元しました。元PDFとの再照合は行っていません。';
        el('copyMsg').textContent = '保存データを読み込みました。修正後は「編集用データを保存」で再保存してください。SharePointへの保存は行っていません。';
      } catch (e) { alert('復元処理に失敗しました：' + e.message); }
      done();
    };
    try { reader.readAsText(file, 'UTF-8'); } catch (e) { done(); alert('ファイルを読み込めませんでした。'); }
  };
})(this);
