const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const db = require('./db');
const license = require('./license');
const nodemailer = require('nodemailer');

let mainWindow = null;
let licenseWatchTimer = null;
let backupEmailWatchTimer = null;

// منع فتح أكثر من نسخة من البرنامج في نفس الوقت — إذا حاول المستخدم فتحه مرة ثانية
// (مثلاً بالنقر على الاختصار مرتين) نُظهر النافذة الموجودة بدل تشغيل عملية خلفية إضافية
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function currentLicenseStatus() {
  const status = license.checkStoredLicense(db);
  return {
    ok: !!status.ok,
    reason: status.reason || null,
    permanent: !!status.permanent,
    expiryDate: status.expiryDate ? status.expiryDate.toISOString() : null,
    deviceId: license.getDeviceId(),
  };
}

function loadAppropriateScreen() {
  if (!mainWindow) return;
  const status = currentLicenseStatus();
  if (status.ok) {
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, 'src', 'activation.html'));
  }
}

function startLicenseWatch() {
  // إعادة فحص الترخيص بشكل دوري أثناء التشغيل، حتى لو انتهت الصلاحية والبرنامج
  // مفتوح فعلاً — بدون أي اتصال بالإنترنت، فقط مقارنة التاريخ محلياً.
  if (licenseWatchTimer) clearInterval(licenseWatchTimer);
  licenseWatchTimer = setInterval(() => {
    const status = currentLicenseStatus();
    if (!status.ok && mainWindow) {
      mainWindow.loadFile(path.join(__dirname, 'src', 'activation.html'));
    }
  }, 60 * 60 * 1000); // كل ساعة
}

// ---------------- نسخة احتياطية يومية عبر البريد الإلكتروني ----------------
function buildBackupJson() {
  return JSON.stringify({
    settings: db.getSettings(),
    customers: db.listCustomers(),
    saleInvoices: db.listSaleInvoices(),
    purchaseInvoices: db.listPurchaseInvoices(),
    payments: db.listPayments(),
  }, null, 2);
}

function todayLocalDateStr() {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

// يُرسل نسخة احتياطية الآن عبر البريد باستخدام إعدادات SMTP المحفوظة — يُستخدم للجدولة اليومية وللإرسال التجريبي اليدوي كليهما
async function sendBackupEmailNow() {
  const cfg = (db.getSettings() || {}).backupEmail || {};
  if (!cfg.to || !cfg.host || !cfg.user || !cfg.pass) {
    return { ok: false, reason: 'missing_config' };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: Number(cfg.port) || 587,
      secure: !!cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    const companyName = (db.getSettings() || {}).companyName || 'دفتر الفواتير';
    const todayStr = todayLocalDateStr();
    await transporter.sendMail({
      from: cfg.user,
      to: cfg.to,
      subject: 'نسخة احتياطية يومية — ' + companyName + ' — ' + todayStr,
      text: 'مرفق نسخة احتياطية تلقائية بتاريخ ' + todayStr + ' من برنامج ' + companyName + '.',
      attachments: [{ filename: 'نسخة-احتياطية-' + todayStr + '.json', content: buildBackupJson() }],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'send_error', message: (e && e.message) || String(e) };
  }
}

// يُرسَل تلقائياً مرة واحدة فقط في اليوم — يُفحص عند فتح البرنامج وكل ساعة أثناء بقائه مفتوحاً
// (لا توجد طريقة لتشغيل هذا وقت أن البرنامج مغلق تماماً؛ سيُرسل أول مرة يُفتح بها البرنامج ذلك اليوم)
async function maybeSendDailyBackupEmail() {
  const cfg = (db.getSettings() || {}).backupEmail || {};
  if (!cfg.enabled) return;
  const today = todayLocalDateStr();
  if (cfg.lastSentDate === today) return; // أُرسلت بالفعل اليوم
  const result = await sendBackupEmailNow();
  if (result.ok) {
    db.updateSettings({ backupEmail: Object.assign({}, cfg, { lastSentDate: today }) });
  }
  // عند الفشل (مثلاً لا يوجد إنترنت حالياً) نُبقي lastSentDate كما هي لإعادة المحاولة عند الفحص التالي بنفس اليوم
}

// يرفع نسخة احتياطية (JSON) الآن عبر طلب HTTP POST لأي رابط يحدده المستخدم (Webhook أو رابط استقبال ملفات،
// مثل Google Apps Script Web App مربوط بمجلد Google Drive) — يُستخدم للجدولة اليومية وللرفع التجريبي اليدوي كليهما
async function uploadBackupNow() {
  const cfg = (db.getSettings() || {}).backupUpload || {};
  if (!cfg.url) return { ok: false, reason: 'missing_config' };
  try {
    const companyName = (db.getSettings() || {}).companyName || 'دفتر الفواتير';
    const todayStr = todayLocalDateStr();
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'نسخة-احتياطية-' + companyName + '-' + todayStr + '.json',
        companyName,
        date: todayStr,
        backup: JSON.parse(buildBackupJson()),
      }),
    });
    if (!res.ok) return { ok: false, reason: 'send_error', message: 'HTTP ' + res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'send_error', message: (e && e.message) || String(e) };
  }
}

