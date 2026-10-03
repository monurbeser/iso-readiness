/**
 * ISO 9001:2026 Readiness Check — Google Sheets lead log
 * Bound Apps Script: open your Google Sheet → Extensions → Apps Script → paste this file.
 *
 * Script properties (Project Settings → Script properties):
 *   SECRET     required. Long random string; the webhook URL must end with ?key=<SECRET>
 *   FOLDER_ID  optional. Google Drive folder ID for the PDF reports. Left empty, setup() creates one.
 *
 * Run setup() once from the editor, then Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone) and use the /exec URL + ?key=SECRET as SHEETS_WEBHOOK_URL.
 */

var SHEET_NAME = 'Leads';
var EXTRA_COLUMNS = ['PDF report', 'Status', 'Owner', 'Next step', 'Notes'];
var STATUS_VALUES = ['New', 'Contacted', 'Meeting booked', 'Proposal sent', 'Won', 'Lost', 'Not a fit'];
var DEFAULT_COLUMNS = ['Submitted at', 'Temperature', 'Wants contact', 'Full name', 'Job title', 'Company', 'Email', 'Phone', 'Country',
  'Industry', 'Employees', 'Certification', 'Readiness', 'Digital maturity', 'Position', 'Major gaps', 'Partial gaps', 'Top gaps',
  'Recommended modules', 'Marketing opt-in', 'UTM source', 'UTM medium', 'UTM campaign', 'AM', 'Partner', 'Referrer domain', 'Page',
  'Area scores', 'Answers'];

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  getFolder_();
  ensureHeader_(getSheet_(), DEFAULT_COLUMNS);
  Logger.log('Setup done. SECRET = ' + props.getProperty('SECRET'));
}

function doGet() {
  return json_({ ok: true, service: 'ISO 9001:2026 lead log' });
}

function doPost(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || !e || !e.parameter || e.parameter.key !== secret) return json_({ ok: false, error: 'unauthorized' });
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  if (!body || !Array.isArray(body.row) || !Array.isArray(body.columns)) return json_({ ok: false, error: 'bad_payload' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var pdfUrl = '';
    if (body.pdfBase64 && body.pdfBase64.length < 4000000) {
      var bytes = Utilities.base64Decode(body.pdfBase64);
      var name = String(body.pdfName || 'ISO-9001-2026-GAP-analysis.pdf').replace(/[^\w.\-]/g, '-');
      var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
      var file = getFolder_().createFile(Utilities.newBlob(bytes, 'application/pdf', stamp + '-' + name));
      pdfUrl = file.getUrl();
    }
    var sheet = getSheet_();
    var header = ensureHeader_(sheet, body.columns);
    var record = {};
    for (var i = 0; i < body.columns.length; i++) record[body.columns[i]] = body.row[i];
    record['PDF report'] = pdfUrl;
    record['Status'] = 'New';
    var values = header.map(function (h) { return safe_(record.hasOwnProperty(h) ? record[h] : ''); });
    sheet.appendRow(values);
    var r = sheet.getLastRow();
    var tempCol = header.indexOf('Temperature') + 1;
    if (tempCol > 0) {
      var t = String(record['Temperature'] || '').toLowerCase();
      sheet.getRange(r, tempCol).setBackground(t === 'hot' ? '#F3D3DC' : t === 'warm' ? '#FBEBD9' : '#EEF1F4').setFontWeight('bold');
    }
    return json_({ ok: true, row: r });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- helpers ---------- */
function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function ensureHeader_(sheet, columns) {
  var lastCol = sheet.getLastColumn();
  var header = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(function (h) { return h; }) : [];
  var wanted = columns.concat(EXTRA_COLUMNS);
  var missing = wanted.filter(function (c) { return header.indexOf(c) < 0; });
  if (!missing.length) return header;
  header = header.concat(missing);
  sheet.getRange(1, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#7D2142');
  sheet.setFrozenRows(1);
  var statusCol = header.indexOf('Status') + 1;
  if (statusCol > 0) {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUS_VALUES, true).setAllowInvalid(true).build();
    sheet.getRange(2, statusCol, Math.max(1, sheet.getMaxRows() - 1), 1).setDataValidation(rule);
  }
  return header;
}

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder('ISO 9001-2026 Readiness Reports');
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

// Stop spreadsheet formula injection from public form input.
function safe_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v).slice(0, 5000);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
