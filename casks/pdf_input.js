(function (global) {
  'use strict';
  var input = document.getElementById('pdfInput'), noticeInput = document.getElementById('noticeInput');
  var status = document.getElementById('pdfStatus'), noticeStatus = document.getElementById('noticeStatus');
  var details = document.getElementById('noticeDetails');
  var ledgerReader = global.createLocalPdfReader(), noticeReader = global.createLocalPdfReader();
  var notice = null, noticeFilename = '', noticeBusy = false;
  function message(element, text, error) {
    element.textContent = text;
    element.setAttribute('data-status', error ? 'error' : 'success');
  }
  var logs = [], logText = document.getElementById('pdfErrorLog');
  function report(element, kind, file, error, context) {
    var msg = error && error.message || String(error), now = new Date();
    var lines = ['日時: ' + now.toLocaleString(), '対象: ' + kind, 'ファイル: ' + (file ? file.name + ' (' + file.size + ' bytes)' : '未選択'),
      '取込処理版: 20261106-log / PDF.js: ' + (global.pdfjsLib && global.pdfjsLib.version || '不明'),
      '処理段階: ' + context.stage, 'ページ: ' + (context.page || '未確定') + ' / ' + (context.count || '不明'),
      'エラー: ' + (error && error.name || 'Error') + ': ' + msg];
    if (context.check) Object.keys(context.check).forEach(function (k) {
      var v = context.check[k];
      lines.push(k + ': ' + (v === '' || v == null ? '（未取得）' : typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0,1000));
    });
    logs.unshift(lines.join('\r\n')); logs.length = Math.min(logs.length, 10);
    logText.value = logs.join('\r\n\r\n'); document.getElementById('pdfLogPanel').hidden = false;
    message(element, '読み込みできません：' + msg + '　詳細は下のエラーログをご確認ください。', true);
  }
  document.getElementById('savePdfLog').onclick = function () {
    var blob = new Blob(['\uFEFF', logText.value], { type: 'text/plain;charset=utf-8' });
    var filename = 'PDF取込エラー_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
    if (global.navigator.msSaveOrOpenBlob) return global.navigator.msSaveOrOpenBlob(blob, filename);
    var url = global.URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 60000);
  };
  function removeAutomaticSpecs() {
    global.currentRows.forEach(function (row) {
      if (row._noticeSpec !== undefined && !row._specManual && row.spec === row._noticeSpec) row.spec = '';
      delete row._noticeSpec;
    });
  }
  function refreshSpecs() {
    var inputs = document.getElementsByClassName('spec-input');
    global.currentRows.forEach(function (row, i) {
      if (inputs[i]) { inputs[i].value = row.spec || ''; inputs[i].title = row.spec || ''; }
    });
    global.rebuildDetailsText();
  }
  global.applyNoticeSpecifications = function () {
    removeAutomaticSpecs();
    details.textContent = '';
    if (!notice) { refreshSpecs(); return; }
    var prefix = noticeFilename + ' / ' + notice.pageCount + 'ページ / ' + notice.records.length + '品目';
    if (!global.currentRows.length) {
      message(noticeStatus, prefix + '：読み込み完了。納入台帳を選択すると規格を反映します。');
      return;
    }
    var result = global.matchNoticeSpecifications(global.currentRows, notice), copied = 0, kept = 0;
    result.matches.forEach(function (match) {
      var row = global.currentRows[match.index];
      if (row._specManual) { kept++; return; }
      row.spec = match.spec;
      row._noticeSpec = match.spec;
      copied++;
    });
    refreshSpecs();
    message(noticeStatus, prefix + '：規格 ' + copied + '件をコピーしました。規格なし ' + result.noSpec +
      '件、品名不一致 ' + result.unmatched + '件、要確認 ' + result.conflicts.length + '件' +
      (kept ? '、手入力を保持 ' + kept + '件' : '') + '。', result.conflicts.length > 0);
    details.textContent = result.conflicts.map(function (conflict) {
      return '「' + conflict.name + '」は複数の規格があります。規格欄に確認して入力してください。\n' +
        conflict.candidates.map(function (r) { return '  ' + r.spec + '（済通知 ' + r.page + 'ページ）'; }).join('\n');
    }).join('\n');
  };
  global.cancelPdfLoad = function () { ledgerReader.cancel(); };
  global.isNoticePdfBusy = function () { return noticeBusy; };
  global.clearNoticePdf = function () {
    noticeReader.cancel(); noticeBusy = false; notice = null; noticeFilename = '';
    noticeInput.value = '';
    removeAutomaticSpecs(); refreshSpecs();
    details.textContent = '';
    message(noticeStatus, '済通知PDFを選択すると、品名が一致して規格がある明細にコピーします。');
  };
  document.getElementById('btnClearNotice').onclick = global.clearNoticePdf;
  if (!global.pdfjsLib) {
    input.disabled = true; noticeInput.disabled = true;
    report(status, '共通', null, new Error('PDF読込ライブラリがありません。vendorフォルダーを含めて配置してください。'), {stage:'初期化'});
    return;
  }
  global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.js';
  input.onchange = function () {
    if (!input.files || !input.files.length) return;
    var file = input.files[0];
    global.renderTable([], null);
    document.getElementById('vendorText').value = '';
    if (global.invoiceMasterChanged) global.invoiceMasterChanged('vendor');
    var bulkSpecText = document.getElementById('bulkSpecText');
    bulkSpecText.value = bulkSpecText.defaultValue;
    if (notice) global.applyNoticeSpecifications();
    ledgerReader.load(file, function (progress) { message(status, file.name + '：' + progress); }, function (pages, log) {
      var parsed = global.parseLedgerPdfPages(pages, log);
      log.stage = '台帳の画面反映'; log.page = null; log.check = null;
      global.renderTable(parsed.rows, parsed.summary);
      message(status, file.name + ' / ' + parsed.period + ' / ' + parsed.pageCount + 'ページ / ' + parsed.rows.length + '明細：原本との金額照合が完了しました。');
      global.applyNoticeSpecifications();
    }, function (error, log) {
      global.renderTable([], null);
      report(status, '納入台帳', file, error, log);
    });
  };
  noticeInput.onchange = function () {
    if (!noticeInput.files || !noticeInput.files.length) return;
    var file = noticeInput.files[0];
    notice = null; noticeBusy = true; noticeFilename = file.name;
    removeAutomaticSpecs(); refreshSpecs(); details.textContent = '';
    noticeReader.load(file, function (progress) { message(noticeStatus, file.name + '：' + progress); }, function (pages, log) {
      notice = global.parseNoticePdfPages(pages, log);
      log.stage = '規格の反映'; log.page = null; log.check = null;
      noticeBusy = false;
      global.applyNoticeSpecifications();
    }, function (error, log) {
      noticeBusy = false; notice = null;
      report(noticeStatus, '契約済通知書', file, error, log);
    });
  };
})(this);

function validateInvoice() {
  if (!currentRows.length) { alert('先に納入台帳PDFを読み込んでください。'); return false; }
  if (window.isNoticePdfBusy && window.isNoticePdfBusy()) { alert('済通知PDFの読み込みが完了するまでお待ちください。'); return false; }
  for (var i = 0; i < currentRows.length; i++) {
    var row = currentRows[i];
    var valid = function (s) { return /^\d+(\.\d+)?$/.test(String(s).replace(/,/g, '')); };
    if (!valid(row.qty) || !valid(row.price) || !valid(row.amount)) {
      alert('No ' + row.no + ' の数量・単価を正しい数値で入力してください。'); return false;
    }
  }
  var date = document.getElementById('billDate').value;
  if (date) {
    var m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    if (!m || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
      alert('日付は2025-10-31のように、実在する日付を入力してください。'); return false;
    }
  }
  return true;
}
