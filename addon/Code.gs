/**
 * Extract Data — read a screen recording into the spreadsheet you are in.
 *
 * The menu, the window, and the few things the window cannot do for itself. Everything that
 * touches the spreadsheet lives in Sheets.gs; everything that touches the video, the model and
 * the reviewing lives in the dialog, which is a web page.
 *
 * Installed from the Marketplace, this runs in every spreadsheet its owner opens; the same file
 * pasted into one spreadsheet's script runs only there. Nothing below cares which it is.
 *
 * The dialog is modeless: it floats over the spreadsheet and leaves it live underneath, so you
 * can scroll the sheet, click a cell, or switch tabs while it is open. That is the difference
 * between showModelessDialog and showModalDialog, and it is the whole reason this is a dialog
 * rather than a sidebar — a sidebar is stuck at three hundred pixels, and a modal one takes
 * the spreadsheet away from you while it is up.
 *
 * Nothing here ever sees the recording. The dialog reads it in the browser, sends frames to
 * the Worker, and hands back finished rows — so this script stays well inside Apps Script's
 * quotas and never has to hold a fifty-megabyte file.
 *
 * Who may do what is Google's business: if you can edit the spreadsheet you can extract into
 * it, and if you can only view it the dialog says so and stops. There are no accounts here.
 */

var ADDON_NAME = 'Extract Data';

/**
 * The menu, under Extensions.
 *
 * createAddonMenu rather than createMenu, because that is where Sheets puts an add-on and
 * where people look for one. It behaves the same in a bound script, so there is one code path
 * rather than two. This runs before anybody has authorised anything, so it must not touch the
 * spreadsheet's contents — building a menu is all it does.
 */
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem('Extract a recording', 'showDialog')
    .addSeparator()
    .addItem('Which tabs am I using?', 'showSettings')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

/**
 * The window.
 *
 * Modeless, so the spreadsheet underneath stays usable: you can drag this by its title bar,
 * scroll the sheet behind it, click a cell, and the dialog notices. The size here is only the
 * opening size — the page asks for more room for the review with google.script.host.setWidth
 * and setHeight, which is a thing only a dialog can do.
 *
 * One dialog exists at a time; calling this again brings up a fresh one in place of the old.
 */
function showDialog() {
  var html = HtmlService.createHtmlOutputFromFile('Dialog')
    .setWidth(760)
    .setHeight(548);
  SpreadsheetApp.getUi().showModelessDialog(html, ADDON_NAME);
}

/** Which tab the roster is on, and which one rows go into. Kept per spreadsheet, not per person. */
function showSettings() {
  var s = readSettings();
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt(
    ADDON_NAME + ' — the roster tab',
    'Rows are matched against a roster. Which tab is it on?\n\n'
      + 'Now: ' + (s.rosterTab || 'found automatically') + '\n'
      + 'Tabs here: ' + sheetNames().join(', ') + '\n\n'
      + 'Type a tab name, or leave blank to find it automatically.',
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var name = String(answer.getResponseText() || '').trim();
  writeSettings({ rosterTab: name || null });
  SpreadsheetApp.getActive().toast(name ? 'Roster: ' + name : 'Roster found automatically', ADDON_NAME, 4);
}

/* ------------------------------------------------------------------- what the dialog asks for */

// Document properties, so each spreadsheet keeps its own roster tab and its own settings even
// though one installed add-on serves all of them.
var SETTINGS_KEY = 'kartz.settings';

function readSettings() {
  try {
    var raw = PropertiesService.getDocumentProperties().getProperty(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function writeSettings(patch) {
  var now = readSettings();
  for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) now[k] = patch[k];
  PropertiesService.getDocumentProperties().setProperty(SETTINGS_KEY, JSON.stringify(now));
  return now;
}

function sheetNames() {
  return SpreadsheetApp.getActive().getSheets().map(function (s) { return s.getName(); });
}

/** Where the Worker is. Kept per spreadsheet, so nobody sets it twice. */
function getWorker() {
  var s = readSettings();
  return { url: s.workerUrl || 'https://data-extractor.jk06nm04.workers.dev' };
}

function setWorker(url) {
  writeSettings({ workerUrl: String(url || '').replace(/\/+$/, '') || null });
  return getWorker();
}

/**
 * Proof of who is using the add-on, for the Worker.
 *
 * Google signs this: a short-lived OpenID Connect token naming the person, made out to this
 * script's own OAuth client and nobody else's. The Worker checks the signature and the
 * audience, which together mean "somebody who has authorised this add-on" — the people the
 * spreadsheet is shared with, no more.
 *
 * There is nothing to type and nothing to keep. It lasts about an hour, and the page asks for
 * a fresh one when it needs to. Requires "openid" in appsscript.json.
 */
function getIdentity() {
  return ScriptApp.getIdentityToken();
}

/**
 * The client id this script's tokens are made out to — what the Worker needs pinning to.
 *
 * Run it from the editor once and read it in the execution log, or read it off the Worker's
 * first refusal, which says the same thing.
 */
function showClientId() {
  var token = ScriptApp.getIdentityToken();
  var claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(token.split('.')[1]))
    .getDataAsString());
  Logger.log('SCRIPT_AUD = ' + claims.aud);
  SpreadsheetApp.getActive().toast(String(claims.aud), ADDON_NAME + ' — client id', 30);
  return claims.aud;
}