// نفس منطق الإرسال اليومي بالبريد، لكن للرفع عبر الرابط
async function maybeUploadDailyBackup() {
  const cfg = (db.getSettings() || {}).backupUpload || {};
  if (!cfg.enabled) return;
  const today = todayLocalDateStr();
  if (cfg.lastSentDate === today) return; // رُفعت بالفعل اليوم
  const result = await uploadBackupNow();
  if (result.ok) {
    db.updateSettings({ backupUpload: Object.assign({}, cfg, { lastSentDate: today }) });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#F6F4EF',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    autoHideMenuBar: true,
  });

  mainWindow.setMenuBarVisibility(false);
  // الشاشة المناسبة (تفعيل أو الواجهة الرئيسية) تُحمَّل عبر loadAppropriateScreen() بعد الإنشاء
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    db.init(app.getPath('userData'));
    createWindow();
    loadAppropriateScreen();
    startLicenseWatch();
    maybeSendDailyBackupEmail();
    maybeUploadDailyBackup();
    if (backupEmailWatchTimer) clearInterval(backupEmailWatchTimer);
    backupEmailWatchTimer = setInterval(() => { maybeSendDailyBackupEmail(); maybeUploadDailyBackup(); }, 60 * 60 * 1000); // إعادة فحص كل ساعة (يفيد لو تجاوزنا منتصف الليل والبرنامج مفتوح، أو فشلت محاولة سابقة بسبب انقطاع الإنترنت)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        loadAppropriateScreen();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (licenseWatchTimer) { clearInterval(licenseWatchTimer); licenseWatchTimer = null; }
  if (backupEmailWatchTimer) { clearInterval(backupEmailWatchTimer); backupEmailWatchTimer = null; }
  if (process.platform !== 'darwin') {
    app.quit();
    // بعض العمليات الفرعية لـ Electron (كنافذة PDF الخفية أو محرّك العرض) قد تتأخر لحظات عن الإغلاق
    // التلقائي؛ هذا يضمن إنهاء العملية فعلياً في الخلفية بدل أن تبقى عالقة بعد إغلاق النافذة الظاهرة
    setTimeout(() => { app.exit(0); }, 1500);
  }
});

// شبكة أمان إضافية: أي نافذة متبقية (مثل نافذة تصدير PDF الخفية) تُغلق قسراً قبل الخروج النهائي
app.on('before-quit', () => {
  if (licenseWatchTimer) { clearInterval(licenseWatchTimer); licenseWatchTimer = null; }
  if (backupEmailWatchTimer) { clearInterval(backupEmailWatchTimer); backupEmailWatchTimer = null; }
  BrowserWindow.getAllWindows().forEach((w) => { try { w.destroy(); } catch (_) {} });
});

// ---------------- IPC: روابط خارجية (اتصال / واتساب) ----------------
ipcMain.handle('system:openExternal', (e, url) => {
  if (typeof url === 'string' && /^(https?:|tel:|mailto:)/i.test(url)) {
    shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false };
});

// ---------------- IPC: نظام التفعيل (قفل على MAC + مدة، محلي بالكامل) ----------------
ipcMain.handle('license:getStatus', () => currentLicenseStatus());

ipcMain.handle('license:activate', (e, key) => {
  const result = license.activate(db, key);
  return {
    ok: !!result.ok,
    reason: result.reason || null,
    permanent: !!result.permanent,
    expiryDate: result.expiryDate ? result.expiryDate.toISOString() : null,
  };
});

// بعد نجاح التفعيل من شاشة activation.html، ننتقل إلى واجهة البرنامج الرئيسية
ipcMain.handle('license:enterApp', () => {
  const status = currentLicenseStatus();
  if (status.ok) loadAppropriateScreen();
  return status;
});

