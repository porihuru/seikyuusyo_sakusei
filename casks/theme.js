/* 初回描画より前にCookieの表示モードを復元する。 */
(function (root) {
  'use strict';
  var cookieName = 'invoice_theme', theme = 'light';
  try {
    String(document.cookie || '').split(';').forEach(function (part) {
      if (part.replace(/^\s+|\s+$/g, '') === cookieName + '=dark') theme = 'dark';
    });
  } catch (_) { /* Cookieが制限されている場合はライトモードで開始する。 */ }
  document.documentElement.setAttribute('data-theme', theme);

  function initialize() {
    var button = document.getElementById('btnTheme');
    if (!button) return;
    function render() {
      var dark = theme === 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      button.setAttribute('aria-pressed', dark ? 'true' : 'false');
      button.textContent = 'ダークモード：' + (dark ? 'オン' : 'オフ');
      button.title = dark ? 'ライトモードに切り替える' : 'ダークモードに切り替える';
    }
    button.onclick = function () {
      theme = theme === 'dark' ? 'light' : 'dark';
      render();
      var pathname = root.location.pathname;
      var path = (pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/').replace(/[;\r\n]/g, '');
      var expires = new Date(new Date().getTime() + 365 * 24 * 60 * 60 * 1000);
      try {
        document.cookie = cookieName + '=' + theme + '; Path=' + path +
          '; Max-Age=31536000; Expires=' + expires.toUTCString() + '; SameSite=Lax' +
          (root.location.protocol === 'https:' ? '; Secure' : '');
      } catch (_) { /* 保存できなくても、現在の画面の切り替えは利用できる。 */ }
    };
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})(this);
