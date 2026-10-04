(function (root) {
  'use strict';
  var D = root.InvoiceMasterData, SP = root.InvoiceSharePoint;
  // 接続先は配布されたconfigファイルだけから取得する。ブラウザ個別設定は使用しない。
  var config = root.INVOICE_SHAREPOINT_CONFIG || {};
  var client = null, user = null, mode = 'loading', busy = false;
  var data = { address: [], vendor: [] }, views = {}, pending = null, saveUncertain = false;
  var kinds = ['address', 'vendor'];
  function mineCookieName(kind) { return 'invoice_master_mine_' + kind; }
  function readMinePreference(kind) {
    try {
      var prefix = mineCookieName(kind) + '=';
      return String(document.cookie || '').split(';').some(function (part) {
        return D.trim(part) === prefix + '1';
      });
    } catch (_) { return false; }
  }
  function saveMinePreference(kind, checked) {
    var pathname = root.location.pathname;
    var cookiePath = (pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/').replace(/[;\r\n]/g, '');
    var expires = new Date(new Date().getTime() + 365 * 24 * 60 * 60 * 1000);
    try {
      document.cookie = mineCookieName(kind) + '=' + (checked ? '1' : '0') +
        '; Path=' + cookiePath + '; Max-Age=31536000; Expires=' + expires.toUTCString() +
        '; SameSite=Lax' + (root.location.protocol === 'https:' ? '; Secure' : '');
    } catch (_) { /* Cookieが制限されていても、現在の画面では設定を適用する。 */ }
  }
  function byId(id) { return document.getElementById(id); }
  function node(tag, text, className) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (className) n.className = className;
    return n;
  }
  function button(text, action) {
    var n = node('button', text, 'secondary-button'); n.type = 'button'; n.onclick = action; return n;
  }
  function input(id, labelText, parent, type) {
    var label = node('label', labelText), field = node('input');
    field.id = id; field.type = type || 'text'; label.htmlFor = id;
    parent.appendChild(label); parent.appendChild(field); return field;
  }
  function status(text, isError) {
    var n = byId('masterStatus'); n.textContent = text;
    n.className = isError ? 'master-status-error' : mode === 'test' ? 'master-status-test' : 'master-status-live';
  }
  function date(value) {
    var d = new Date(value);
    return isNaN(d.getTime()) ? '日時不明' : d.toLocaleString('ja-JP');
  }
  function person(p) { return (p.name || '不明') + (p.email ? '（' + p.email + '）' : p.id ? '［ID: ' + p.id + '］' : ''); }
  function signature() { return [config.tenantId, config.clientId, config.siteUrl, config.addressList, config.vendorList].join('|'); }
  function stamp(records) {
    kinds.forEach(function (kind) { records[kind].forEach(function (r) { r.connection = signature(); }); });
    return records;
  }
  function setBusy(value) {
    busy = value;
    ['masterReload', 'masterTest'].forEach(function (id) { byId(id).disabled = value; });
    kinds.forEach(function (kind) {
      var v = views[kind];
      if (!v) return;
      v.select.disabled = value; v.search.disabled = value; v.mine.disabled = value;
      v.use.disabled = value || !candidate(kind);
      v.fresh.disabled = value;
      v.create.disabled = value || mode !== 'sharepoint' || saveUncertain || v.bound && v.bound.source === 'test';
      v.update.disabled = value || mode !== 'sharepoint' || saveUncertain || !D.canEdit(v.bound, user, config.adminObjectIds) || !v.bound.etag || v.bound.connection !== signature();
      v.title.disabled = value; v.match.disabled = value; v.text.disabled = value;
      v.saveHint.textContent = mode !== 'sharepoint' ? '登録・更新はSharePoint接続後に利用できます。テストCSVは読み取り専用です。' :
        saveUncertain ? '保存結果の確認が必要です。一覧を再読込してください。' :
        v.bound && v.bound.source === 'test' ? 'テストCSVの内容は登録できません。「新しい情報を入力」から本番情報を入力してください。' :
        v.bound && !D.canEdit(v.bound, user, config.adminObjectIds) ? 'この情報を更新できるのは登録者または管理者です。新規登録は利用できます。' :
        '入力欄の編集だけでは共有情報は変わりません。保存前に内容を確認できます。';
    });
    if (pending) { pending.confirm.disabled = value; pending.cancel.disabled = value; }
  }
  function provenance(kind) {
    var v = views[kind], r = v.bound;
    if (!r) { byId(kind + 'Provenance').textContent = '登録情報は未選択です。'; return; }
    var changed = v.text.value !== v.appliedText;
    byId(kind + 'Provenance').textContent = (r.source === 'test' ? '【テストCSV】' : '【SharePoint】') + r.title +
      '\n登録者：' + person(r.createdBy) + ' ／ 登録日時：' + date(r.createdAt) +
      '\n最終更新：' + person(r.modifiedBy) + ' ／ ' + date(r.modifiedAt) +
      (changed ? '\n今回の請求書で編集あり（登録済みの内容とは異なります）' : '');
  }
  root.invoiceMasterChanged = function (kind) {
    var v = views[kind];
    if (!v) return;
    v.bound = null; v.appliedText = ''; v.title.value = ''; v.match.value = '';
    closeReview(); provenance(kind); setBusy(busy);
  };
  function candidate(kind) {
    var selected = views[kind].select.value;
    return data[kind].filter(function (r) { return r.id === selected && r.active; })[0] || null;
  }
  function preview(kind) {
    var v = views[kind], r = candidate(kind);
    v.preview.textContent = r ? r.lines.slice(0, kind === 'address' ? 3 : 5).join('\n') +
      '\n\n登録者：' + person(r.createdBy) + '\n登録日時：' + date(r.createdAt) +
      '\n最終更新者：' + person(r.modifiedBy) + '\n最終更新日時：' + date(r.modifiedAt) : '候補を選ぶと内容と登録者を確認できます。';
    v.use.disabled = busy || !r;
  }
  function render(kind) {
    var v = views[kind], selected = v.select.value;
    var list = D.filter(data[kind], v.search.value, v.mine.checked && mode === 'sharepoint', user, false);
    v.select.textContent = '';
    var empty = node('option', list.length ? '登録情報を選択してください' : '該当する登録情報がありません'); empty.value = ''; v.select.appendChild(empty);
    list.forEach(function (r) {
      var option = node('option', r.title + ' ｜ 登録者：' + r.createdBy.name + ' ｜ 更新：' + date(r.modifiedAt));
      option.value = r.id; v.select.appendChild(option);
    });
    v.select.value = list.some(function (r) { return r.id === selected; }) ? selected : '';
    v.count.textContent = list.length + '件' + (mode === 'test' ? '（架空のテストデータ）' : '');
    v.mineHint.textContent = v.mine.checked && mode !== 'sharepoint' ? 'チェック状態は保存されます。本人の情報への絞り込みはSharePoint接続後に適用します。' : '';
    preview(kind);
  }
  function renderAll() {
    byId('masterUser').textContent = '利用中：' + (user ? user.name + '（' + user.email + '）' : '未サインイン') + (mode === 'test' ? ' ／ テスト表示' : '');
    kinds.forEach(function (kind) { render(kind); provenance(kind); }); setBusy(busy);
  }
  function apply(kind) {
    var v = views[kind], r = candidate(kind);
    if (!r || busy) return;
    closeReview();
    v.bound = r; v.appliedText = r.lines.slice(0, kind === 'address' ? 3 : 5).join('\n').replace(/\n+$/, '');
    v.text.value = v.appliedText; v.title.value = r.title; v.match.value = r.matchName;
    provenance(kind); setBusy(false);
    v.message.textContent = (r.source === 'test' ? 'テストデータを' : '登録情報を') + '今回の請求書に反映しました。';
  }
  function closeReview() {
    if (pending) { pending.panel.parentNode.removeChild(pending.panel); pending = null; }
  }
  function review(kind, update) {
    var v = views[kind], fields, existing = update ? v.bound : null;
    if (busy || mode !== 'sharepoint' || !user || saveUncertain || v.bound && v.bound.source === 'test') return;
    if (update && (!D.canEdit(existing, user, config.adminObjectIds) || existing.connection !== signature())) return;
    try { fields = D.fields(kind, v.title.value, v.text.value, v.match.value, existing ? existing.active : true); }
    catch (e) { v.message.textContent = e.message; return; }
    closeReview();
    var panel = node('div', null, 'master-review'); panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'SharePoint保存内容の確認');
    panel.appendChild(node('h3', update ? '共有情報を更新します' : 'SharePointに新規登録します'));
    panel.appendChild(node('p', '操作する人：' + person(user), 'small'));
    if (existing) panel.appendChild(node('p', '登録者：' + person(existing.createdBy) + '（登録者は変更しません）', 'small'));
    if (!update && data[kind].some(function (r) { return D.trim(r.title).toLowerCase() === fields.Title.toLowerCase(); })) {
      panel.appendChild(node('p', '同じ登録名の情報があります。重複登録でよいか確認してください。', 'master-status-error'));
    }
    if (existing) panel.appendChild(node('pre', '変更前：' + existing.title + '\n' + existing.lines.join('\n'), 'master-preview'));
    panel.appendChild(node('pre', '保存する内容：' + fields.Title + '\n' + [fields.Line1, fields.Line2, fields.Line3, fields.Line4, fields.Line5].join('\n') +
      (kind === 'vendor' ? '\n台帳照合名：' + fields.MatchName : ''), 'master-preview'));
    var confirm = button(update ? 'この内容で更新する' : 'この内容で登録する', function () { save(kind, fields, existing, panel); });
    var cancel = button('キャンセル', closeReview);
    panel.appendChild(confirm); panel.appendChild(cancel); v.editor.appendChild(panel);
    pending = { panel: panel, confirm: confirm, cancel: cancel }; confirm.focus();
  }
  function save(kind, fields, existing, panel) {
    if (busy || !pending || pending.panel !== panel || mode !== 'sharepoint') return;
    setBusy(true); var v = views[kind];
    v.message.textContent = 'SharePointへ保存しています…';
    client.save(kind, fields, existing).then(function (record) {
      record.connection = signature();
      data[kind] = data[kind].filter(function (r) { return r.id !== record.id; }).concat([record]);
      v.bound = record; v.appliedText = record.lines.slice(0, kind === 'address' ? 3 : 5).join('\n').replace(/\n+$/, '');
      v.message.textContent = (existing ? '更新しました。更新者：' + person(record.modifiedBy) : '登録しました。登録者：' + person(record.createdBy));
      closeReview(); setBusy(false);
      v.search.value = ''; render(kind);
      v.select.value = record.id; preview(kind); provenance(kind);
    }, function (e) {
      saveUncertain = !!(e.uncertain || e.committed);
      closeReview(); setBusy(false); v.message.textContent = e.message || '保存できませんでした。';
      if (e.code === '412' || e.code === '404') {
        // 古い版を再保存できないようにする。請求書の編集中の文字は保持する。
        if (v.bound) v.bound.etag = '';
        setBusy(false);
        v.message.textContent += ' 入力内容は保持しています。';
      }
    });
  }
  function build(kind) {
    var container = byId(kind + 'Master'), editor = byId(kind + 'Editor');
    var label = kind === 'address' ? '宛先' : '業者';
    var v = { editor: editor, text: byId(kind === 'address' ? 'toText' : 'vendorText'), bound: null, appliedText: '' };
    views[kind] = v;
    v.search = input(kind + 'Search', '登録済み' + label + 'を検索', container); v.search.placeholder = '名称・登録者で検索';
    var filters = node('div', null, 'master-filters');
    v.mine = input(kind + 'Mine', '自分が登録した情報だけ', filters, 'checkbox');
    v.mine.checked = readMinePreference(kind);
    v.mine.setAttribute('aria-describedby', kind + 'MineHint');
    v.count = node('span', '', 'small'); filters.appendChild(v.count); container.appendChild(filters);
    v.mineHint = node('p', '', 'small'); v.mineHint.id = kind + 'MineHint'; container.appendChild(v.mineHint);
    var selectLabel = node('label', label + 'の候補'); selectLabel.htmlFor = kind + 'Select'; container.appendChild(selectLabel);
    v.select = node('select'); v.select.id = kind + 'Select'; container.appendChild(v.select);
    v.preview = node('pre', '', 'master-preview'); container.appendChild(v.preview);
    v.use = button('この' + label + 'を使用', function () { apply(kind); }); container.appendChild(v.use);
    v.fresh = button('新しい情報を入力', function () {
      if (v.text.value && !root.confirm('今回の' + label + 'の入力欄をクリアし、新しい情報を入力しますか？')) return;
      v.text.value = ''; root.invoiceMasterChanged(kind); v.message.textContent = ''; v.text.focus();
    }); container.appendChild(v.fresh);
    v.title = input(kind + 'Title', '登録名（検索用）', editor); v.title.maxLength = 255;
    v.title.placeholder = label + 'を区別できる名称';
    v.match = input(kind + 'Match', '台帳照合用の業者名', editor); v.match.maxLength = 255;
    if (kind === 'address') { v.match.hidden = true; editor.querySelector('label[for="addressMatch"]').hidden = true; }
    v.create = button('SharePointに新規登録', function () { review(kind, false); });
    v.update = button('登録内容を更新', function () { review(kind, true); });
    editor.appendChild(v.create); editor.appendChild(v.update);
    v.saveHint = node('p', '', 'small'); editor.appendChild(v.saveHint);
    v.message = node('p', '', 'master-message'); v.message.setAttribute('role', 'status'); editor.appendChild(v.message);
    v.search.oninput = function () { render(kind); };
    v.mine.onchange = function () { saveMinePreference(kind, v.mine.checked); render(kind); };
    v.select.onchange = function () { preview(kind); };
    v.text.addEventListener('input', function () { closeReview(); provenance(kind); });
    v.title.oninput = closeReview; v.match.oninput = closeReview;
  }
  function csv(path) {
    return new Promise(function (resolve, reject) {
      var request = new XMLHttpRequest(); request.open('GET', path, true); request.timeout = 15000;
      if (request.overrideMimeType) request.overrideMimeType('text/csv; charset=utf-8');
      request.onload = function () {
        if (request.status !== 200) { reject(D.error('CSV', 'テストCSVを読み込めません。dataフォルダーを含めてWebサーバーに配置してください。')); return; }
        try { resolve(D.parseCsv(request.responseText)); } catch (e) { reject(e); }
      };
      request.onerror = request.ontimeout = function () { reject(D.error('CSV', 'テストCSVを読み込めません。Webサーバーから開いてください。')); };
      request.send();
    });
  }
  function testMode(reason) {
    closeReview(); setBusy(true); mode = 'loading';
    status('テストCSVを読み込んでいます…');
    return Promise.all([csv('data/addresses.test.csv'), csv('data/vendors.test.csv')]).then(function (rows) {
      data = { address: rows[0], vendor: rows[1] }; mode = 'test'; user = null;
      setBusy(false); renderAll();
      status((reason ? reason + ' ' : '') + 'テストCSVを表示中・SharePointには保存されません。内容は架空です。');
    }, function (e) { data = { address: [], vendor: [] }; mode = 'error'; setBusy(false); renderAll(); status(e.message, true); });
  }
  function configured() { return !!(config.tenantId && config.clientId && config.siteUrl); }
  function connect(interactive) {
    if (busy) return;
    if (!configured()) { testMode('SharePointの接続先が未設定です。'); return; }
    closeReview(); setBusy(true); mode = 'loading'; data = { address: [], vendor: [] }; user = null; renderAll();
    status('SharePointを確認しています…');
    if (!client) client = SP.createClient(config);
    client.connect(interactive).then(function (result) {
      mode = 'sharepoint'; user = result.user; data = stamp(result.records); saveUncertain = false;
      setBusy(false); renderAll(); status('SharePoint接続済み。登録・更新はサインイン中の本人として保存します。');
    }, function (e) {
      setBusy(false);
      if (e.code === '404' || e.status === 404) { testMode(e.message); return; }
      mode = 'error'; user = null; renderAll();
      status(e.message && e.code ? e.message : 'サインインできませんでした。キャンセルやポップアップ設定を確認し、解消しない場合は管理者に接続設定の確認を依頼してください。', true);
    });
  }
  kinds.forEach(build);
  byId('masterReload').onclick = function () { connect(true); };
  byId('masterTest').onclick = function () { if (!busy) testMode(''); };
  if (configured()) connect(false); else testMode('SharePointの接続先が未設定です。');
})(this);
