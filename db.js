// db.js
// تخزين محلي بسيط باستخدام ملف JSON على القرص (بدون أي اعتماديات خارجية)
// يبقى الملف محفوظاً داخل مجلد بيانات المستخدم الخاص بالتطبيق حتى بعد إغلاق البرنامج.

const fs = require('fs');
const path = require('path');

let DB_PATH = null;
let AUTO_BACKUP_DIR = null;
let cache = null;

function defaultData() {
  return {
    meta: { version: 1 },
    settings: {
      companyName: 'اسم المنشأة',
      companyPhone: '',
      companyAddress: '',
      currency: 'د.ع',
      saleInvoicePrefix: 'S',
      purchaseInvoicePrefix: 'P',
      saleInvoiceCounter: 0,
      purchaseInvoiceCounter: 0,
      autoBackupCustomDir: '',
    },
    customers: [],
    saleInvoices: [],
    purchaseInvoices: [],
    payments: [],
  };
}

function init(userDataPath) {
  DB_PATH = path.join(userDataPath, 'data.json');
  AUTO_BACKUP_DIR = path.join(userDataPath, 'auto-backups');
  try { fs.mkdirSync(AUTO_BACKUP_DIR, { recursive: true }); } catch (_) {}
  if (!fs.existsSync(DB_PATH)) {
    cache = defaultData();
    persist();
  } else {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      cache = JSON.parse(raw);
      // دمج أي حقول إعدادات جديدة أضيفت في تحديثات لاحقة دون فقدان بيانات المستخدم
      cache.settings = Object.assign(defaultData().settings, cache.settings || {});
      if (!cache.customers) cache.customers = [];
      // توافق مع البيانات القديمة التي لا تحتوي حقل الرصيد السابق
      cache.customers.forEach((c) => { if (c.openingBalance === undefined) c.openingBalance = 0; });
      if (!cache.saleInvoices) cache.saleInvoices = [];
      if (!cache.purchaseInvoices) cache.purchaseInvoices = [];
      if (!cache.payments) cache.payments = [];
    } catch (e) {
      // نسخة احتياطية من الملف التالف بدلاً من فقدان البيانات بصمت
      const backupPath = DB_PATH + '.corrupt-' + Date.now() + '.bak';
      try { fs.copyFileSync(DB_PATH, backupPath); } catch (_) {}
      cache = defaultData();
      persist();
    }
  }
  return cache;
}

function persist() {
  // كتابة ذرية: نكتب لملف مؤقت ثم نستبدل، لتفادي تلف البيانات عند إغلاق مفاجئ
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf-8');
  fs.renameSync(tmpPath, DB_PATH);
  autoBackup();
}

// نسخة احتياطية تلقائية تُحدَّث بعد كل عملية تغيّر البيانات (إضافة/تعديل/حذف/تسديد...)
// دون الحاجة لأي إجراء يدوي من المستخدم. تُكتب دائماً في المجلد الافتراضي كشبكة أمان،
// وإضافياً في المجلد الذي يحدده المستخدم إن وُجد (مثلاً قرص خارجي أو مجلد مزامنة سحابي).
function writeBackupSet(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(cache, null, 2);
  // نسخة واحدة تعكس دائماً آخر حالة فور حدوث أي عملية
  fs.writeFileSync(path.join(dir, 'latest-auto-backup.json'), json, 'utf-8');
  // بالإضافة إلى نسخة يومية للاحتفاظ بسجل قصير من الأيام الماضية
  const dayStamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dir, 'daily-' + dayStamp + '.json'), json, 'utf-8');
  // تنظيف: الإبقاء على آخر 14 نسخة يومية فقط لتفادي تراكم الملفات بلا حدود
  const dailyFiles = fs.readdirSync(dir)
    .filter((f) => f.startsWith('daily-') && f.endsWith('.json'))
    .sort();
  const excess = dailyFiles.length - 14;
  if (excess > 0) {
    dailyFiles.slice(0, excess).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} });
  }
}

function autoBackup() {
  // شبكة الأمان الافتراضية: تعمل دائماً بغض النظر عن أي إعداد
  try { writeBackupSet(AUTO_BACKUP_DIR); } catch (_) {
    // فشل النسخ التلقائي لا يجب أن يوقف عمل البرنامج أو يفقد البيانات الأساسية
  }
  // مجلد إضافي يحدده المستخدم بنفسه (اختياري)
  const customDir = cache && cache.settings && cache.settings.autoBackupCustomDir;
  if (customDir && customDir !== AUTO_BACKUP_DIR) {
    try { writeBackupSet(customDir); } catch (_) {
      // مثلاً قرص خارجي غير متصل حالياً؛ النسخة الافتراضية أعلاه تبقى محفوظة بأي حال
    }
  }
}

function getAutoBackupDir() {
  const customDir = cache && cache.settings && cache.settings.autoBackupCustomDir;
  return customDir || AUTO_BACKUP_DIR;
}