// لإلغاء التفعيل يدوياً على هذا الحاسوب (مثلاً قبل نقل الترخيص إلى جهاز آخر)
ipcMain.handle('license:deactivate', () => {
  license.deactivate(db);
  loadAppropriateScreen();
  return { ok: true };
});

// ---------------- IPC: الإعدادات ----------------
ipcMain.handle('settings:get', () => db.getSettings());
ipcMain.handle('settings:update', (e, patch) => db.updateSettings(patch));

// ---------------- IPC: العملاء ----------------
ipcMain.handle('customers:list', () => db.listCustomers());
ipcMain.handle('customers:get', (e, id) => db.getCustomer(id));
ipcMain.handle('customers:add', (e, data) => db.addCustomer(data));
ipcMain.handle('customers:update', (e, id, patch) => db.updateCustomer(id, patch));
ipcMain.handle('customers:delete', (e, id) => db.deleteCustomer(id));

// ---------------- IPC: الفواتير ----------------
ipcMain.handle('invoices:listSale', () => db.listSaleInvoices());
ipcMain.handle('invoices:listPurchase', () => db.listPurchaseInvoices());
ipcMain.handle('invoices:get', (e, type, id) => db.getInvoice(type === 'sale' ? 'saleInvoices' : 'purchaseInvoices', id));
ipcMain.handle('invoices:add', (e, type, data) => db.addInvoice(type, data));
ipcMain.handle('invoices:update', (e, type, id, data) => db.updateInvoice(type, id, data));
ipcMain.handle('invoices:delete', (e, type, id) => db.deleteInvoice(type, id));

// ---------------- IPC: الدفعات / المستحقات ----------------
ipcMain.handle('payments:add', (e, data) => db.addPayment(data));
ipcMain.handle('payments:list', () => db.listPayments());
ipcMain.handle('payments:settleOpening', (e, customerId, currency, amount, date, notes, batchId) => db.settleOpeningBalance(customerId, currency, amount, date, notes, batchId));
ipcMain.handle('dues:summary', () => db.getDuesSummary());

// ---------------- IPC: السجل ولوحة التحكم ----------------
ipcMain.handle('history:get', () => db.getHistory());
ipcMain.handle('dashboard:summary', () => db.getDashboardSummary());

// ---------------- IPC: الطباعة (نظام التشغيل) مع معاينة ----------------
// الطباعة الفعلية تتم عبر نافذة الطباعة الأصلية لنظام التشغيل والتي توفر
// معاينة وخيارات (الطابعة/عدد النسخ/الحجم) قبل التأكيد الفعلي للطباعة.
ipcMain.handle('print:current', async (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return new Promise((resolve) => {
    win.webContents.print(
      {
        silent: false,
        printBackground: true,
        margins: { marginType: 'default' },
        ...options,
      },
      (success, errorType) => {
        resolve({ success, errorType: errorType || null });
      }
    );
  });
});

// ---------------- IPC: نسخة احتياطية / استعادة ----------------
ipcMain.handle('backup:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'حفظ نسخة احتياطية',
    defaultPath: 'نسخة-احتياطية-' + new Date().toISOString().slice(0, 10) + '.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  const fs = require('fs');
  fs.writeFileSync(result.filePath, buildBackupJson(), 'utf-8');
  return { ok: true, path: result.filePath };
});

ipcMain.handle('backup:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'اختيار ملف النسخة الاحتياطية',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'canceled' };

  const fs = require('fs');
  const filePath = result.filePaths[0];
  let parsed;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: 'read_error' };
  }

  const looksValid =
    parsed &&
    typeof parsed === 'object' &&
    (Array.isArray(parsed.customers) ||
      Array.isArray(parsed.saleInvoices) ||
      Array.isArray(parsed.purchaseInvoices) ||
      Array.isArray(parsed.payments));
  if (!looksValid) return { ok: false, reason: 'invalid_format' };

  // فحص فقط: لا يتم تعديل البيانات الحالية هنا؛ الاستعادة الفعلية تتم عبر backup:restore بعد تأكيد المستخدم
  let fileDate = null;
  try { fileDate = fs.statSync(filePath).mtime.toISOString(); } catch (_) {}
  return { ok: true, path: filePath, fileDate, data: parsed };
});

ipcMain.handle('backup:restore', async (event, data) => {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'invalid_format' };
  const restored = db.restoreAll(data);
  return { ok: true, settings: restored.settings };
});

