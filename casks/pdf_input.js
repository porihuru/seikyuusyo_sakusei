(function (global) {
  'use strict';
  var input = document.getElementById('pdfInput'), noticeInput = document.getElementById('noticeInput');
  var status = document.getElementById('pdfStatus'), noticeStatus = document.getElementById('noticeStatus');
  var details = document.getElementById('noticeDetails');
  var ledgerReader = global.createLocalPdfReader(), noticeReader = global.createLocalPdfReader();
  var notice = null, noticeFilename = '', noticeBusy = false;
  function message(element, text, error) {
    element.textContent = text;
    element.style.color = error ? '#a00000' : '#244b30';
  }
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
    message(status, 'PDF読込ライブラリがありません。vendorフォルダーを含めて配置してください。', true);
    return;
  }
  global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.js';
  input.onchange = function () {
    if (!input.files || !input.files.length) return;
    var file = input.files[0];
    global.renderTable([], null);
    document.getElementById('vendorText').value = '';
    document.getElementById('bulkSpecText').value = '';
    if (notice) global.applyNoticeSpecifications();
    ledgerReader.load(file, function (progress) { message(status, file.name + '：' + progress); }, function (pages) {
      var parsed = global.parseLedgerPdfPages(pages);
      global.renderTable(parsed.rows, parsed.summary);
      message(status, file.name + ' / ' + parsed.period + ' / ' + parsed.pageCount + 'ページ / ' + parsed.rows.length + '明細：原本との金額照合が完了しました。');
      global.applyNoticeSpecifications();
    }, function (error) {
      global.renderTable([], null);
      message(status, '読み込みできません：' + error, true);
    });
  };
  noticeInput.onchange = function () {
    if (!noticeInput.files || !noticeInput.files.length) return;
    var file = noticeInput.files[0];
    notice = null; noticeBusy = true; noticeFilename = file.name;
    removeAutomaticSpecs(); refreshSpecs(); details.textContent = '';
    noticeReader.load(file, function (progress) { message(noticeStatus, file.name + '：' + progress); }, function (pages) {
      notice = global.parseNoticePdfPages(pages);
      noticeBusy = false;
      global.applyNoticeSpecifications();
    }, function (error) {
      noticeBusy = false; notice = null;
      message(noticeStatus, '読み込みできません：' + error, true);
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
