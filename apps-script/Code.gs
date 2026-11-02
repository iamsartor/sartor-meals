/**
 * Sartor Meals connector. Paste this once into the Sheet's Apps Script editor
 * (Extensions > Apps Script) and deploy it as a web app. It never needs changes:
 * the app sends generic row operations, and all logic lives in the app.
 *
 * Access: the first request with a key claims it; after that only that key works.
 * To reset, delete the API_KEY entry under Project Settings > Script Properties.
 */

function doGet(e) {
  return handle_(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'invalid json' }); }
  return handle_(body);
}

function handle_(p) {
  if (!p.key) return out_({ ok: false, error: 'missing key' });
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('API_KEY');
  if (!key) { props.setProperty('API_KEY', p.key); key = p.key; }
  if (p.key !== key) return out_({ ok: false, error: 'wrong key' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    (p.ops || []).forEach(function (op) { applyOp_(ss, op); });
    SpreadsheetApp.flush();
    return out_({ ok: true, data: readAll_(ss), at: new Date().toISOString() });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function readAll_(ss) {
  var data = {};
  ss.getSheets().forEach(function (sh) {
    var values = sh.getDataRange().getDisplayValues();
    if (!values.length || !values[0][0]) { data[sh.getName()] = []; return; }
    var headers = values[0];
    data[sh.getName()] = values.slice(1).filter(function (r) { return r.join('') !== ''; }).map(function (r) {
      var o = {};
      headers.forEach(function (h, i) { if (h) o[h] = r[i]; });
      return o;
    });
  });
  return data;
}

function headers_(sh) {
  if (sh.getLastColumn() === 0) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
}

function ensureHeaders_(sh, keys) {
  var h = headers_(sh);
  var missing = keys.filter(function (k) { return h.indexOf(k) === -1; });
  if (missing.length) {
    sh.getRange(1, h.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    h = h.concat(missing);
  }
  return h;
}

function matches_(row, headers, match) {
  return Object.keys(match).every(function (k) {
    var i = headers.indexOf(k);
    return i !== -1 && String(row[i]) === String(match[k]);
  });
}

function appendRows_(sh, rows) {
  if (!rows || !rows.length) return;
  var keys = [];
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); }); });
  var h = ensureHeaders_(sh, keys);
  var grid = rows.map(function (r) { return h.map(function (k) { return r[k] === undefined || r[k] === null ? '' : String(r[k]); }); });
  var range = sh.getRange(sh.getLastRow() + 1, 1, grid.length, h.length);
  range.setNumberFormat('@').setValues(grid);
}

function deleteMatching_(sh, match) {
  var values = sh.getDataRange().getDisplayValues();
  var h = values[0];
  for (var i = values.length - 1; i >= 1; i--) {
    if (matches_(values[i], h, match)) sh.deleteRow(i + 1);
  }
}

function applyOp_(ss, op) {
  var sh = ss.getSheetByName(op.tab);
  if (op.op === 'ensure') {
    if (!sh) sh = ss.insertSheet(op.tab);
    if (headers_(sh).join('') === '') {
      sh.getRange(1, 1, 1, op.headers.length).setValues([op.headers]).setFontWeight('bold').setBackground('#eaf2fe');
      sh.setFrozenRows(1);
    }
    if (sh.getLastRow() <= 1 && op.rows && op.rows.length) appendRows_(sh, op.rows);
    return;
  }
  if (op.op === 'dropDefault') {
    ss.getSheets().forEach(function (s) {
      if (ss.getSheets().length > 1 && s.getLastRow() === 0 && /^(Sheet1|Tabellenblatt1|Blatt1)$/.test(s.getName())) ss.deleteSheet(s);
    });
    return;
  }
  if (!sh) throw new Error('unknown tab ' + op.tab);
  if (op.op === 'append') { appendRows_(sh, op.rows); return; }
  if (op.op === 'delete') { deleteMatching_(sh, op.match || {}); return; }
  if (op.op === 'replace') { deleteMatching_(sh, op.match || {}); appendRows_(sh, op.rows); return; }
  if (op.op === 'update') {
    var h = ensureHeaders_(sh, Object.keys(op.set || {}));
    var values = sh.getDataRange().getDisplayValues();
    for (var i = 1; i < values.length; i++) {
      if (!matches_(values[i], h, op.match || {})) continue;
      Object.keys(op.set).forEach(function (k) {
        sh.getRange(i + 1, h.indexOf(k) + 1).setNumberFormat('@').setValue(String(op.set[k]));
      });
    }
    return;
  }
  throw new Error('unknown op ' + op.op);
}
