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
      companyLogo: '',
      currency: 'د.ع',
      usdExchangeRate: 0,
      saleInvoicePrefix: 'S',
      purchaseInvoicePrefix: 'P',
      saleInvoiceCounter: 0,
      purchaseInvoiceCounter: 0,
      autoBackupCustomDir: '',
      licenseKey: '',
      // نسخة احتياطية يومية تلقائية عبر البريد الإلكتروني (اختيارية)
      backupEmail: {
        enabled: false,
        to: '',
        host: '',
        port: 587,
        secure: false,
        user: '',
        pass: '',
        lastSentDate: '', // YYYY-MM-DD — آخر يوم أُرسلت فيه النسخة فعلياً، لمنع الإرسال أكثر من مرة في نفس اليوم
      },
      // رفع نسخة احتياطية يومياً تلقائياً عبر رابط (Webhook) يحدده المستخدم (اختياري)
      backupUpload: {
        enabled: false,
        url: '',
        lastSentDate: '', // YYYY-MM-DD — آخر يوم رُفعت فيه النسخة فعلياً، لمنع الرفع أكثر من مرة في نفس اليوم
      },
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
      cache.customers.forEach((c) => {
        if (c.openingBalance === undefined) c.openingBalance = 0;
        // رصيد سابق مستقل بالدولار (حساب دولار منفصل تماماً عن حساب الدينار، بدون أي تحويل بينهما)
        if (c.openingBalanceUsd === undefined) c.openingBalanceUsd = 0;
        if (c.dealsInUsd === undefined) c.dealsInUsd = false;
        // توافق مع بيانات أقدم لا تحتوي القيمة الأصلية للرصيد القديم — أفضل تقدير متاح هو المتبقي الحالي
        // (لا يمكن استرجاع رصيد سُدد بالكامل قبل هذا التحديث، لكن هذا يمنع فقدان أي بيانات مستقبلاً)
        if (c.openingBalanceOriginal === undefined) c.openingBalanceOriginal = c.openingBalance;
        if (c.openingBalanceUsdOriginal === undefined) c.openingBalanceUsdOriginal = c.openingBalanceUsd;
      });
      if (!cache.saleInvoices) cache.saleInvoices = [];
      if (!cache.purchaseInvoices) cache.purchaseInvoices = [];
      if (!cache.payments) cache.payments = [];
      // توافق مع الفواتير القديمة التي لم تكن تحمل حقل العملة أصلاً (كانت جميعها بالعملة المحلية)
      cache.saleInvoices.forEach((i) => { if (i.currency !== 'USD') i.currency = 'IQD'; });
      cache.purchaseInvoices.forEach((i) => { if (i.currency !== 'USD') i.currency = 'IQD'; });
      cache.payments.forEach((p) => { if (p.currency !== 'USD') p.currency = 'IQD'; });
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
    // رصيد سابق بالدينار (حساب قديم): موجب = دين قديم على العميل لصالحنا، سالب = دين علينا له
    // هذه القيمة تتغيّر لاحقاً كلما سُدد جزء من الرصيد القديم (تمثّل "المتبقي")
    openingBalance: Number(data.openingBalance) || 0,
    // القيمة الأصلية للرصيد القديم كما أُدخلت عند إنشاء العميل — لا تتغيّر أبداً بعد ذلك،
    // وتُستخدم فقط لعرض بند "حساب قديم" في كشف الحساب حتى بعد تسديده بالكامل
    openingBalanceOriginal: Number(data.openingBalance) || 0,
    // رصيد سابق بالدولار: حساب مستقل تماماً عن حساب الدينار أعلاه، بدون أي تحويل تلقائي بينهما
    openingBalanceUsd: Number(data.openingBalanceUsd) || 0,
    openingBalanceUsdOriginal: Number(data.openingBalanceUsd) || 0,
    // هل يتعامل هذا العميل بالدولار بشكل معتاد (يُستخدم لاقتراح عملة الدولار كافتراضي عند إنشاء فاتورة جديدة)
    dealsInUsd: !!data.dealsInUsd,
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
    openingBalanceOriginal: patch.openingBalance !== undefined ? (Number(patch.openingBalance) || 0) : (c.openingBalanceOriginal || 0),
    openingBalanceUsd: patch.openingBalanceUsd !== undefined ? (Number(patch.openingBalanceUsd) || 0) : (c.openingBalanceUsd || 0),
    openingBalanceUsdOriginal: patch.openingBalanceUsd !== undefined ? (Number(patch.openingBalanceUsd) || 0) : (c.openingBalanceUsdOriginal || 0),
    dealsInUsd: patch.dealsInUsd !== undefined ? !!patch.dealsInUsd : !!c.dealsInUsd,
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
    // عملة الفاتورة: دينار أو دولار — حساب مستقل تماماً، كل المبالغ (المبلغ/الخصم/الإجمالي/المدفوع) بنفس هذه العملة
    currency: data.currency === 'USD' ? 'USD' : 'IQD',
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
// كل دفعة تكون دائماً بنفس عملة الفاتورة المرتبطة بها (لا يوجد أي تحويل تلقائي بين الدينار والدولار)
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
    currency: inv.currency === 'USD' ? 'USD' : 'IQD',
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