// ---------------- IPC: النسخ الاحتياطي التلقائي ----------------
ipcMain.handle('backup:autoInfo', async () => {
  return { dir: db.getAutoBackupDir(), defaultDir: db.getDefaultAutoBackupDir() };
});

ipcMain.handle('backup:openAutoFolder', async () => {
  const dir = db.getAutoBackupDir();
  if (!dir) return { ok: false };
  const err = await shell.openPath(dir);
  return { ok: !err };
});

ipcMain.handle('backup:chooseAutoFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'اختيار مكان حفظ النسخ الاحتياطية التلقائية',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  const chosenDir = result.filePaths[0];
  const settings = db.updateSettings({ autoBackupCustomDir: chosenDir });
  return { ok: true, dir: chosenDir, settings };
});

ipcMain.handle('backup:clearAutoFolder', async () => {
  const settings = db.updateSettings({ autoBackupCustomDir: '' });
  return { ok: true, dir: db.getAutoBackupDir(), settings };
});

// إرسال فوري (يدوي/تجريبي) عبر البريد باستخدام إعدادات SMTP المحفوظة حالياً — بدون انتظار الجدولة اليومية
ipcMain.handle('backup:sendEmailNow', async () => {
  const result = await sendBackupEmailNow();
  if (result.ok) {
    const cfg = (db.getSettings() || {}).backupEmail || {};
    db.updateSettings({ backupEmail: Object.assign({}, cfg, { lastSentDate: todayLocalDateStr() }) });
  }
  return result;
});

// رفع فوري (يدوي/تجريبي) عبر الرابط المحفوظ حالياً — بدون انتظار الجدولة اليومية
ipcMain.handle('backup:uploadNow', async () => {
  const result = await uploadBackupNow();
  if (result.ok) {
    const cfg = (db.getSettings() || {}).backupUpload || {};
    db.updateSettings({ backupUpload: Object.assign({}, cfg, { lastSentDate: todayLocalDateStr() }) });
  }
  return result;
});

// ---------------- IPC: تصدير مستند حالي كملف PDF ----------------
// ننشئ نافذة منفصلة غير مرئية ونحمّل بها مستنداً مستقلاً (رأس + جدول) بدل
// طباعة نافذة البرنامج كاملة، لأن printToPDF لا يلتزم دائماً بقواعد
// @media print الخاصة بإخفاء عناصر الواجهة.
function buildPdfDocument(innerHtml) {
  return (
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8" />' +
    '<style>' +
    "body{font-family:'Dubai','Segoe UI',Tahoma,Arial,sans-serif;color:#202722;margin:28px;}" +
    '.doc-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #202722;padding-bottom:14px;margin-bottom:18px;}' +
    '.doc-header h2{margin:0 0 4px 0;font-size:18px;}' +
    '.doc-header .doc-meta{font-size:12.5px;color:#6E7468;}' +
    '.doc-header .doc-type{text-align:left;font-weight:700;font-size:15px;}' +
    '.doc-section-title{font-weight:700;margin:14px 0 6px 0;font-size:13px;}' +
    '.doc-table{width:100%;border-collapse:collapse;margin-top:6px;}' +
    '.doc-table th{text-align:right;font-size:12px;border-bottom:1px solid #202722;padding:6px 4px;}' +
    '.doc-table td{padding:6px 4px;border-bottom:1px solid #ddd;font-size:12.5px;}' +
    '.doc-totals{margin-top:12px;width:100%;max-width:260px;margin-inline-start:auto;}' +
    '.doc-totals div{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;}' +
    '.doc-totals .grand{font-weight:700;border-top:1px solid #202722;margin-top:4px;padding-top:8px;font-size:14.5px;}' +
    '.doc-footer{margin-top:26px;font-size:11.5px;color:#6E7468;text-align:center;}' +
    '</style></head><body>' +
    innerHtml +
    '</body></html>'
  );
}

function sanitizeFileName(name) {
  return String(name || 'مستند')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim() || 'مستند';
}

ipcMain.handle('print:exportPdf', async (event, { html, defaultName } = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'حفظ كملف PDF',
    defaultPath: sanitizeFileName(defaultName) + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, reason: 'canceled' };

  const fs = require('fs');
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    const fullHtml = buildPdfDocument(html || '');
    await pdfWin.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(fullHtml));
    const data = await pdfWin.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'default' },
      pageSize: 'A4',
    });
    fs.writeFileSync(result.filePath, data);
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, reason: 'pdf_error' };
  } finally {
    pdfWin.destroy();
  }
});
