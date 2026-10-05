/* イントラSharePoint REST。既存のブラウザ認証を使用し、外部認証サービスには接続しない。 */
(function (root) {
  'use strict';
  var D = root.InvoiceMasterData;
  if (typeof module !== 'undefined' && module.exports) D = require('./master_data.js');
  function siteUrl(config, pageUrl) {
    var url, page;
    try { page = new URL(pageUrl); url = new URL(config.siteUrl, page); }
    catch (_) { throw D.error('CONFIG', 'SharePointのサイトURLを設定してください。'); }
    if (!D.trim(config.siteUrl) || !/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || /\/(Lists|_layouts|_api)\//i.test(url.pathname)) {
      throw D.error('CONFIG', 'サイトのトップURLを指定してください。Lists以降や設定画面のURLは含めません。');
    }
    if (page.origin !== url.origin) throw D.error('ORIGIN', '請求書アプリをSharePointと同じ接続元（プロトコル・ホスト・ポート）に配置して開いてください。PC上のHTMLや別サーバーからは接続できません。');
    if (!D.trim(config.addressList) || !D.trim(config.vendorList) || config.addressList === config.vendorList) throw D.error('CONFIG', '宛先と業者に別々のリスト名を設定してください。');
    return url.href.replace(/\/$/, '');
  }
  function createRequest(base, makeXhr) {
    var api = base + '/_api/';
    function endpoint(path) {
      var url;
      try { url = new URL(path, api); } catch (_) { throw D.error('ENDPOINT', 'API接続先が不正です。'); }
      if (url.href.indexOf(api) !== 0 || url.username || url.password || url.hash) throw D.error('ENDPOINT', '許可されていないAPI接続先です。');
      return url.href;
    }
    return function (method, path, body, headers) {
      return new Promise(function (resolve, reject) {
        var url;
        try { url = endpoint(path); } catch (e) { reject(e); return; }
        var xhr = makeXhr(), write = method !== 'GET' && path !== 'contextinfo';
        function failure(code, message) { var e = D.error(code, message); e.uncertain = write; reject(e); }
        xhr.open(method, url, true); xhr.timeout = 30000;
        xhr.setRequestHeader('Accept', 'application/json;odata=verbose');
        if (body) xhr.setRequestHeader('Content-Type', 'application/json;odata=verbose');
        Object.keys(headers || {}).forEach(function (key) { xhr.setRequestHeader(key, headers[key]); });
        xhr.onerror = function () { failure('NETWORK', '通信できません。イントラネット接続を確認してください。' + (write ? ' 保存結果が不明です。再登録前に一覧を確認してください。' : '')); };
        xhr.ontimeout = function () { failure('NETWORK', '通信がタイムアウトしました。' + (write ? '保存結果が不明です。再登録前に一覧を確認してください。' : '接続を確認して再読込してください。')); };
        xhr.onload = function () {
          var status = xhr.status === 1223 ? 204 : xhr.status;
          if (status < 200 || status >= 300) {
            var messages = {401: 'SharePointにログインしてから再読込してください。', 403: 'SharePointへのアクセス権限、または保存用の認証情報を確認できません。再読込し、権限を管理者に確認してください。', 404: 'SharePointのサイトまたはリストが見つかりません。', 412: '別の人が更新しました。一覧を再読込し、最新情報を選択してから更新してください。'};
            var e = D.error(String(status), messages[status] || 'SharePointの処理に失敗しました（HTTP ' + status + '）。');
            e.status = status; e.uncertain = write && (status >= 500 || status === 0);
            if (e.uncertain) e.message += ' 保存結果が不明です。再登録前に一覧を確認してください。';
            reject(e); return;
          }
          if (status === 204) { resolve({}); return; }
          try { var data = JSON.parse(xhr.responseText); resolve(data.d || data); }
          catch (_) { failure('RESPONSE', 'SharePointからJSONを取得できませんでした。ログイン状態と配置先を確認してください。' + (write ? ' 保存結果が不明です。再登録前に一覧を確認してください。' : '')); }
        };
        xhr.send(body ? JSON.stringify(body) : null);
      });
    };
  }
  function person(value) { return { id: value && value.Id != null ? String(value.Id) : '', name: value && value.Title || '登録者情報なし', email: value && value.EMail || '' }; }
  function record(item) {
    return { id: String(item.Id), title: item.Title || '', lines: [item.Line1 || '', item.Line2 || '', item.Line3 || '', item.Line4 || '', item.Line5 || ''],
      matchName: item.MatchName || '', active: item.Active !== false, source: 'sharepoint', etag: item.__metadata && item.__metadata.etag || '',
      createdBy: person(item.Author), modifiedBy: person(item.Editor), createdAt: item.Created || '', modifiedAt: item.Modified || '' };
  }
  function createStore(request, config, user) {
    var lists = {}, records = { address: [], vendor: [] };
    var select = '?$select=Id,Title,Line1,Line2,Line3,Line4,Line5,MatchName,Active,Created,Modified,Author/Id,Author/Title,Author/EMail,Editor/Id,Editor/Title,Editor/EMail&$expand=Author,Editor';
    function all(path) {
      var result = [], visited = {};
      function next(url) {
        if (visited[url]) return Promise.reject(D.error('RESPONSE', '一覧のページ情報が不正です。'));
        visited[url] = true;
        return request('GET', url).then(function (data) {
          if (!Array.isArray(data.results)) throw D.error('RESPONSE', '一覧データの形式が不正です。');
          result = result.concat(data.results); return data.__next ? next(data.__next) : result;
        });
      }
      return next(path);
    }
    function base(kind) {
      if (!lists[kind]) throw D.error('CONFIG', 'リストが接続されていません。');
      return lists[kind].path;
    }
    function read(kind) { return all(base(kind) + '/items' + select + '&$top=200').then(function (items) { records[kind] = items.map(record); return records[kind]; }); }
    function loadList(kind) {
      var name = config[kind + 'List'];
      var path = /^[0-9a-f-]{36}$/i.test(name) ? "web/lists(guid'" + name + "')" : "web/lists/getbytitle('" + encodeURIComponent(name.replace(/'/g, "''")).replace(/'/g, '%27') + "')";
      return request('GET', path + '?$select=Id,ListItemEntityTypeFullName').then(function (list) {
        if (!list.Id || !list.ListItemEntityTypeFullName) throw D.error('RESPONSE', 'リストの種類を取得できませんでした。');
        lists[kind] = { path: path, id: list.Id, type: list.ListItemEntityTypeFullName };
        return all(path + '/fields?$select=InternalName,TypeAsString');
      }).then(function (columns) {
        ['Title', 'Line1', 'Line2', 'Line3', 'Line4', 'Line5', 'MatchName', 'Active'].forEach(function (name) {
          var column = columns.filter(function (c) { return c.InternalName === name; })[0];
          if (!column || column.TypeAsString !== (name === 'Active' ? 'Boolean' : 'Text')) throw D.error('SCHEMA', (kind === 'address' ? '宛先' : '業者') + 'リストの列 ' + name + ' の内部名・種類を確認してください。');
        });
      });
    }
    function load() {
      return Promise.all([loadList('address'), loadList('vendor')]).then(function () {
        if (lists.address.id === lists.vendor.id) throw D.error('CONFIG', '宛先と業者に別々のリストを設定してください。');
        return Promise.all([read('address'), read('vendor')]);
      }).then(function () { return records; });
    }
    function save(kind, fields, existing) {
      if (kind !== 'address' && kind !== 'vendor') return Promise.reject(D.error('VALIDATION', '登録種別が不正です。'));
      if (existing && !D.canEdit(existing, user, config.adminUserIds)) return Promise.reject(D.error('403', '更新できるのは登録者または管理者です。'));
      if (existing && (!existing.etag || !/^\d+$/.test(existing.id))) return Promise.reject(D.error('CONFLICT', '一覧を再読込してください。'));
      var clean, path;
      try {
        clean = D.fields(kind, fields.Title, [fields.Line1, fields.Line2, fields.Line3, fields.Line4, fields.Line5].join('\n'), fields.MatchName, fields.Active);
        path = base(kind) + '/items' + (existing ? '(' + existing.id + ')' : '');
        clean.__metadata = { type: lists[kind].type };
      } catch (e) { return Promise.reject(e); }
      // 書き込み直前に取得。作成者・更新者は送らず、サーバーに記録させる。
      return request('POST', 'contextinfo').then(function (info) {
        var digest = info.GetContextWebInformation && info.GetContextWebInformation.FormDigestValue;
        if (!digest) throw D.error('RESPONSE', '保存用の認証情報を取得できません。');
        var headers = { 'X-RequestDigest': digest };
        if (existing) { headers['X-HTTP-Method'] = 'MERGE'; headers['If-Match'] = existing.etag; }
        return request('POST', path, clean, headers);
      }).then(function (result) {
        var id = existing ? existing.id : result.Id;
        return Promise.resolve().then(function () {
          if (!/^\d+$/.test(String(id))) throw D.error('RESPONSE', '保存したIDを取得できません。');
          return request('GET', base(kind) + '/items(' + id + ')' + select).then(record);
        }).catch(function () { var e = D.error('SAVED_REFRESH', '保存は完了しましたが、登録者情報を取得できません。再登録せず一覧を再読込してください。'); e.committed = true; throw e; });
      });
    }
    return { load: load, read: read, save: save };
  }
  function createClient(config) {
    var store;
    return { connect: function () {
      store = null;
      var base;
      try { base = siteUrl(config, root.location.href); } catch (e) { return Promise.reject(e); }
      var request = createRequest(base, function () { return new root.XMLHttpRequest(); });
      return request('GET', 'web/currentuser?$select=Id,Title,Email').then(function (me) {
        if (!me.Id) throw D.error('SIGNIN', 'SharePointにログインしてから再読込してください。');
        var user = { id: String(me.Id), name: me.Title, email: me.Email || '' };
        var connected = createStore(request, config, user);
        return connected.load().then(function (records) { store = connected; return { user: user, records: records }; });
      });
    }, save: function (kind, fields, existing) {
      if (!store) return Promise.reject(D.error('SIGNIN', '共有リストを再読込してください。'));
      return store.save(kind, fields, existing);
    } };
  }
  var api = { createClient: createClient, createStore: createStore, createRequest: createRequest, siteUrl: siteUrl, record: record };
  root.InvoiceSharePointIntranet = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