// تسديد (كلي أو جزئي) للرصيد القديم (الحساب السابق) — على عكس التعديل اليدوي من نموذج بيانات العميل،
// هذا يسجّل "حركة" فعلية في سجل الدفعات، حتى يبقى أثرها ظاهراً في كشف حساب العميل حتى بعد تسديد الرصيد بالكامل
function settleOpeningBalance(customerId, currency, amount, date, notes, batchId) {
  const c = getCustomer(customerId);
  if (!c) return { ok: false, reason: 'customer_not_found' };
  const field = currency === 'USD' ? 'openingBalanceUsd' : 'openingBalance';
  const amt = Number(amount) || 0;
  if (amt <= 0) return { ok: false, reason: 'invalid_amount' };
  const newBalance = (Number(c[field]) || 0) - amt;
  c[field] = newBalance;
  const payment = {
    id: uid('pay'),
    invoiceId: null,
    invoiceType: 'opening',
    invoiceNumber: null,
    customerId,
    amount: amt,
    currency: currency === 'USD' ? 'USD' : 'IQD',
    date: date || nowIso(),
    notes: notes || '',
    batchId: batchId || null,
    createdAt: nowIso(),
  };
  cache.payments.push(payment);
  persist();
  return { ok: true, payment, customer: c };
}

