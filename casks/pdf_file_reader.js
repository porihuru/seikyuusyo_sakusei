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
      var mine = generation, log = { stage: 'ファイル形式の確認', page: null, count: null };
      function fail(error) {
        if (mine !== generation) return;
        cancel();
        onError(error, log);
      }
      if (!/\.pdf$/i.test(file.name)) { fail(new Error('PDFファイルを選択してください。')); return; }
      onProgress('読み込んでいます…');
      log.stage = 'ファイル読み出し';
      try {
        reader = new FileReader();
        reader.onerror = function () { if (mine === generation) fail(this.error || new Error('ファイルを読み込めませんでした。再度選択してください。')); };
        reader.onload = function () {
          if (mine !== generation) return;
          try {
            log.stage = 'PDF署名の確認';
            var data = new Uint8Array(reader.result), signature = '';
            for (var i = 0; i < Math.min(data.length, 1024); i++) signature += String.fromCharCode(data[i]);
            if (signature.indexOf('%PDF-') === -1) { fail(new Error('PDF形式のファイルではありません。')); return; }
            log.stage = 'PDF文書を開く';
            task = global.pdfjsLib.getDocument({ data: data, cMapUrl: 'vendor/pdfjs/cmaps/',
              cMapPacked: true, isEvalSupported: false, disableFontFace: true });
            task.onPassword = function () { fail(new Error('パスワード付きPDFは読み込めません。')); };
            task.promise.then(function (pdf) {
              log.count = pdf.numPages;
              var pages = [];
              function next(n) {
                if (mine !== generation) return;
                if (n > pdf.numPages) { log.stage = '帳票の解析・照合'; log.page = null; onComplete(pages, log); return; }
                log.page = n;
                log.stage = 'ページ取得';
                onProgress(n + ' / ' + pdf.numPages + 'ページを解析中…');
                return pdf.getPage(n).then(function (page) {
                  if (mine !== generation) return;
                  log.stage = 'ページ内の文字抽出';
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
      } catch (error) { fail(error); }
    }
    return { load: load, cancel: cancel };
  };
})(this);