function getDefaultAutoBackupDir() {
  return AUTO_BACKUP_DIR;
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- الإعدادات ----------
function getSettings() {
  return cache.settings;
}
function updateSettings(patch) {
  cache.settings = Object.assign({}, cache.settings, patch);
  persist();
  return cache.settings;
}

// ---------- العملاء ----------
function listCustomers() {
  return cache.customers.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
}
function getCustomer(id) {
  return cache.customers.find((c) => c.id === id) || null;
}
function addCustomer(data) {
  const c = {
    id: uid('cust'),
    name: (data.name || '').trim(),
    phone: (data.phone || '').trim(),
    address: (data.address || '').trim(),
    notes: (data.notes || '').trim(),
    // رصيد سابق (حساب قديم): موجب = دين قديم على العميل لصالحنا، سالب = دين علينا له
    openingBalance: Number(data.openingBalance) || 0,
    createdAt: nowIso(),
  };
  cache.customers.push(c);
  persist();
  return c;
}
function updateCustomer(id, patch) {
  const c = getCustomer(id);
  if (!c) return null;
  Object.assign(c, {
    name: patch.name !== undefined ? patch.name.trim() : c.name,
    phone: patch.phone !== undefined ? patch.phone.trim() : c.phone,
    address: patch.address !== undefined ? patch.address.trim() : c.address,
    notes: patch.notes !== undefined ? patch.notes.trim() : c.notes,
    openingBalance: patch.openingBalance !== undefined ? (Number(patch.openingBalance) || 0) : (c.openingBalance || 0),
  });
  persist();
  return c;
}
function deleteCustomer(id) {
  const hasInvoices =
    cache.saleInvoices.some((i) => i.customerId === id) ||
    cache.purchaseInvoices.some((i) => i.customerId === id);
  if (hasInvoices) {
    return { ok: false, reason: 'has_invoices' };
  }
  cache.customers = cache.customers.filter((c) => c.id !== id);
  persist();
  return { ok: true };
}

// ---------- الفواتير (بيع/شراء) ----------
function computeInvoiceTotal(amount, discount) {
  const amt = Number(amount) || 0;
  const disc = Number(discount) || 0;
  return Math.max(0, amt - disc);
}

function _listInvoices(store) {
  return cache[store]
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function listSaleInvoices() {
  return _listInvoices('saleInvoices');
}
function listPurchaseInvoices() {
  return _listInvoices('purchaseInvoices');
}
function getInvoice(store, id) {
  return cache[store].find((i) => i.id === id) || null;
}

function addInvoice(type, data) {
  const store = type === 'sale' ? 'saleInvoices' : 'purchaseInvoices';
  const amount = Number(data.amount) || 0;
  const total = computeInvoiceTotal(amount, data.discount);
  const paid = Math.min(Number(data.paidAmount) || 0, total);
  const invoice = {
    id: uid('inv'),
    number: type === 'sale'
      ? (() => { cache.settings.saleInvoiceCounter += 1; return cache.settings.saleInvoicePrefix + '-' + String(cache.settings.saleInvoiceCounter).padStart(4, '0'); })()
      : (() => { cache.settings.purchaseInvoiceCounter += 1; return cache.settings.purchaseInvoicePrefix + '-' + String(cache.settings.purchaseInvoiceCounter).padStart(4, '0'); })(),
    type,
    customerId: data.customerId,
    date: data.date || nowIso(),
    amount,
    discount: Number(data.discount) || 0,
    total,
    paidAmount: paid,
    notes: data.notes || '',
    createdAt: nowIso(),
  };
  cache[store].push(invoice);
  persist();
  return invoice;
}

function updateInvoice(type, id, data) {
  const store = type === 'sale' ? 'saleInvoices' : 'purchaseInvoices';
  const inv = getInvoice(store, id);
  if (!inv) return null;
  if (data.amount !== undefined) inv.amount = Number(data.amount) || 0;
  if (data.discount !== undefined) inv.discount = Number(data.discount) || 0;
  if (data.date) inv.date = data.date;
  if (data.notes !== undefined) inv.notes = data.notes;
  if (data.customerId) inv.customerId = data.customerId;
  inv.total = computeInvoiceTotal(inv.amount, inv.discount);
  if (data.paidAmount !== undefined) inv.paidAmount = Math.max(0, Number(data.paidAmount) || 0);
  if (inv.paidAmount > inv.total) inv.paidAmount = inv.total;
  persist();
  return inv;
}

function deleteInvoice(type, id) {
  const store = type === 'sale' ? 'saleInvoices' : 'purchaseInvoices';
  cache[store] = cache[store].filter((i) => i.id !== id);
  cache.payments = cache.payments.filter((p) => p.invoiceId !== id);
  persist();
  return { ok: true };
}

// ---------- الدفعات (سداد المستحقات) ----------
function addPayment(data) {
  const store = data.invoiceType === 'sale' ? 'saleInvoices' : 'purchaseInvoices';
  const inv = getInvoice(store, data.invoiceId);
  if (!inv) return { ok: false, reason: 'invoice_not_found' };
  const remaining = inv.total - inv.paidAmount;
  const amount = Math.min(Number(data.amount) || 0, remaining);
  if (amount <= 0) return { ok: false, reason: 'invalid_amount' };
  inv.paidAmount += amount;
  const payment = {
    id: uid('pay'),
    invoiceId: inv.id,
    invoiceType: data.invoiceType,
    invoiceNumber: inv.number,
    customerId: inv.customerId,
    amount,
    date: data.date || nowIso(),
    notes: data.notes || '',
    batchId: data.batchId || null,
    createdAt: nowIso(),
  };
  cache.payments.push(payment);
  persist();
  return { ok: true, payment, invoice: inv };
}

function listPayments() {
  return cache.payments.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ---------- المستحقات ----------
function getDuesSummary() {
  const byCustomer = {};
  for (const c of cache.customers) {
    const opening = Number(c.openingBalance) || 0;
    byCustomer[c.id] = {
      customerId: c.id,
      customerName: c.name,
      theyOweUs: opening > 0 ? opening : 0, // مستحق لنا من فواتير البيع + رصيد سابق
      weOweThem: opening < 0 ? -opening : 0, // مستحق علينا من فواتير الشراء + رصيد سابق
    };
  }
  for (const inv of cache.saleInvoices) {
    const remaining = inv.total - inv.paidAmount;
    if (remaining > 0.0001) {
      if (!byCustomer[inv.customerId]) continue;
      byCustomer[inv.customerId].theyOweUs += remaining;
    }
  }
  for (const inv of cache.purchaseInvoices) {
    const remaining = inv.total - inv.paidAmount;
    if (remaining > 0.0001) {
      if (!byCustomer[inv.customerId]) continue;
      byCustomer[inv.customerId].weOweThem += remaining;
    }
  }
  return Object.values(byCustomer).filter((c) => c.theyOweUs > 0.0001 || c.weOweThem > 0.0001);
}

// ---------- السجل / التاريخ ----------
function getHistory() {
  const events = [];
  for (const inv of cache.saleInvoices) {
    events.push({
      kind: 'sale_invoice',
      id: inv.id,
      date: inv.date,
      customerId: inv.customerId,
      amount: inv.total,
      label: 'فاتورة بيع رقم ' + inv.number,
    });
  }
  for (const inv of cache.purchaseInvoices) {
    events.push({
      kind: 'purchase_invoice',
      id: inv.id,
      date: inv.date,
      customerId: inv.customerId,
      amount: inv.total,
      label: 'فاتورة شراء رقم ' + inv.number,
    });
  }
  for (const p of cache.payments) {
    events.push({
      kind: p.invoiceType === 'sale' ? 'sale_payment' : 'purchase_payment',
      id: p.id,
      date: p.date,
      customerId: p.customerId,
      amount: p.amount,
      label: (p.invoiceType === 'sale' ? 'دفعة على فاتورة بيع ' : 'دفعة على فاتورة شراء ') + p.invoiceNumber,
    });
  }
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  return events;
}

// ---------- استعادة نسخة احتياطية ----------
function restoreAll(data) {
  const base = defaultData();
  const next = {
    meta: base.meta,
    settings: Object.assign({}, base.settings, (data && data.settings) || {}),
    customers: Array.isArray(data && data.customers) ? data.customers : [],
    saleInvoices: Array.isArray(data && data.saleInvoices) ? data.saleInvoices : [],
    purchaseInvoices: Array.isArray(data && data.purchaseInvoices) ? data.purchaseInvoices : [],
    payments: Array.isArray(data && data.payments) ? data.payments : [],
  };
  cache = next;
  persist();
  return cache;
}

// ---------- لوحة التحكم ----------
function getDashboardSummary() {
  const totalSales = cache.saleInvoices.reduce((s, i) => s + i.total, 0);
  const totalPurchases = cache.purchaseInvoices.reduce((s, i) => s + i.total, 0);
  const dues = getDuesSummary();
  const totalTheyOweUs = dues.reduce((s, d) => s + d.theyOweUs, 0);
  const totalWeOweThem = dues.reduce((s, d) => s + d.weOweThem, 0);
  return {
    customersCount: cache.customers.length,
    saleInvoicesCount: cache.saleInvoices.length,
    purchaseInvoicesCount: cache.purchaseInvoices.length,
    totalSales,
    totalPurchases,
    totalTheyOweUs,
    totalWeOweThem,
  };
}

module.exports = {
  init,
  getSettings,
  updateSettings,
  listCustomers,
  getCustomer,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  listSaleInvoices,
  listPurchaseInvoices,
  getInvoice,
  addInvoice,
  updateInvoice,
  deleteInvoice,
  addPayment,
  listPayments,
  getDuesSummary,
  getHistory,
  getDashboardSummary,
  restoreAll,
  getAutoBackupDir,
  getDefaultAutoBackupDir,
};