// ---------- المستحقات ----------
// كل عميل له حسابان مستقلان تماماً: بالدينار (theyOweUs/weOweThem) وبالدولار (theyOweUsUsd/weOweThemUsd)
function getDuesSummary() {
  const byCustomer = {};
  for (const c of cache.customers) {
    const opening = Number(c.openingBalance) || 0;
    const openingUsd = Number(c.openingBalanceUsd) || 0;
    byCustomer[c.id] = {
      customerId: c.id,
      customerName: c.name,
      theyOweUs: opening > 0 ? opening : 0, // مستحق لنا بالدينار من فواتير البيع + رصيد سابق
      weOweThem: opening < 0 ? -opening : 0, // مستحق علينا بالدينار من فواتير الشراء + رصيد سابق
      theyOweUsUsd: openingUsd > 0 ? openingUsd : 0, // مستحق لنا بالدولار
      weOweThemUsd: openingUsd < 0 ? -openingUsd : 0, // مستحق علينا بالدولار
    };
  }
  for (const inv of cache.saleInvoices) {
    const remaining = inv.total - inv.paidAmount;
    if (remaining > 0.0001) {
      if (!byCustomer[inv.customerId]) continue;
      if (inv.currency === 'USD') byCustomer[inv.customerId].theyOweUsUsd += remaining;
      else byCustomer[inv.customerId].theyOweUs += remaining;
    }
  }
  for (const inv of cache.purchaseInvoices) {
    const remaining = inv.total - inv.paidAmount;
    if (remaining > 0.0001) {
      if (!byCustomer[inv.customerId]) continue;
      if (inv.currency === 'USD') byCustomer[inv.customerId].weOweThemUsd += remaining;
      else byCustomer[inv.customerId].weOweThem += remaining;
    }
  }
  return Object.values(byCustomer).filter(
    (c) => c.theyOweUs > 0.0001 || c.weOweThem > 0.0001 || c.theyOweUsUsd > 0.0001 || c.weOweThemUsd > 0.0001
  );
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
      currency: inv.currency || 'IQD',
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
      currency: inv.currency || 'IQD',
      label: 'فاتورة شراء رقم ' + inv.number,
    });
  }
  for (const p of cache.payments) {
    let kind = 'purchase_payment';
    let label = 'دفعة على فاتورة شراء ' + p.invoiceNumber;
    if (p.invoiceType === 'sale') {
      kind = 'sale_payment';
      label = 'دفعة على فاتورة بيع ' + p.invoiceNumber;
    } else if (p.invoiceType === 'opening') {
      kind = 'opening_payment';
      label = 'تسديد رصيد قديم';
    }
    events.push({
      kind,
      id: p.id,
      date: p.date,
      customerId: p.customerId,
      amount: p.amount,
      currency: p.currency || 'IQD',
      label,
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
  next.customers.forEach((c) => {
    if (c.openingBalance === undefined) c.openingBalance = 0;
    if (c.openingBalanceUsd === undefined) c.openingBalanceUsd = 0;
    if (c.dealsInUsd === undefined) c.dealsInUsd = false;
    if (c.openingBalanceOriginal === undefined) c.openingBalanceOriginal = c.openingBalance;
    if (c.openingBalanceUsdOriginal === undefined) c.openingBalanceUsdOriginal = c.openingBalanceUsd;
  });
  next.saleInvoices.forEach((i) => { if (i.currency !== 'USD') i.currency = 'IQD'; });
  next.purchaseInvoices.forEach((i) => { if (i.currency !== 'USD') i.currency = 'IQD'; });
  next.payments.forEach((p) => { if (p.currency !== 'USD') p.currency = 'IQD'; });
  cache = next;
  persist();
  return cache;
}

// ---------- لوحة التحكم ----------
function getDashboardSummary() {
  const totalSales = cache.saleInvoices.filter((i) => i.currency !== 'USD').reduce((s, i) => s + i.total, 0);
  const totalSalesUsd = cache.saleInvoices.filter((i) => i.currency === 'USD').reduce((s, i) => s + i.total, 0);
  const totalPurchases = cache.purchaseInvoices.filter((i) => i.currency !== 'USD').reduce((s, i) => s + i.total, 0);
  const totalPurchasesUsd = cache.purchaseInvoices.filter((i) => i.currency === 'USD').reduce((s, i) => s + i.total, 0);
  const dues = getDuesSummary();
  const totalTheyOweUs = dues.reduce((s, d) => s + d.theyOweUs, 0);
  const totalWeOweThem = dues.reduce((s, d) => s + d.weOweThem, 0);
  const totalTheyOweUsUsd = dues.reduce((s, d) => s + d.theyOweUsUsd, 0);
  const totalWeOweThemUsd = dues.reduce((s, d) => s + d.weOweThemUsd, 0);
  return {
    customersCount: cache.customers.length,
    saleInvoicesCount: cache.saleInvoices.length,
    purchaseInvoicesCount: cache.purchaseInvoices.length,
    totalSales,
    totalSalesUsd,
    totalPurchases,
    totalPurchasesUsd,
    totalTheyOweUs,
    totalWeOweThem,
    totalTheyOweUsUsd,
    totalWeOweThemUsd,
  };
}

// ---------- مسح جميع البيانات (إعادة ضبط) ----------
// يمسح العملاء والفواتير والتسديدات ويصفّر عدّادات الفواتير — لكن يُبقي على إعدادات المنشأة
// (الاسم/الشعار/الترخيص/إعدادات النسخ الاحتياطي...) كما هي دون أي تغيير.
function clearAllData() {
  // نسخة أمان صريحة قبل المسح، باسم لا يتقاطع مع دورة النسخ التلقائي العادية —
  // لأن المسح نفسه سيُطلق autoBackup() بعده مباشرةً والذي سيكتب النسخة اليومية بالحالة الفارغة الجديدة
  try {
    const snapshot = JSON.stringify(cache, null, 2);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dirs = [AUTO_BACKUP_DIR];
    const customDir = cache && cache.settings && cache.settings.autoBackupCustomDir;
    if (customDir && customDir !== AUTO_BACKUP_DIR) dirs.push(customDir);
    dirs.forEach((dir) => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'before-clear-all-' + stamp + '.json'), snapshot, 'utf-8');
      } catch (_) {}
    });
  } catch (_) {}

  const preservedSettings = Object.assign({}, cache.settings, {
    saleInvoiceCounter: 0,
    purchaseInvoiceCounter: 0,
  });
  cache = defaultData();
  cache.settings = preservedSettings;
  persist();
  return cache;
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
  settleOpeningBalance,
  getDuesSummary,
  getHistory,
  getDashboardSummary,
  restoreAll,
  clearAllData,
  getAutoBackupDir,
  getDefaultAutoBackupDir,
};
