/* SharePoint Online / Microsoft Graph v1.0。認証はMSAL 4.29.0の委任アクセス。 */
(function (root) {
  'use strict';
  var D = root.InvoiceMasterData;
  if (typeof module !== 'undefined' && module.exports) D = require('./master_data.js');
  var GRAPH = 'https://graph.microsoft.com/v1.0';
  var SCOPES = ['User.Read', 'Sites.Selected'];
  function validateConfig(config) {
    var guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!guid.test(config.tenantId) || !guid.test(config.clientId)) throw D.error('CONFIG', 'テナントIDとクライアントIDをGUID形式で設定してください。');
    var url;
    try { url = new URL(config.siteUrl); } catch (_) { throw D.error('CONFIG', 'SharePointのサイトURLを設定してください。'); }
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.sharepoint\.com$/i.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash) {
      throw D.error('CONFIG', 'サイトURLは https://組織名.sharepoint.com/sites/サイト名 の形式で入力してください。');
    }
    if (!D.trim(config.addressList) || !D.trim(config.vendorList) || config.addressList === config.vendorList) {
      throw D.error('CONFIG', '宛先と業者には、それぞれ別のリスト名またはリストIDを設定してください。');
    }
    return url;
  }
  function graphUrl(path) {
    if (path.indexOf('/') === 0 && path.indexOf('//') !== 0) return GRAPH + path;
    if (path.indexOf(GRAPH + '/') === 0) return path;
    throw D.error('ENDPOINT', '許可されていないAPI接続先です。');
  }
  function httpError(status) {
    var messages = {
      401: '認証の有効期限が切れています。「共有リストを再読込」で認証を確認してください。',
      403: 'SharePointへのアクセス権限がありません。サイト・リストの権限とアプリの同意を管理者に確認してください。',
      404: '指定したSharePointのサイト、リスト、または項目が見つかりません。',
      412: '別の人がこの情報を更新しました。一覧を再読込し、最新の内容を確認してから更新してください。',
      429: 'SharePointへのアクセスが集中しています。少し待ってから再読込してください。'
    };
    var e = D.error(String(status), messages[status] || 'SharePointの処理に失敗しました（HTTP ' + status + '）。');
    e.status = status;
    return e;
  }
  function createRequest(fetcher, getToken) {
    return function (method, path, body, etag) {
      var url;
      try { url = graphUrl(path); } catch (e) { return Promise.reject(e); }
      return getToken().then(function (token) {
        var headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
        if (body) headers['Content-Type'] = 'application/json';
        if (etag) headers['If-Match'] = etag;
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        return new Promise(function (resolve, reject) {
          var timer = setTimeout(function () {
            if (controller) controller.abort();
            var e = D.error('NETWORK', method === 'GET' ? '通信がタイムアウトしました。再接続してください。' :
              '通信がタイムアウトしたため保存結果が不明です。再登録する前にSharePointの一覧を確認してください。');
            e.uncertain = method !== 'GET'; reject(e);
          }, 30000);
          fetcher(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined,
            signal: controller ? controller.signal : undefined }).then(function (response) {
            if (!response.ok) {
              var e = httpError(response.status);
              e.uncertain = method !== 'GET' && response.status >= 500;
              if (e.uncertain) e.message += ' 保存結果が不明です。再登録の前に一覧を確認してください。';
              throw e;
            }
            return response.status === 204 ? {} : response.json();
          }).then(function (data) { clearTimeout(timer); resolve(data); }, function (reason) {
            clearTimeout(timer);
            if (!reason.code) {
              reason = D.error('NETWORK', method === 'GET' ? '通信できません。ネットワークを確認して再接続してください。' :
                '保存結果を確認できませんでした。重複登録を避けるため、再登録する前に一覧を再読込してください。');
              reason.uncertain = method !== 'GET';
            }
            reject(reason);
          });
        });
      });
    };
  }
  function createStore(request, config, user) {
    var siteId = '', lists = {}, records = { address: [], vendor: [] };
    function all(path) {
      var result = [], visited = {};
      function next(url) {
        if (visited[url]) throw D.error('RESPONSE', '一覧のページ情報が不正です。');
        visited[url] = true;
        return request('GET', url).then(function (data) {
          if (!Array.isArray(data.value)) throw D.error('RESPONSE', '一覧データの形式が不正です。');
          result = result.concat(data.value);
          return data['@odata.nextLink'] ? next(data['@odata.nextLink']) : result;
        });
      }
      return next(path);
    }
    function base(kind) {
      if (!lists[kind]) throw D.error('CONFIG', 'リストが接続されていません。');
      return '/sites/' + encodeURIComponent(siteId) + '/lists/' + encodeURIComponent(lists[kind]);
    }
    function read(kind) {
      return all(base(kind) + '/items?$expand=fields&$top=200').then(function (items) {
        records[kind] = items.map(D.fromGraph); return records[kind];
      });
    }
    function checkColumns(kind) {
      return all(base(kind) + '/columns?$select=name,text,boolean').then(function (columns) {
        ['Title', 'Line1', 'Line2', 'Line3', 'Line4', 'Line5', 'MatchName', 'Active'].forEach(function (name) {
          var column = columns.filter(function (c) { return c.name === name; })[0];
          if (!column || (name === 'Active' ? !column.boolean : !column.text)) {
            throw D.error('SCHEMA', (kind === 'address' ? '宛先' : '業者') + 'リストの列 ' + name + ' が未設定か型が違います。SHAREPOINT_SETUP.mdを確認してください。');
          }
        });
      });
    }
    function load() {
      var url;
      try { url = validateConfig(config); } catch (e) { return Promise.reject(e); }
      var path = url.pathname.replace(/\/$/, '') || '/';
      return request('GET', '/sites/' + url.hostname + ':' + path + '?$select=id').then(function (site) {
        siteId = site.id;
        return all('/sites/' + encodeURIComponent(siteId) + '/lists?$select=id,displayName');
      }).then(function (available) {
        ['address', 'vendor'].forEach(function (kind) {
          var name = config[kind + 'List'];
          var found = available.filter(function (list) { return list.id === name || list.displayName === name; });
          if (found.length !== 1) throw D.error('404', (kind === 'address' ? '宛先' : '業者') + 'リスト「' + name + '」が見つからないか、名前が重複しています。');
          lists[kind] = found[0].id;
        });
        if (lists.address === lists.vendor) throw D.error('CONFIG', '宛先と業者には別々のリストを設定してください。');
        return Promise.all([checkColumns('address'), checkColumns('vendor')]);
      }).then(function () { return Promise.all([read('address'), read('vendor')]); })
        .then(function () { return records; });
    }
    function save(kind, fields, existing) {
      if (kind !== 'address' && kind !== 'vendor') return Promise.reject(D.error('VALIDATION', '登録種別が不正です。'));
      if (existing && !D.canEdit(existing, user, config.adminObjectIds)) return Promise.reject(D.error('403', 'この情報を更新できるのは登録者または管理者です。'));
      if (existing && !existing.etag) return Promise.reject(D.error('CONFLICT', '更新前に一覧を再読込してください。'));
      // 呼び出し側から作成者・更新者を送らず、SharePointの標準監査情報を使用する。
      var clean;
      try { clean = D.fields(kind, fields.Title, [fields.Line1, fields.Line2, fields.Line3, fields.Line4, fields.Line5].join('\n'), fields.MatchName, fields.Active); }
      catch (e) { return Promise.reject(e); }
      var path = base(kind) + '/items';
      if (existing) path += '/' + encodeURIComponent(existing.id) + '/fields';
      return request(existing ? 'PATCH' : 'POST', path, existing ? clean : { fields: clean }, existing ? existing.etag : null)
        .then(function (result) {
          var id = existing ? existing.id : result.id;
          return request('GET', base(kind) + '/items/' + encodeURIComponent(id) + '?$expand=fields').then(D.fromGraph, function () {
            var e = D.error('SAVED_REFRESH', 'SharePointへの保存は完了しましたが、登録者情報の取得に失敗しました。再登録せず、一覧を再読込してください。');
            e.committed = true; throw e;
          });
        });
    }
    return { load: load, read: read, save: save };
  }
  var msalLoading = null;
  function loadMsal() {
    if (root.msal) return Promise.resolve(root.msal);
    if (!msalLoading) msalLoading = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'vendor/msal/msal-browser.min.js';
      script.onload = function () { if (root.msal) resolve(root.msal); else { msalLoading = null; reject(D.error('AUTH', '認証ライブラリを読み込めません。現行のEdgeまたはChromeを使用してください。')); } };
      script.onerror = function () { msalLoading = null; reject(D.error('AUTH', '認証ライブラリがありません。vendor/msalも配置してください。')); };
      document.head.appendChild(script);
    });
    return msalLoading;
  }
  function createClient(config) {
    if (config.mode === 'intranet') return root.InvoiceSharePointIntranet.createClient(config);
    var app, initialization, account, user, store;
    function connect(interactive) {
      try { validateConfig(config); } catch (e) { return Promise.reject(e); }
      if (!root.fetch || !root.crypto || !root.crypto.subtle || !root.URL) return Promise.reject(D.error('BROWSER', 'SharePoint連携はHTTPS（開発時はlocalhost）と現行のEdge／Chromeが必要です。'));
      return loadMsal().then(function (msal) {
        if (app) return initialization;
        app = new msal.PublicClientApplication({ auth: { clientId: config.clientId,
          authority: 'https://login.microsoftonline.com/' + config.tenantId,
          redirectUri: new URL('auth.html', root.location.href).href },
          cache: { cacheLocation: 'sessionStorage' } });
        initialization = app.initialize().catch(function (e) { app = null; initialization = null; throw e; });
        return initialization;
      }).then(function () {
        account = app.getActiveAccount();
        if (account) return;
        if (!interactive) throw D.error('SIGNIN', '認証が必要です。「共有リストを再読込」を押してください。');
        return app.loginPopup({ scopes: SCOPES, prompt: 'select_account' }).then(function (result) {
          account = result.account; app.setActiveAccount(account);
        });
      }).then(function () {
        // 起動時は認証画面を開かず、再読込の操作時だけ必要に応じて認証を確認する。
        return app.acquireTokenSilent({ scopes: SCOPES, account: account }).catch(function (e) {
          if (interactive && e instanceof root.msal.InteractionRequiredAuthError) {
            return app.acquireTokenPopup({ scopes: SCOPES, account: account });
          }
          throw D.error('SIGNIN', '認証を確認できません。「共有リストを再読込」を押してください。');
        });
      }).then(function () {
        var request = createRequest(root.fetch.bind(root), function () {
          return app.acquireTokenSilent({ scopes: SCOPES, account: account }).then(function (result) { return result.accessToken; }, function () {
            throw D.error('SIGNIN', '「共有リストを再読込」を押してください。認証またはアクセス許可の確認が必要です。');
          });
        });
        return request('GET', '/me?$select=id,displayName,mail,userPrincipalName').then(function (me) {
          user = { id: me.id, name: me.displayName, email: me.mail || me.userPrincipalName };
          store = createStore(request, config, user);
          return store.load().then(function (records) { return { user: user, records: records }; });
        });
      });
    }
    return { connect: connect, save: function (kind, fields, existing) {
      if (!store || !user) return Promise.reject(D.error('SIGNIN', '先に「共有リストを再読込」で接続してください。'));
      return store.save(kind, fields, existing);
    } };
  }
  var api = { createClient: createClient, createStore: createStore, createRequest: createRequest,
    validateConfig: validateConfig, graphUrl: graphUrl, httpError: httpError };
  root.InvoiceSharePoint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
