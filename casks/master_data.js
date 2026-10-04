/* データ変換・検証。ブラウザとNodeの両方で使用。 */
(function (root) {
  'use strict';
  function trim(value) { return String(value == null ? '' : value).replace(/^\s+|\s+$/g, ''); }
  function error(code, message) { var e = new Error(message); e.code = code; return e; }
  function parseCsv(text) {
    text = String(text).replace(/^\uFEFF/, '');
    var rows = [], row = [], cell = '', quoted = false, closed = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charAt(i);
      if (quoted) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { cell += '"'; i++; }
          else { quoted = false; closed = true; }
        } else cell += c;
      } else if (c === ',' || c === '\r' || c === '\n') {
        row.push(cell); cell = ''; closed = false;
        if (c !== ',') {
          if (row.some(function (v) { return v !== ''; })) rows.push(row);
          row = [];
          if (c === '\r' && text.charAt(i + 1) === '\n') i++;
        }
      } else if (c === '"' && !cell && !closed) quoted = true;
      else {
        if (closed || c === '"') throw error('CSV', 'CSVの引用符が正しくありません。');
        cell += c;
      }
    }
    if (quoted) throw error('CSV', 'CSVの引用符が閉じていません。');
    if (cell || row.length || closed) { row.push(cell); rows.push(row); }
    if (!rows.length) throw error('CSV', 'CSVにヘッダーがありません。');
    var headers = rows.shift(), seen = {};
    headers.forEach(function (h) {
      if (!h || seen['$' + h]) throw error('CSV', 'CSVの列名が空欄または重複しています。');
      seen['$' + h] = true;
    });
    ['id', 'title', 'line1', 'line2', 'line3', 'line4', 'line5', 'matchName', 'active',
      'createdById', 'createdByName', 'createdByEmail', 'createdAt', 'modifiedByName', 'modifiedAt'].forEach(function (h) {
      if (!seen['$' + h]) throw error('CSV', 'CSVに必要な列がありません：' + h);
    });
    var ids = {};
    return rows.map(function (values, index) {
      if (values.length !== headers.length) throw error('CSV', 'CSVの' + (index + 2) + '行目の列数が不正です。');
      var data = {};
      headers.forEach(function (h, n) { data[h] = values[n]; });
      if (!trim(data.id) || !trim(data.title) || ids['$' + data.id]) throw error('CSV', 'CSVのID・名称が空欄またはIDが重複しています。');
      if (!/^(true|false)$/i.test(data.active)) throw error('CSV', 'CSVのactiveはtrueまたはfalseにしてください。');
      ids['$' + data.id] = true;
      return { id: data.id, title: data.title, lines: [data.line1, data.line2, data.line3, data.line4, data.line5],
        matchName: data.matchName, active: data.active.toLowerCase() === 'true', source: 'test',
        createdBy: { id: data.createdById, name: data.createdByName, email: data.createdByEmail },
        createdAt: data.createdAt, modifiedBy: { name: data.modifiedByName }, modifiedAt: data.modifiedAt, etag: '' };
    });
  }
  function identity(set) {
    var user = set && set.user;
    return { id: user && user.id || '', name: user && user.displayName || '登録者情報なし', email: user && user.email || '' };
  }
  function fromGraph(item) {
    var f = item.fields || {};
    return { id: item.id, title: f.Title || '', lines: [f.Line1 || '', f.Line2 || '', f.Line3 || '', f.Line4 || '', f.Line5 || ''],
      matchName: f.MatchName || '', active: f.Active !== false, source: 'sharepoint', etag: item.eTag || '',
      createdBy: identity(item.createdBy), createdAt: item.createdDateTime || '',
      modifiedBy: identity(item.lastModifiedBy), modifiedAt: item.lastModifiedDateTime || '' };
  }
  function fields(kind, title, text, matchName, active) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n'), limit = kind === 'address' ? 3 : 5;
    while (lines.length && !trim(lines[lines.length - 1])) lines.pop();
    title = trim(title); matchName = trim(matchName);
    if (!title || !lines.length || !trim(lines[0])) throw error('VALIDATION', '登録名と、宛先または業者情報の1行目を入力してください。');
    if (lines.length > limit) throw error('VALIDATION', (kind === 'address' ? '宛先は3行' : '業者情報は5行') + '以内で登録してください。');
    if (title.length > 255 || matchName.length > 255 || lines.some(function (s) { return s.length > 255; })) {
      throw error('VALIDATION', '名称・照合名・各行は255文字以内にしてください。');
    }
    var result = { Title: title, MatchName: matchName, Active: active !== false };
    for (var i = 0; i < 5; i++) result['Line' + (i + 1)] = lines[i] || '';
    return result;
  }
  function canEdit(record, user, admins) {
    if (!record || record.source !== 'sharepoint' || !user || !user.id) return false;
    return record.createdBy.id === user.id || (admins || []).indexOf(user.id) !== -1;
  }
  function filter(records, query, mine, user, includeInactive) {
    query = trim(query).toLowerCase();
    return records.filter(function (r) {
      return (includeInactive || r.active) && (!mine || user && r.createdBy.id === user.id) &&
        (!query || [r.title, r.matchName, r.createdBy.name, r.createdBy.email].concat(r.lines).join(' ').toLowerCase().indexOf(query) !== -1);
    });
  }
  var api = { trim: trim, error: error, parseCsv: parseCsv, fromGraph: fromGraph, fields: fields, canEdit: canEdit, filter: filter };
  root.InvoiceMasterData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(this);
