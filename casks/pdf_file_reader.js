/* 選択欄ごとに独立して使用する、キャンセル可能なローカルPDF読込。 */
(function (global) {
  'use strict';
  global.createLocalPdfReader = function () {
    var generation = 0, task = null, reader = null;
    function cancel() {
      generation++;
      if (reader && reader.readyState === 1) reader.abort();
      if (task) task.destroy();
      reader = null; task = null;
    }
    function load(file, onProgress, onComplete, onError) {
      cancel();
      var mine = generation;
      function fail(error) {
        if (mine !== generation) return;
        cancel();
        onError(error.message || String(error));
      }
      if (!/\.pdf$/i.test(file.name)) { fail(new Error('PDFファイルを選択してください。')); return; }
      onProgress('読み込んでいます…');
      reader = new FileReader();
      reader.onerror = function () { fail(new Error('ファイルを読み込めませんでした。再度選択してください。')); };
      reader.onload = function () {
        if (mine !== generation) return;
        try {
          var data = new Uint8Array(reader.result), signature = '';
          for (var i = 0; i < Math.min(data.length, 1024); i++) signature += String.fromCharCode(data[i]);
          if (signature.indexOf('%PDF-') === -1) { fail(new Error('PDF形式のファイルではありません。')); return; }
          task = global.pdfjsLib.getDocument({ data: data, cMapUrl: 'vendor/pdfjs/cmaps/',
            cMapPacked: true, isEvalSupported: false, disableFontFace: true });
          task.onPassword = function () { fail(new Error('パスワード付きPDFは読み込めません。')); };
          task.promise.then(function (pdf) {
            var pages = [];
            function next(n) {
              if (mine !== generation) return;
              if (n > pdf.numPages) { onComplete(pages); return; }
              onProgress(n + ' / ' + pdf.numPages + 'ページを解析中…');
              return pdf.getPage(n).then(function (page) {
                return page.getTextContent().then(function (content) {
                  pages.push({ width: page.view[2] - page.view[0], height: page.view[3] - page.view[1], items: content.items });
                  page.cleanup();
                  return next(n + 1);
                });
              });
            }
            return next(1);
          }).then(function () { if (mine === generation) cancel(); }, fail);
        } catch (error) { fail(error); }
      };
      reader.readAsArrayBuffer(file);
    }
    return { load: load, cancel: cancel };
  };
})(this);
