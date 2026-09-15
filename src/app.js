/* =========================================================
   app.js — منطق واجهة المستخدم (renderer)
   يعتمد فقط على window.api المُعرَّف في preload.js
   ========================================================= */

const STATE = {
  view: 'dashboard',
  settings: null,
  customersCache: [],
};

// ---------------- أدوات مساعدة عامة ----------------
function qs(sel, root) { return (root || document).querySelector(sel); }
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach((k) => {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  });
  (children || []).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}
function applyBrandLogo() {
  const mark = qs('#brandMark');
  if (!mark) return;
  const logo = STATE.settings && STATE.settings.companyLogo;
  if (logo) {
    mark.innerHTML = '';
    mark.appendChild(el('img', { src: logo, alt: 'شعار المنشأة' }));
  } else {
    mark.textContent = 'ف';
  }
}
function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
// ---------------- حقول المبالغ بفواصل الآلاف ----------------
function parseMoneyStr(s) {
  return Number(String(s === undefined || s === null ? '' : s).replace(/,/g, '')) || 0;
}
function numVal(input) {
  return parseMoneyStr(input && input.value);
}
function formatMoneyInputStr(raw) {
  let s = String(raw === undefined || raw === null ? '' : raw).replace(/[^\d.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  const parts = s.split('.');
  let intPart = parts[0].replace(/^0+(?=\d)/, '');
  const decPart = parts.length > 1 ? '.' + parts[1].slice(0, 2) : '';
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return intPart + decPart;
}
function moneyInput(attrs) {
  const a = Object.assign({}, attrs || {});
  const initial = a.value;
  delete a.value;
  a.type = 'text';
  a.inputmode = 'decimal';
  const input = el('input', a);
  input.value = formatMoneyInputStr(initial);
  input.addEventListener('input', () => {
    const fromEnd = input.value.length - (input.selectionStart || 0);
    input.value = formatMoneyInputStr(input.value);
    const pos = Math.max(0, input.value.length - fromEnd);
    input.setSelectionRange(pos, pos);
  });
  return input;
}
function moneyField(name, label, value) {
  const input = moneyInput({ class: 'input', 'data-field': name, value: value || 0 });
  return el('div', { class: 'field' }, [el('label', {}, [label]), input]);
}
// ---------------- حقل مبلغ تسديد بعملة ثابتة (بدون أي تحويل تلقائي) ----------------
// يُستخدم لتسديد فاتورة/رصيد سابق بعينه؛ العملة دائماً هي عملة الفاتورة نفسها (لا تحويل بين الدينار والدولار).
function buildPaymentAmountBlock(labelText, defaultAmount, currency, maxAmount) {
  const cur = currency === 'USD' ? 'USD' : 'IQD';
  const amountInput = moneyInput({ class: 'input', placeholder: 'أدخل المبلغ', value: defaultAmount || '' });
  const wrap = el('div', { class: 'field' }, [el('label', {}, [labelText + ' (' + currencyLabel(cur) + ')']), amountInput]);
  return {
    nodes: [wrap],
    getResult: () => {
      const amount = numVal(amountInput);
      if (amount <= 0) return { error: 'أدخل مبلغاً صحيحاً' };
      if (maxAmount !== undefined && maxAmount !== null && amount > maxAmount + 0.0001) {
        return { error: 'المبلغ المدخل (' + formatMoney(amount, cur) + ') أكبر من المبلغ المستحق (' + formatMoney(maxAmount, cur) + ')' };
      }
      return { amount, currency: cur };
    },
  };
}
// عنوان قصير للعملة يُعرض داخل النماذج والجداول
function currencyLabel(cur) {
  if (cur === 'USD') return 'دولار $';
  return (STATE.settings && STATE.settings.currency) || 'دينار';
}
function decimalsForCurrency(cur) {
  if (cur === 'USD') return 2;
  // الدينار العراقي عملياً بلا كسور (لا تُستخدم الفلوس في التعاملات اليومية)
  const label = (STATE.settings && STATE.settings.currency) || '';
  return label === 'د.ع' ? 0 : 2;
}
function formatMoney(n, currency) {
  const cur = currency === 'USD' ? 'USD' : 'IQD';
  const val = Number(n || 0);
  const d = decimalsForCurrency(cur);
  const numStr = val.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (cur === 'USD') return '$' + numStr;
  const label = (STATE.settings && STATE.settings.currency) || '';
  return numStr + ' ' + label;
}
// ---------------- واتساب: إرسال كشف الحساب مباشرة للعميل ----------------
// يحوّل رقم الهاتف المحلي (مهما كانت صيغته) إلى صيغة دولية عراقية (964) بدون '+' أو أصفار زائدة،
// كما يتطلبها رابط wa.me
function normalizeIraqPhoneForWhatsapp(rawPhone) {
  let digits = String(rawPhone || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('00964')) digits = digits.slice(2); // 00964xxxxxxxxxx -> 964xxxxxxxxxx
  else if (digits.startsWith('964')) { /* بالفعل بالصيغة الدولية */ }
  else if (digits.startsWith('0')) digits = '964' + digits.slice(1); // 07xxxxxxxxx -> 9647xxxxxxxxx
  else digits = '964' + digits; // 7xxxxxxxxx بدون صفر أو رمز دولة -> إضافة رمز العراق
  // رقم عراقي كامل بصيغة 964 + 10 أرقام = 13 رقماً على الأقل بشكل معقول
  if (digits.length < 12 || digits.length > 15) return null;
  return digits;
}

function buildCustomerStatementMessage(customer, balIqd, balUsd) {
  const companyName = (STATE.settings && STATE.settings.companyName) || '';
  const lines = [];
  lines.push('كشف حساب' + (companyName ? ' — ' + companyName : ''));
  lines.push('العميل: ' + (customer.name || ''));
  lines.push('');
  const addBalanceLine = (bal, cur) => {
    if (Math.abs(bal) < 0.001) return;
    const who = bal > 0 ? 'المبلغ المستحق لنا' : 'المبلغ المستحق لكم';
    lines.push(who + ' بـ' + currencyLabel(cur) + ': ' + formatMoney(Math.abs(bal), cur));
  };
  addBalanceLine(balIqd, 'IQD');
  addBalanceLine(balUsd, 'USD');
  if (Math.abs(balIqd) < 0.001 && Math.abs(balUsd) < 0.001) {
    lines.push('الحساب مسدد بالكامل، لا يوجد أي مبلغ مستحق. شكراً لتعاملكم معنا.');
  } else {
    lines.push('');
    lines.push('نرجو مراجعة كشف الحساب أعلاه، ولأي استفسار نحن بالخدمة.');
  }
  return lines.join('\n');
}

async function sendCustomerStatementViaWhatsapp(customer, balIqd, balUsd) {
  const phone = normalizeIraqPhoneForWhatsapp(customer.phone);
  if (!phone) { toast('لا يوجد رقم هاتف صحيح مسجّل لهذا العميل', true); return; }
  const text = buildCustomerStatementMessage(customer, balIqd, balUsd);
  const url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  await window.api.system.openExternal(url);
}

function formatDate(iso, withTime) {
  if (!iso) return '—';
  const d = new Date(iso);
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return d.toLocaleString('en-GB', opts);
}
function todayInputValue() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function dateInputToISONow(value) {
  // value هو "YYYY-MM-DD" من <input type="date"> — نأخذ اليوم/الشهر/السنة من الحقل، ونأخذ
  // الساعة/الدقيقة/الثانية من الوقت الفعلي بالجهاز لحظة الاستدعاء (بدل تثبيتها على منتصف الليل)
  // — تُستخدم عند إنشاء الفواتير وتسجيل التسديدات لتُسجَّل لحظة الضغط الحقيقية دون حقل وقت يدوي
  const now = new Date();
  if (!value) return now.toISOString();
  const [y, m, d] = value.split('-').map(Number);
  const local = new Date(y, (m || 1) - 1, d || 1, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return local.toISOString();
}
function toast(msg, isError) {
  const root = qs('#toastRoot');
  const t = el('div', { class: 'toast' + (isError ? ' error' : '') }, [msg]);
  root.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function customerName(id) {
  const c = STATE.customersCache.find((x) => x.id === id);
  return c ? c.name : 'غير معروف';
}

// ---------------- التنقل بين الصفحات ----------------
const VIEW_TITLES = {
  dashboard: 'لوحة التحكم',
  customers: 'العملاء',
  sales: 'فواتير البيع',
  purchases: 'فواتير الشراء',
  dues: 'تسديد العملاء',
  history: 'السجل والتاريخ',
  settings: 'الإعدادات',
  about: 'عن البرنامج',
};

async function navigate(view) {
  STATE.view = view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  qs('#pageTitle').textContent = VIEW_TITLES[view] || '';
  qs('#topbarActions').innerHTML = '';
  const area = qs('#viewArea');
  area.innerHTML = '<div class="empty-state">جارِ التحميل…</div>';
  try {
    if (view === 'dashboard') await renderDashboard(area);
    else if (view === 'customers') await renderCustomers(area);
    else if (view === 'sales') await renderInvoices(area, 'sale');
    else if (view === 'purchases') await renderInvoices(area, 'purchase');
    else if (view === 'dues') await renderDues(area);
    else if (view === 'history') await renderHistory(area);
    else if (view === 'settings') await renderSettings(area);
    else if (view === 'about') await renderAbout(area);
  } catch (err) {
    console.error(err);
    area.innerHTML = '';
    area.appendChild(el('div', { class: 'empty-state' }, [
      el('div', { class: 'es-title' }, ['حدث خطأ غير متوقع']),
      el('div', {}, [String(err && err.message ? err.message : err)]),
    ]));
  }
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

// ---------------- لوحة التحكم ----------------
async function renderDashboard(area) {
  const [summary, history] = await Promise.all([
    window.api.dashboard.summary(),
    window.api.history.get(),
  ]);
  area.innerHTML = '';

  const grid = el('div', { class: 'stat-grid' }, [
    statCard('عدد العملاء', summary.customersCount, ''),
    statCard('المبيعات (دينار)', formatMoney(summary.totalSales, 'IQD'), ''),
    statCard('المبيعات (دولار)', formatMoney(summary.totalSalesUsd, 'USD'), ''),
    statCard('الباقي من العملاء (دينار)', formatMoney(summary.totalTheyOweUs, 'IQD'), 'owed-us'),
    statCard('الباقي من العملاء (دولار)', formatMoney(summary.totalTheyOweUsUsd, 'USD'), 'owed-us'),
  ]);
  area.appendChild(grid);

  area.appendChild(el('div', { class: 'section-title' }, ['آخر الحركات']));
  const recent = history.slice(0, 10);
  if (recent.length === 0) {
    area.appendChild(emptyState('لا توجد حركات بعد', 'ابدأ بإضافة عميل ثم أنشئ أول فاتورة بيع أو شراء.'));
    return;
  }
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      el('th', {}, ['التاريخ']), el('th', {}, ['العميل']), el('th', {}, ['الحركة']), el('th', {}, ['المبلغ']),
    ])]),
  ]);
  const tbody = el('tbody');
  recent.forEach((h) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [formatDate(h.date, true)]),
      el('td', {}, [customerName(h.customerId)]),
      el('td', {}, [h.label]),
      el('td', { class: 'num' }, [formatMoney(h.amount, h.currency)]),
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  area.appendChild(wrap);
}

function statCard(label, value, cls) {
  return el('div', { class: 'stat-card ' + (cls || '') }, [
    el('div', { class: 'stat-label' }, [label]),
    el('div', { class: 'stat-value' }, [String(value)]),
  ]);
}

function emptyState(title, sub, actionNode) {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'es-title' }, [title]),
    el('div', {}, [sub || '']),
    actionNode || null,
  ]);
}

// ---------------- العملاء ----------------
async function renderCustomers(area) {
  const customers = await window.api.customers.list();
  STATE.customersCache = customers;
  const [sales, purchases] = await Promise.all([window.api.invoices.listSale(), window.api.invoices.listPurchase()]);

  qs('#topbarActions').appendChild(el('button', { class: 'btn btn-primary', onclick: () => openCustomerForm() }, ['+ عميل جديد']));

  area.innerHTML = '';
  const toolbar = el('div', { class: 'toolbar' });
  const search = el('input', { class: 'input search-input', placeholder: 'ابحث بالاسم أو رقم الهاتف…' });
  toolbar.appendChild(search);
  area.appendChild(toolbar);

  const wrap = el('div', { class: 'table-wrap' });
  area.appendChild(wrap);

  function balanceFor(id) {
    let theyOweUs = 0, weOweThem = 0, theyOweUsUsd = 0, weOweThemUsd = 0;
    const c = customers.find((x) => x.id === id);
    const opening = (c && Number(c.openingBalance)) || 0;
    const openingUsd = (c && Number(c.openingBalanceUsd)) || 0;
    if (opening > 0) theyOweUs += opening;
    else if (opening < 0) weOweThem += -opening;
    if (openingUsd > 0) theyOweUsUsd += openingUsd;
    else if (openingUsd < 0) weOweThemUsd += -openingUsd;
    sales.filter((i) => i.customerId === id).forEach((i) => {
      if (i.currency === 'USD') theyOweUsUsd += i.total - i.paidAmount;
      else theyOweUs += i.total - i.paidAmount;
    });
    purchases.filter((i) => i.customerId === id).forEach((i) => {
      if (i.currency === 'USD') weOweThemUsd += i.total - i.paidAmount;
      else weOweThem += i.total - i.paidAmount;
    });
    return { theyOweUs, weOweThem, theyOweUsUsd, weOweThemUsd };
  }

  let customersPage = 1;
  function draw(list) {
    wrap.innerHTML = '';
    if (list.length === 0) {
      wrap.appendChild(emptyState('لا يوجد عملاء', 'اضغط على "عميل جديد" لإضافة أول عميل.'));
      return;
    }
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (customersPage > totalPages) customersPage = totalPages;
    const pageList = list.slice((customersPage - 1) * PAGE_SIZE, customersPage * PAGE_SIZE);
    const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
      el('th', {}, ['الاسم']), el('th', {}, ['الهاتف']), el('th', {}, ['العنوان']),
      el('th', {}, ['الباقي (دينار)']), el('th', {}, ['الباقي (دولار)']), el('th', {}, ['إجراءات']),
    ])])]);
    const tbody = el('tbody');
    pageList.forEach((c) => {
      const bal = balanceFor(c.id);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [c.name, c.dealsInUsd ? el('span', { class: 'badge-usd' }, [' $']) : null]),
        el('td', {}, [c.phone || '—']),
        el('td', {}, [c.address || '—']),
        el('td', { class: 'num' }, [bal.theyOweUs > 0.001 ? el('span', { class: 'amt-us' }, [formatMoney(bal.theyOweUs, 'IQD')]) : '—']),
        el('td', { class: 'num' }, [bal.theyOweUsUsd > 0.001 ? el('span', { class: 'amt-us' }, [formatMoney(bal.theyOweUsUsd, 'USD')]) : '—']),
        el('td', {}, [rowActions([
          ['بيع', () => openInvoiceForm('sale', null, c.id, () => navigate('customers'))],
          ['تسديد', () => quickSettleForCustomer(c.id)],
          ['عرض', () => openCustomerProfile(c.id)],
          ['تعديل', () => openCustomerForm(c)],
          ['حذف', () => deleteCustomer(c.id)],
        ])]),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    const pager = buildPager(customersPage, totalPages, (p) => { customersPage = p; draw(list); });
    if (pager) wrap.appendChild(pager);
  }
  draw(customers);
  search.addEventListener('input', () => {
    customersPage = 1;
    const q = search.value.trim().toLowerCase();
    draw(customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)));
  });
}

const PAGE_SIZE = 20; // بعد هذا العدد من الصفوف تتحوّل القائمة إلى صفحات

// شريط تنقل بين الصفحات — يُستخدم في كل الجداول الطويلة (فواتير، عملاء، سجل)
function buildPager(page, totalPages, onChange) {
  if (totalPages <= 1) return null;
  const bar = el('div', { class: 'pager' });
  const btn = (label, target, disabled, active) => el('button', {
    class: 'btn btn-ghost btn-sm pager-btn' + (active ? ' active' : ''),
    disabled: disabled ? true : undefined,
    onclick: disabled ? undefined : () => onChange(target),
  }, [label]);

  bar.appendChild(btn('‹ السابق', page - 1, page <= 1));

  const pages = [];
  const add = (n) => { if (n >= 1 && n <= totalPages && !pages.includes(n)) pages.push(n); };
  add(1); add(totalPages);
  for (let p = page - 1; p <= page + 1; p++) add(p);
  pages.sort((a, b) => a - b);

  let prevShown = 0;
  pages.forEach((p) => {
    if (p - prevShown > 1) bar.appendChild(el('span', { class: 'pager-ellipsis' }, ['…']));
    bar.appendChild(btn(String(p), p, false, p === page));
    prevShown = p;
  });

  bar.appendChild(btn('التالي ›', page + 1, page >= totalPages));
  bar.appendChild(el('span', { class: 'pager-info' }, ['(إجمالي ' + totalPages + ' صفحة)']));
  return bar;
}

function rowActions(pairs) {
  const wrap = el('div', { class: 'row-actions' });
  pairs.forEach(([label, fn]) => {
    wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm', onclick: fn }, [label]));
  });
  return wrap;
}

function openCustomerForm(existing) {
  const isEdit = !!existing;
  const dealsInUsdInput = el('input', { type: 'checkbox', id: 'custDealsInUsd', checked: existing && existing.dealsInUsd ? true : undefined });
  const body = el('div', { class: 'form-grid' }, [
    field('name', 'الاسم *', existing && existing.name),
    field('phone', 'رقم الهاتف', existing && existing.phone),
    moneyField('openingBalance', 'الحساب القديم بالدينار', existing && existing.openingBalance ? existing.openingBalance : ''),
    moneyField('openingBalanceUsd', 'الحساب القديم بالدولار', existing && existing.openingBalanceUsd ? existing.openingBalanceUsd : ''),
    fieldFull('address', 'العنوان', existing && existing.address),
    fieldFull('notes', 'ملاحظات', existing && existing.notes, true),
    el('div', { class: 'field field-full', style: 'flex-direction:row;align-items:center;gap:8px' }, [
      dealsInUsdInput,
      el('label', { for: 'custDealsInUsd' }, ['هذا العميل يتعامل بالدولار عادةً']),
    ]),
  ]);
  const hint = el('div', { class: 'field-hint field-full' }, ['حساب الدينار وحساب الدولار مستقلان تماماً عن بعضهما، بدون أي تحويل تلقائي بينهما. أدخل رقماً موجباً إذا كان للعميل دين من قبل استخدام البرنامج، أو سالباً إذا كنتم مدينين له، واتركه فارغاً إن لم يوجد. أما الحساب الجديد فيُحسب تلقائياً من الفواتير والتسديدات التي تسجّلها داخل البرنامج لكل عملة على حدة.']);
  body.insertBefore(hint, body.children[4]);
  const usdHint = el('div', { class: 'field-hint' }, ['عند التفعيل، ستُقترح عملة الدولار تلقائياً كافتراضي عند إنشاء فاتورة جديدة لهذا العميل.']);
  body.appendChild(usdHint);
  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const data = readFields(body, ['name', 'phone', 'address', 'notes', 'openingBalance', 'openingBalanceUsd']);
      if (!data.name.trim()) { toast('الاسم مطلوب', true); return; }
      data.openingBalance = parseMoneyStr(data.openingBalance);
      data.openingBalanceUsd = parseMoneyStr(data.openingBalanceUsd);
      data.dealsInUsd = dealsInUsdInput.checked;
      if (isEdit) await window.api.customers.update(existing.id, data);
      else await window.api.customers.add(data);
      closeModal();
      toast(isEdit ? 'تم تحديث بيانات العميل' : 'تمت إضافة العميل');
      navigate('customers');
    }}, [isEdit ? 'حفظ التعديلات' : 'إضافة العميل']),
    el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إلغاء']),
  ];
  openModal(isEdit ? 'تعديل بيانات العميل' : 'عميل جديد', body, footer);
}

async function deleteCustomer(id) {
  if (!(await confirmModal('هل تريد حذف هذا العميل؟'))) return;
  const res = await window.api.customers.delete(id);
  if (!res.ok) {
    toast('لا يمكن حذف عميل مرتبط بفواتير موجودة', true);
    return;
  }
  toast('تم حذف العميل');
  navigate('customers');
}

async function quickSettleForCustomer(customerId, onDone) {
  const finish = onDone || (() => navigate('customers'));
  const [sales, purchases, customer] = await Promise.all([
    window.api.invoices.listSale(),
    window.api.invoices.listPurchase(),
    window.api.customers.get(customerId),
  ]);
  const dueSales = sales.filter((i) => i.customerId === customerId && (i.total - i.paidAmount) > 0.001)
    .map((i) => ({ type: 'sale', inv: i, currency: i.currency === 'USD' ? 'USD' : 'IQD' }));
  const duePurchases = purchases.filter((i) => i.customerId === customerId && (i.total - i.paidAmount) > 0.001)
    .map((i) => ({ type: 'purchase', inv: i, currency: i.currency === 'USD' ? 'USD' : 'IQD' }));
  const dueList = [...dueSales, ...duePurchases];
  const openingDue = customer && Number(customer.openingBalance) > 0.001 ? Number(customer.openingBalance) : 0;
  if (openingDue) dueList.push({ type: 'opening', customer, amount: openingDue, currency: 'IQD' });
  const openingDueUsd = customer && Number(customer.openingBalanceUsd) > 0.001 ? Number(customer.openingBalanceUsd) : 0;
  if (openingDueUsd) dueList.push({ type: 'opening', customer, amount: openingDueUsd, currency: 'USD' });

  if (dueList.length === 0) {
    toast('لا توجد مبالغ مستحقة لهذا العميل', true);
    return;
  }
  if (dueList.length === 1) {
    const item = dueList[0];
    if (item.type === 'opening') openOpeningBalanceSettleForm(item.customer, item.currency, finish);
    else openPaymentForm(item.type, item.inv, finish);
    return;
  }

  // حساب الدينار وحساب الدولار مستقلان تماماً؛ لا يمكن تسديد مبلغ واحد يغطي بنوداً من عملتين مختلفتين
  const getRemaining = (item) => (item.type === 'opening' ? item.amount : (item.inv.total - item.inv.paidAmount));
  const iqdItems = dueList.filter((i) => i.currency === 'IQD');
  const usdItems = dueList.filter((i) => i.currency === 'USD');

  function buildTotalSettleBlock(items, currency) {
    if (items.length === 0) return null;
    const grandTotal = items.reduce((sum, item) => sum + getRemaining(item), 0);
    const sorted = items.slice().sort((a, b) => {
      if (a.type === 'opening') return -1;
      if (b.type === 'opening') return 1;
      return new Date(a.inv.date) - new Date(b.inv.date);
    });
    const amountBlock = buildPaymentAmountBlock('المبلغ المدفوع الآن (من المجموع)', undefined, currency, grandTotal);
    const dateInput = el('input', { class: 'input', type: 'date', value: todayInputValue() });
    const notesInput = el('textarea', { class: 'input', rows: 2 });
    const settle = async () => {
      const result = amountBlock.getResult();
      if (result.error) { toast(result.error, true); return; }
      let leftover = result.amount;
      const paymentDate = dateInputToISONow(dateInput.value);
      const notes = notesInput.value;
      const batchId = 'batch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      for (const item of sorted) {
        if (leftover <= 0.001) break;
        const remaining = getRemaining(item);
        if (remaining <= 0.001) continue;
        const applied = Math.min(leftover, remaining);
        if (item.type === 'opening') {
          await window.api.payments.settleOpening(item.customer.id, currency, applied, paymentDate, notes, batchId);
        } else {
          await window.api.payments.add({
            invoiceId: item.inv.id,
            invoiceType: item.type,
            amount: applied,
            date: paymentDate,
            notes,
            batchId,
          });
        }
        leftover -= applied;
      }
      closeModal();
      toast('تم تسجيل التسديد');
      finish();
    };
    return el('div', {}, [
      el('div', { class: 'section-title' }, ['المستحق بـ' + currencyLabel(currency)]),
      el('div', { class: 'form-grid' }, [
        el('div', { class: 'field field-full' }, [el('label', {}, ['المجموع الكلي المستحق']), el('div', { style: 'font-weight:700;font-size:1.1em' }, [formatMoney(grandTotal, currency)])]),
      ]),
      el('div', { class: 'form-grid' }, [
        ...amountBlock.nodes,
        el('div', { class: 'field' }, [el('label', {}, ['تاريخ الدفعة']), dateInput]),
        el('div', { class: 'field field-full' }, [el('label', {}, ['ملاحظات']), notesInput]),
        el('div', { class: 'field field-full' }, [el('button', { class: 'btn btn-primary', onclick: settle }, ['تسديد من مجموع ' + currencyLabel(currency)])]),
      ]),
    ]);
  }

  const totalBlocks = [buildTotalSettleBlock(iqdItems, 'IQD'), buildTotalSettleBlock(usdItems, 'USD')].filter(Boolean);

  const body = el('div', {}, [
    ...totalBlocks,
    el('div', { class: 'section-title' }, ['أو اختر بنداً محدداً للتسديد']),
    el('div', { class: 'table-wrap' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', {}, ['البند']), el('th', {}, ['النوع']), el('th', {}, ['العملة']), el('th', {}, ['المتبقي']), el('th', {}, ['']),
        ])]),
        el('tbody', {}, dueList.map((item) => {
          const isOpening = item.type === 'opening';
          const label = isOpening ? 'حساب قديم' : item.inv.number;
          const typeLabel = isOpening ? '—' : (item.type === 'sale' ? 'بيع' : 'شراء');
          const amount = getRemaining(item);
          return el('tr', {}, [
            el('td', {}, [label]),
            el('td', {}, [typeLabel]),
            el('td', {}, [currencyLabel(item.currency)]),
            el('td', { class: 'num' }, [formatMoney(amount, item.currency)]),
            el('td', {}, [el('button', {
              class: 'btn btn-primary btn-sm',
              onclick: () => {
                closeModal();
                if (isOpening) openOpeningBalanceSettleForm(item.customer, item.currency, finish);
                else openPaymentForm(item.type, item.inv, finish);
              },
            }, ['تسديد'])]),
          ]);
        })),
      ]),
    ]),
  ]);
  openModal('اختر البند المراد تسديده', body, [el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إلغاء'])], true);
}

function openOpeningBalanceSettleForm(customer, currency, onDone) {
  const cur = currency === 'USD' ? 'USD' : 'IQD';
  const field = cur === 'USD' ? 'openingBalanceUsd' : 'openingBalance';
  const amountBlock = buildPaymentAmountBlock('المبلغ المسدد', customer[field], cur, Number(customer[field]) > 0 ? Number(customer[field]) : null);
  const body = el('div', { class: 'form-grid' }, [...amountBlock.nodes]);
  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const result = amountBlock.getResult();
      if (result.error) { toast(result.error, true); return; }
      await window.api.payments.settleOpening(customer.id, cur, result.amount, new Date().toISOString(), '');
      closeModal();
      toast('تم تسجيل تسديد الرصيد السابق');
      if (onDone) onDone();
    }}, ['تسجيل التسديد']),
    el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إلغاء']),
  ];
  openModal('تسديد الحساب القديم بـ' + currencyLabel(cur) + ' — ' + customer.name, body, footer);
}

async function openCustomerProfile(id) {
  const [customer, sales, payments] = await Promise.all([
    window.api.customers.get(id),
    window.api.invoices.listSale(),
    window.api.payments.list(),
  ]);
  const mySales = sales.filter((i) => i.customerId === id);
  const myPayments = payments.filter((p) => p.customerId === id);

  const ledgerIqd = buildCustomerLedger(customer, mySales, myPayments, 'IQD');
  const ledgerUsd = buildCustomerLedger(customer, mySales, myPayments, 'USD');
  const balIqd = ledgerIqd.length ? ledgerIqd[ledgerIqd.length - 1].balance : 0;
  const balUsd = ledgerUsd.length ? ledgerUsd[ledgerUsd.length - 1].balance : 0;
  const balStatCard = (label, bal, cur) => {
    const settled = Math.abs(bal) < 0.001;
    const cls = settled ? '' : (bal > 0 ? 'owed-us' : 'owed-them');
    const value = settled ? 'مسدد بالكامل ✓' : formatMoney(Math.abs(bal), cur) + (bal > 0 ? ' — مستحق لنا' : ' — مستحق عليكم');
    return statCard(label, value, cls);
  };

  const body = el('div', {}, [
    el('div', { class: 'form-grid' }, [
      infoLine('الهاتف', customer.phone || '—'),
      infoLine('العنوان', customer.address || '—'),
    ]),
    el('div', { class: 'stat-grid', style: 'margin-top:6px' }, [
      balStatCard('الرصيد الحالي بالدينار', balIqd, 'IQD'),
      balStatCard('الرصيد الحالي بالدولار', balUsd, 'USD'),
    ]),
    el('div', { class: 'section-title' }, ['دفتر حساب الدينار (بيع وتسديد)']),
    customerLedgerTable(ledgerIqd.slice().reverse(), 'IQD'),
    el('div', { class: 'section-title' }, ['دفتر حساب الدولار (بيع وتسديد)']),
    customerLedgerTable(ledgerUsd.slice().reverse(), 'USD'),
  ]);
  const footer = [
    el('button', { class: 'btn btn-primary', onclick: () => { closeModal(); printCustomerStatement(customer.id); } }, ['🖨 طباعة كشف حساب']),
    el('button', { class: 'btn btn-ghost', onclick: () => sendCustomerStatementViaWhatsapp(customer, balIqd, balUsd) }, ['💬 إرسال عبر واتساب']),
    el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إغلاق']),
  ];
  openModal('ملف العميل: ' + customer.name, body, footer, true);
}

// يبني سجل حركات العميل لعملة واحدة فقط (حساب قديم + فواتير بيع + تسديدات من نفس العملة) مرتباً بالتاريخ مع إجمالي متحرك
function buildCustomerLedger(customer, sales, payments, currency) {
  const cur = currency === 'USD' ? 'USD' : 'IQD';
  // القيمة الأصلية للرصيد القديم (لا تتغيّر عند التسديد) — تُستخدم لعرض بند "حساب قديم" حتى بعد تسديده بالكامل
  const openingOriginal = cur === 'USD'
    ? (Number(customer && (customer.openingBalanceUsdOriginal !== undefined ? customer.openingBalanceUsdOriginal : customer.openingBalanceUsd)) || 0)
    : (Number(customer && (customer.openingBalanceOriginal !== undefined ? customer.openingBalanceOriginal : customer.openingBalance)) || 0);
  const events = [];
  if (openingOriginal) {
    // sortDate تاريخ ثابت قديم جداً يضمن ظهور "حساب قديم" أول حركة بالترتيب دائماً، بينما date هو تاريخ العرض
    // الفعلي (تاريخ إضافة العميل) — بذلك يبقى الترتيب صحيحاً والتاريخ المعروض بالجدول منطقياً بنفس الوقت
    events.push({
      date: (customer && customer.createdAt) || new Date(0).toISOString(),
      sortDate: new Date(0).toISOString(),
      label: 'حساب قديم',
      amount: openingOriginal,
      kind: 'opening',
    });
  }
  // تسديدات الرصيد القديم (حركات مستقلة تُسجَّل عند التسديد، ولا تُحذف عند اكتمال السداد)
  const openingPayments = payments.filter((p) => p.invoiceType === 'opening' && (p.currency === 'USD' ? 'USD' : 'IQD') === cur);
  openingPayments.forEach((p) => {
    events.push({ date: p.date, label: 'تسديد رصيد قديم', amount: -(Number(p.amount) || 0), kind: 'payment' });
  });
  const salesInCur = sales.filter((i) => (i.currency === 'USD' ? 'USD' : 'IQD') === cur);
  salesInCur.forEach((i) => {
    events.push({ date: i.date, label: 'فاتورة بيع ' + i.number, amount: i.total, kind: 'invoice' });
    // أي مبلغ دُفع عند إنشاء/تعديل الفاتورة مباشرة (paidAmount) دون المرور بعملية "تسديد" منفصلة
    const paidViaPayments = payments
      .filter((p) => p.invoiceType === 'sale' && p.invoiceId === i.id)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const paidAtCreation = Math.max(0, (Number(i.paidAmount) || 0) - paidViaPayments);
    if (paidAtCreation > 0.001) {
      events.push({ date: i.date, label: 'دفعة عند البيع — فاتورة ' + i.number, amount: -paidAtCreation, kind: 'payment' });
    }
  });
  const salePayments = payments.filter((p) => p.invoiceType === 'sale' && (p.currency === 'USD' ? 'USD' : 'IQD') === cur);
  const batched = {};
  const single = [];
  salePayments.forEach((p) => {
    if (p.batchId) {
      if (!batched[p.batchId]) batched[p.batchId] = { date: p.date, amount: 0 };
      batched[p.batchId].amount += Number(p.amount) || 0;
    } else {
      single.push(p);
    }
  });
  single.forEach((p) => events.push({ date: p.date, label: 'تسديد — فاتورة ' + p.invoiceNumber, amount: -p.amount, kind: 'payment' }));
  Object.values(batched).forEach((b) => events.push({ date: b.date, label: 'تسديد (مجمّع)', amount: -b.amount, kind: 'payment' }));
  events.sort((a, b) => new Date(a.sortDate || a.date) - new Date(b.sortDate || b.date));
  let running = 0;
  return events.map((e) => {
    running += e.amount;
    return { date: e.date, label: e.label, amount: e.amount, kind: e.kind, balance: running };
  });
}

const LEDGER_KIND_BADGE = {
  opening: { label: 'حساب قديم', cls: 'badge-neutral' },
  invoice: { label: 'فاتورة بيع', cls: 'badge-invoice' },
  payment: { label: 'تسديد', cls: 'badge-payment' },
};

function customerLedgerTable(events, currency) {
  if (events.length === 0) return emptyState('لا توجد حركات بعد', 'لا توجد حركات بهذه العملة لهذا العميل بعد.');
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
    el('th', {}, ['التاريخ']), el('th', {}, ['النوع']), el('th', {}, ['البيان']),
    el('th', {}, ['مدين (له)']), el('th', {}, ['دائن (عليه)']), el('th', {}, ['الرصيد بعدها']),
  ])])]);
  const tbody = el('tbody');
  let totalDebit = 0, totalCredit = 0;
  events.forEach((e) => {
    const debit = e.amount > 0 ? e.amount : 0;
    const credit = e.amount < 0 ? -e.amount : 0;
    totalDebit += debit; totalCredit += credit;
    const badge = LEDGER_KIND_BADGE[e.kind] || LEDGER_KIND_BADGE.payment;
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [formatDate(e.date, true)]),
      el('td', {}, [el('span', { class: 'badge ' + badge.cls }, [badge.label])]),
      el('td', {}, [e.label]),
      el('td', { class: 'num' }, [debit > 0.001 ? el('span', { class: 'amt-us' }, [formatMoney(debit, currency)]) : '—']),
      el('td', { class: 'num' }, [credit > 0.001 ? el('span', { class: 'amt-them' }, [formatMoney(credit, currency)]) : '—']),
      el('td', { class: 'num' }, [Math.abs(e.balance) > 0.001 ? el('span', { class: e.balance >= 0 ? 'amt-us' : 'amt-them' }, [formatMoney(Math.abs(e.balance), currency)]) : formatMoney(0, currency)]),
    ]));
  });
  const tfoot = el('tfoot', {}, [el('tr', { class: 'ledger-totals-row' }, [
    el('td', { colspan: '3' }, ['الإجمالي']),
    el('td', { class: 'num' }, [el('span', { class: 'amt-us' }, [formatMoney(totalDebit, currency)])]),
    el('td', { class: 'num' }, [el('span', { class: 'amt-them' }, [formatMoney(totalCredit, currency)])]),
    el('td', {}, []),
  ])]);
  table.appendChild(tbody);
  table.appendChild(tfoot);
  wrap.appendChild(table);
  return wrap;
}

function paymentsHistoryTable(list) {
  if (list.length === 0) return emptyState('لا توجد تسديدات بعد', '');
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
    el('th', {}, ['التاريخ']), el('th', {}, ['نوع الفاتورة']), el('th', {}, ['رقم الفاتورة']), el('th', {}, ['المبلغ المسدد']), el('th', {}, ['العملة']), el('th', {}, ['ملاحظات']),
  ])])]);
  const tbody = el('tbody');
  list.forEach((p) => {
    const cur = p.currency === 'USD' ? 'USD' : 'IQD';
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [formatDate(p.date, true)]),
      el('td', {}, [p.invoiceType === 'sale' ? 'بيع (وارد منّا)' : 'شراء (صادر لنا)']),
      el('td', {}, [p.invoiceNumber]),
      el('td', { class: 'num' }, [formatMoney(p.amount, cur)]),
      el('td', {}, [cur === 'USD' ? 'دولار $' : ((STATE.settings && STATE.settings.currency) || 'دينار')]),
      el('td', {}, [p.notes || '—']),
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function miniInvoiceTable(list, type, onPaid) {
  if (list.length === 0) return emptyState('لا توجد فواتير', '');
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
    el('th', {}, ['رقم الفاتورة']), el('th', {}, ['التاريخ']), el('th', {}, ['الإجمالي']), el('th', {}, ['المتبقي']), el('th', {}, ['إجراءات']),
  ])])]);
  const tbody = el('tbody');
  const remClass = type === 'sale' ? 'amt-us' : 'amt-them';
  list.forEach((i) => {
    const cur = i.currency === 'USD' ? 'USD' : 'IQD';
    const remaining = i.total - i.paidAmount;
    const actions = [['🖨 طباعة', () => printInvoice(type, i.id)]];
    if (remaining > 0.001) actions.push(['تسديد', () => openPaymentForm(type, i, onPaid)]);
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [i.number + (cur === 'USD' ? ' $' : '')]), el('td', {}, [formatDate(i.date, true)]),
      el('td', { class: 'num' }, [formatMoney(i.total, cur)]),
      el('td', { class: 'num' }, [remaining > 0.001 ? el('span', { class: remClass }, [formatMoney(remaining, cur)]) : 'مسددة']),
      el('td', {}, [rowActions(actions)]),
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function infoLine(label, value) {
  return el('div', { class: 'field' }, [el('label', {}, [label]), el('div', {}, [value])]);
}

// ---------------- الفواتير (بيع/شراء) ----------------
async function renderInvoices(area, type) {
  const [invoices, customers] = await Promise.all([
    type === 'sale' ? window.api.invoices.listSale() : window.api.invoices.listPurchase(),
    window.api.customers.list(),
  ]);
  STATE.customersCache = customers;

  const addLabel = type === 'sale' ? '+ فاتورة بيع جديدة' : '+ فاتورة شراء جديدة';
  qs('#topbarActions').appendChild(el('button', {
    class: 'btn btn-primary',
    onclick: () => openInvoiceForm(type),
  }, [addLabel]));

  area.innerHTML = '';
  if (customers.length === 0) {
    area.appendChild(emptyState('أضف عميلاً أولاً', 'يجب إضافة عميل واحد على الأقل قبل إنشاء الفواتير.'));
    return;
  }

  const toolbar = el('div', { class: 'toolbar' });
  const custFilter = el('select', { class: 'input' }, [el('option', { value: '' }, ['كل العملاء'])]);
  customers.forEach((c) => custFilter.appendChild(el('option', { value: c.id }, [c.name])));
  const statusFilter = el('select', { class: 'input' }, [
    el('option', { value: '' }, ['كل الحالات']),
    el('option', { value: 'paid' }, ['مسددة بالكامل']),
    el('option', { value: 'partial' }, ['مسددة جزئياً']),
    el('option', { value: 'unpaid' }, ['غير مسددة']),
  ]);
  toolbar.appendChild(custFilter);
  toolbar.appendChild(statusFilter);
  area.appendChild(toolbar);

  const wrap = el('div', { class: 'table-wrap' });
  area.appendChild(wrap);

  function statusOf(inv) {
    const remaining = inv.total - inv.paidAmount;
    if (remaining <= 0.001) return 'paid';
    if (inv.paidAmount > 0.001) return 'partial';
    return 'unpaid';
  }
  function statusBadge(s) {
    if (s === 'paid') return el('span', { class: 'badge badge-paid' }, ['مسددة']);
    if (s === 'partial') return el('span', { class: 'badge badge-partial' }, ['جزئية']);
    return el('span', { class: 'badge badge-unpaid' }, ['غير مسددة']);
  }

  let invoicesPage = 1;
  function draw() {
    const custId = custFilter.value;
    const st = statusFilter.value;
    const list = invoices.filter((i) => (!custId || i.customerId === custId) && (!st || statusOf(i) === st));
    wrap.innerHTML = '';
    if (list.length === 0) {
      wrap.appendChild(emptyState('لا توجد فواتير', 'اضغط على "' + addLabel + '" لإنشاء أول فاتورة.'));
      return;
    }
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (invoicesPage > totalPages) invoicesPage = totalPages;
    const pageList = list.slice((invoicesPage - 1) * PAGE_SIZE, invoicesPage * PAGE_SIZE);
    const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
      el('th', {}, ['رقم الفاتورة']), el('th', {}, ['العميل']), el('th', {}, ['التاريخ']), el('th', {}, ['العملة']),
      el('th', {}, ['الإجمالي']), el('th', {}, ['المتبقي']), el('th', {}, ['الحالة']), el('th', {}, ['إجراءات']),
    ])])]);
    const tbody = el('tbody');
    pageList.forEach((inv) => {
      const s = statusOf(inv);
      const cur = inv.currency === 'USD' ? 'USD' : 'IQD';
      const actions = [
        ['🖨 طباعة', () => printInvoice(type, inv.id)],
        ['تعديل', () => openInvoiceForm(type, inv)],
      ];
      if (s !== 'paid') actions.push(['تسديد', () => openPaymentForm(type, inv)]);
      actions.push(['حذف', () => deleteInvoiceRow(type, inv.id)]);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [inv.number]),
        el('td', {}, [customerName(inv.customerId)]),
        el('td', {}, [formatDate(inv.date, true)]),
        el('td', {}, [cur === 'USD' ? el('span', { class: 'badge-usd' }, [' $']) : '—']),
        el('td', { class: 'num' }, [formatMoney(inv.total, cur)]),
        el('td', { class: 'num' }, [(() => {
          const remaining = inv.total - inv.paidAmount;
          return remaining > 0.001 ? el('span', { class: type === 'sale' ? 'amt-us' : 'amt-them' }, [formatMoney(remaining, cur)]) : formatMoney(0, cur);
        })()]),
        el('td', {}, [statusBadge(s)]),
        el('td', {}, [rowActions(actions)]),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    const pager = buildPager(invoicesPage, totalPages, (p) => { invoicesPage = p; draw(); });
    if (pager) wrap.appendChild(pager);
  }
  custFilter.addEventListener('change', () => { invoicesPage = 1; draw(); });
  statusFilter.addEventListener('change', () => { invoicesPage = 1; draw(); });
  draw();
}

async function deleteInvoiceRow(type, id) {
  if (!(await confirmModal('هل تريد حذف هذه الفاتورة؟ سيتم حذف الدفعات المرتبطة بها أيضاً.'))) return;
  await window.api.invoices.delete(type, id);
  toast('تم حذف الفاتورة');
  navigate(type === 'sale' ? 'sales' : 'purchases');
}

function openInvoiceForm(type, existing, presetCustomerId, onDone) {
  const isEdit = !!existing;
  const customers = STATE.customersCache;
  const body = el('div', {});

  const grid = el('div', { class: 'form-grid' });
  const custSelect = el('select', { class: 'input', 'data-field': 'customerId' });
  const selectedCustomerId = existing ? existing.customerId : presetCustomerId;
  customers.forEach((c) => custSelect.appendChild(el('option', { value: c.id, selected: selectedCustomerId === c.id ? 'selected' : undefined }, [c.name])));
  grid.appendChild(el('div', { class: 'field' }, [el('label', {}, [type === 'sale' ? 'العميل' : 'المورّد']), custSelect]));

  const dateInput = el('input', { class: 'input', type: 'date', 'data-field': 'date', value: existing ? existing.date.slice(0, 10) : todayInputValue() });
  grid.appendChild(el('div', { class: 'field' }, [el('label', {}, ['التاريخ']), dateInput]));

  // عملة الفاتورة: حساب دينار وحساب دولار مستقلان تماماً، لا تحويل بينهما إطلاقاً
  const currencySelect = el('select', { class: 'input' }, [
    el('option', { value: 'IQD' }, ['دينار (' + ((STATE.settings && STATE.settings.currency) || 'دينار') + ')']),
    el('option', { value: 'USD' }, ['دولار أمريكي ($)']),
  ]);
  const existingCust = existing ? customers.find((c) => c.id === existing.customerId) : customers.find((c) => c.id === presetCustomerId);
  const initialCurrency = existing ? (existing.currency || 'IQD') : ((existingCust && existingCust.dealsInUsd) ? 'USD' : 'IQD');
  currencySelect.value = initialCurrency;
  if (isEdit) currencySelect.disabled = true; // تفادي تضارب الدفعات المسجّلة بعملة الفاتورة الأصلية
  const currencyField = el('div', { class: 'field' }, [el('label', {}, ['عملة الفاتورة']), currencySelect]);
  grid.appendChild(currencyField);
  if (isEdit) grid.appendChild(el('div', { class: 'field-hint field-full' }, ['لا يمكن تغيير عملة الفاتورة بعد إنشائها.']));
  body.appendChild(grid);

  const amountLabel = type === 'sale' ? 'المبلغ (الأساسي)' : 'المبلغ (مطلوب)';
  const amountInput = moneyInput({ class: 'input', value: existing ? existing.amount : 0 });
  const discountInput = moneyInput({ class: 'input', value: existing ? existing.discount : 0 });
  const paidInput = moneyInput({ class: 'input', value: existing ? existing.paidAmount : 0 });
  const notesInput = el('textarea', { class: 'input', rows: 2 }, [existing ? existing.notes : '']);
  const grandTotalLine = el('div', { style: 'text-align:left; font-weight:700; margin-top:10px; font-size:15px' }, ['الإجمالي: 0.00']);

  function recalcTotals() {
    const total = Math.max(0, numVal(amountInput) - numVal(discountInput));
    const cur = currencySelect.value === 'USD' ? 'USD' : 'IQD';
    const d = decimalsForCurrency(cur);
    grandTotalLine.textContent = 'الإجمالي: ' + total.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ' + currencyLabel(cur);
    if (numVal(paidInput) > total) paidInput.value = formatMoneyInputStr(total.toFixed(2));
  }

  const totalsGrid = el('div', { class: 'form-grid', style: 'margin-top:14px' }, [
    el('div', { class: 'field' }, [el('label', {}, [amountLabel]), amountInput]),
    el('div', { class: 'field' }, [el('label', {}, ['الخصم']), discountInput]),
    el('div', { class: 'field' }, [el('label', {}, [isEdit ? 'المبلغ المدفوع (إجمالي)' : 'المبلغ المدفوع عند الإنشاء']), paidInput]),
    el('div', { class: 'field field-full' }, [el('label', {}, ['ملاحظات']), notesInput]),
  ]);
  body.appendChild(totalsGrid);
  body.appendChild(grandTotalLine);

  amountInput.addEventListener('input', recalcTotals);
  discountInput.addEventListener('input', recalcTotals);
  currencySelect.addEventListener('change', recalcTotals);
  recalcTotals();

  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const amount = numVal(amountInput);
      if (amount <= 0) { toast('أدخل مبلغاً أكبر من صفر', true); return; }
      const data = {
        customerId: custSelect.value,
        date: dateInputToISONow(dateInput.value),
        currency: currencySelect.value === 'USD' ? 'USD' : 'IQD',
        amount,
        discount: numVal(discountInput),
        paidAmount: numVal(paidInput),
        notes: notesInput.value,
      };
      if (isEdit) {
        await window.api.invoices.update(type, existing.id, data);
        toast('تم تحديث الفاتورة');
      } else {
        await window.api.invoices.add(type, data);
        toast('تم إنشاء الفاتورة');
      }
      closeModal();
      if (onDone) onDone();
      else navigate(type === 'sale' ? 'sales' : 'purchases');
    }}, [isEdit ? 'حفظ التعديلات' : 'حفظ الفاتورة']),
    el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إلغاء']),
  ];

  openModal(
    (isEdit ? 'تعديل ' : 'إنشاء ') + (type === 'sale' ? 'فاتورة بيع' : 'فاتورة شراء'),
    body, footer, true
  );
}

async function getCustomerCached(id) {
  let c = STATE.customersCache.find((x) => x.id === id);
  if (c) return c;
  c = await window.api.customers.get(id);
  if (c) STATE.customersCache.push(c);
  return c;
}

async function openPaymentForm(type, invoice, onDone) {
  const remaining = invoice.total - invoice.paidAmount;
  const cur = invoice.currency === 'USD' ? 'USD' : 'IQD';
  const amountBlock = buildPaymentAmountBlock('المبلغ المدفوع الآن', undefined, cur, remaining);
  const dateInput = el('input', { class: 'input', type: 'date', value: todayInputValue() });
  const notesInput = el('textarea', { class: 'input', rows: 2 });
  const body = el('div', { class: 'form-grid' }, [
    el('div', { class: 'field' }, [el('label', {}, ['المتبقي الحالي']), el('div', {}, [formatMoney(remaining, cur)])]),
    ...amountBlock.nodes,
    el('div', { class: 'field' }, [el('label', {}, ['تاريخ الدفعة']), dateInput]),
    el('div', { class: 'field field-full' }, [el('label', {}, ['ملاحظات']), notesInput]),
  ]);
  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const result = amountBlock.getResult();
      if (result.error) { toast(result.error, true); return; }
      const res = await window.api.payments.add({
        invoiceId: invoice.id,
        invoiceType: type,
        amount: result.amount,
        date: dateInputToISONow(dateInput.value),
        notes: notesInput.value,
      });
      if (!res.ok) { toast('تعذر تسجيل الدفعة', true); return; }
      closeModal();
      toast('تم تسجيل الدفعة');
      if (onDone) onDone();
      else navigate(type === 'sale' ? 'sales' : 'purchases');
    }}, ['تسجيل الدفعة']),
    el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إلغاء']),
  ];
  openModal('تسديد دفعة — فاتورة ' + invoice.number, body, footer);
}

// ---------------- تسديد العملاء ----------------
async function renderDues(area) {
  const [dues, customers] = await Promise.all([window.api.dues.summary(), window.api.customers.list()]);
  STATE.customersCache = customers;
  area.innerHTML = '';
  const custById = {};
  customers.forEach((c) => { custById[c.id] = c; });

  const owedIqd = dues.filter((d) => d.theyOweUs > 0.001).sort((a, b) => b.theyOweUs - a.theyOweUs);
  const owedUsd = dues.filter((d) => d.theyOweUsUsd > 0.001).sort((a, b) => b.theyOweUsUsd - a.theyOweUsUsd);

  if (owedIqd.length === 0 && owedUsd.length === 0) {
    area.appendChild(emptyState('لا توجد مبالغ مستحقة على العملاء', 'جميع العملاء مسددون بالكامل.'));
    return;
  }

  function duesTable(list, amountKey, currency) {
    const wrap = el('div', { class: 'table-wrap' });
    const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
      el('th', {}, ['العميل']), el('th', {}, ['الهاتف']), el('th', {}, ['المبلغ المستحق']), el('th', {}, ['إجراءات']),
    ])])]);
    const tbody = el('tbody');
    list.forEach((d) => {
      const cust = custById[d.customerId];
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [d.customerName]),
        el('td', {}, [(cust && cust.phone) || '—']),
        el('td', { class: 'num' }, [el('span', { class: 'amt-us' }, [formatMoney(d[amountKey], currency)])]),
        el('td', {}, [rowActions([
          ['تسديد', () => quickSettleForCustomer(d.customerId, () => navigate('dues'))],
          ['عرض الملف', () => openCustomerProfile(d.customerId)],
          ['كشف حساب', () => printCustomerStatement(d.customerId)],
        ])]),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  if (owedIqd.length) {
    area.appendChild(el('div', { class: 'section-title' }, ['مستحق بالدينار']));
    area.appendChild(duesTable(owedIqd, 'theyOweUs', 'IQD'));
  }
  if (owedUsd.length) {
    area.appendChild(el('div', { class: 'section-title' }, ['مستحق بالدولار']));
    area.appendChild(duesTable(owedUsd, 'theyOweUsUsd', 'USD'));
  }
}

// ---------------- السجل والتاريخ ----------------
async function renderHistory(area) {
  const [history, customers] = await Promise.all([window.api.history.get(), window.api.customers.list()]);
  STATE.customersCache = customers;

  const printReportBtn = el('button', { class: 'btn btn-primary' }, ['🖨 طباعة تقرير']);
  qs('#topbarActions').appendChild(printReportBtn);

  area.innerHTML = '';
  const toolbar = el('div', { class: 'toolbar' });
  const kindFilter = el('select', { class: 'input' }, [
    el('option', { value: '' }, ['كل الحركات']),
    el('option', { value: 'sale_invoice' }, ['فواتير البيع']),
    el('option', { value: 'purchase_invoice' }, ['فواتير الشراء']),
    el('option', { value: 'sale_payment' }, ['دفعات البيع']),
    el('option', { value: 'purchase_payment' }, ['دفعات الشراء']),
    el('option', { value: 'opening_payment' }, ['تسديدات الرصيد القديم']),
  ]);
  const custFilter = el('select', { class: 'input' }, [el('option', { value: '' }, ['كل العملاء'])]);
  customers.forEach((c) => custFilter.appendChild(el('option', { value: c.id }, [c.name])));
  const fromInput = el('input', { class: 'input', type: 'date' });
  const toInput = el('input', { class: 'input', type: 'date' });
  toolbar.appendChild(kindFilter);
  toolbar.appendChild(custFilter);
  toolbar.appendChild(el('span', { class: 'field' }, [el('label', {}, ['من']), fromInput]));
  toolbar.appendChild(el('span', { class: 'field' }, [el('label', {}, ['إلى']), toInput]));
  area.appendChild(toolbar);

  const wrap = el('div', { class: 'table-wrap' });
  area.appendChild(wrap);

  const KIND_LABEL = {
    sale_invoice: 'فاتورة بيع', purchase_invoice: 'فاتورة شراء',
    sale_payment: 'دفعة بيع', purchase_payment: 'دفعة شراء',
    opening_payment: 'تسديد رصيد قديم',
  };

  function filtered() {
    return history.filter((h) => {
      if (kindFilter.value && h.kind !== kindFilter.value) return false;
      if (custFilter.value && h.customerId !== custFilter.value) return false;
      if (fromInput.value && new Date(h.date) < new Date(fromInput.value)) return false;
      if (toInput.value && new Date(h.date) > new Date(toInput.value + 'T23:59:59')) return false;
      return true;
    });
  }
  let historyPage = 1;
  function draw() {
    const list = filtered();
    wrap.innerHTML = '';
    if (list.length === 0) { wrap.appendChild(emptyState('لا توجد نتائج', 'جرّب تغيير عوامل التصفية.')); return; }
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (historyPage > totalPages) historyPage = totalPages;
    const pageList = list.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE);
    const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
      el('th', {}, ['التاريخ']), el('th', {}, ['العميل']), el('th', {}, ['نوع الحركة']), el('th', {}, ['التفاصيل']), el('th', {}, ['المبلغ']),
    ])])]);
    const tbody = el('tbody');
    pageList.forEach((h) => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [formatDate(h.date, true)]),
        el('td', {}, [customerName(h.customerId)]),
        el('td', {}, [KIND_LABEL[h.kind] || h.kind]),
        el('td', {}, [h.label]),
        el('td', { class: 'num' }, [formatMoney(h.amount, h.currency)]),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    const pager = buildPager(historyPage, totalPages, (p) => { historyPage = p; draw(); });
    if (pager) wrap.appendChild(pager);
  }
  [kindFilter, custFilter, fromInput, toInput].forEach((i) => i.addEventListener('input', () => { historyPage = 1; draw(); }));
  draw();

  printReportBtn.addEventListener('click', () => printHistoryReport(filtered()));
}

// يعرض ملخصاً لمحتوى ملف نسخة احتياطية قبل استعادته فعلياً، ويطلب تأكيداً صريحاً
function openBackupInspectModal(res) {
  const data = res.data || {};
  const customers = Array.isArray(data.customers) ? data.customers : [];
  const sales = Array.isArray(data.saleInvoices) ? data.saleInvoices : [];
  const purchases = Array.isArray(data.purchaseInvoices) ? data.purchaseInvoices : [];
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const cur = (data.settings && data.settings.currency) || (STATE.settings && STATE.settings.currency) || '';
  const money = (n, isUsd) => (isUsd
    ? '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: (cur === 'د.ع' ? 0 : 2), maximumFractionDigits: (cur === 'د.ع' ? 0 : 2) }) + ' ' + cur);

  const inUsd = (i) => i.currency === 'USD';
  const totalSales = sales.filter((i) => !inUsd(i)).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const totalSalesUsd = sales.filter(inUsd).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const totalPurchases = purchases.filter((i) => !inUsd(i)).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const totalPurchasesUsd = purchases.filter(inUsd).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const dueSales = sales.filter((i) => !inUsd(i)).reduce((s, i) => s + Math.max((Number(i.total) || 0) - (Number(i.paidAmount) || 0), 0), 0);
  const dueSalesUsd = sales.filter(inUsd).reduce((s, i) => s + Math.max((Number(i.total) || 0) - (Number(i.paidAmount) || 0), 0), 0);
  const duePurchases = purchases.filter((i) => !inUsd(i)).reduce((s, i) => s + Math.max((Number(i.total) || 0) - (Number(i.paidAmount) || 0), 0), 0);
  const duePurchasesUsd = purchases.filter(inUsd).reduce((s, i) => s + Math.max((Number(i.total) || 0) - (Number(i.paidAmount) || 0), 0), 0);

  const rows = [
    ['اسم الشركة داخل الملف', (data.settings && data.settings.companyName) || '—'],
    ['تاريخ الملف', res.fileDate ? formatDate(res.fileDate, true) : '—'],
    ['عدد العملاء', String(customers.length)],
    ['عدد فواتير البيع', String(sales.length) + ' — إجمالي ' + money(totalSales) + ' + ' + money(totalSalesUsd, true)],
    ['عدد فواتير الشراء', String(purchases.length) + ' — إجمالي ' + money(totalPurchases) + ' + ' + money(totalPurchasesUsd, true)],
    ['عدد الدفعات المسجّلة', String(payments.length)],
    ['الباقي (غير مسدد)', money(dueSales) + ' + ' + money(dueSalesUsd, true)],
    ['المستحق علينا (غير مسدد)', money(duePurchases) + ' + ' + money(duePurchasesUsd, true)],
  ];

  const body = el('div', {}, [
    el('div', { class: 'form-grid' }, rows.map((r) => infoLine(r[0], r[1]))),
    el('div', { class: 'field-hint', style: 'margin-top:14px;color:var(--danger)' }, [
      'تأكيد الاستعادة سيستبدل جميع بيانات البرنامج الحالية (العملاء والفواتير والدفعات) بمحتوى هذا الملف بشكل نهائي ولا يمكن التراجع عنه.',
    ]),
  ]);
  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const restoreRes = await window.api.backup.restore(data);
      if (!restoreRes.ok) { toast('تعذّر استعادة النسخة الاحتياطية', true); return; }
      closeModal();
      toast('تم استيراد النسخة الاحتياطية بنجاح');
      STATE.settings = restoreRes.settings;
      qs('#brandCompanyName').textContent = STATE.settings.companyName || 'دفتر الفواتير';
      applyBrandLogo();
      navigate('dashboard');
    }}, ['تأكيد الاستعادة الآن']),
    el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إلغاء']),
  ];
  openModal('فحص النسخة الاحتياطية قبل الاستعادة', body, footer, true);
}

// ---------------- الإعدادات ----------------
async function renderSettings(area) {
  const settings = await window.api.settings.get();
  STATE.settings = settings;
  area.innerHTML = '';

  const body = el('div', { class: 'form-grid' }, [
    field('companyName', 'اسم المنشأة', settings.companyName),
    field('companyPhone', 'هاتف المنشأة', settings.companyPhone),
    fieldFull('companyAddress', 'عنوان المنشأة', settings.companyAddress),
  ]);

  // ---- شعار المنشأة ----
  let pendingLogo = settings.companyLogo || '';
  const logoPreview = el('div', { class: 'logo-preview' }, [
    pendingLogo
      ? el('img', { src: pendingLogo, alt: 'شعار المنشأة' })
      : el('div', { class: 'logo-placeholder' }, ['لا يوجد شعار']),
  ]);
  const logoFileInput = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/svg+xml,image/webp',
    style: 'display:none',
    onchange: (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        toast('حجم الصورة كبير جداً، يفضل أقل من 1 ميجابايت', true);
      }
      const reader = new FileReader();
      reader.onload = () => {
        pendingLogo = String(reader.result || '');
        logoPreview.innerHTML = '';
        logoPreview.appendChild(el('img', { src: pendingLogo, alt: 'شعار المنشأة' }));
      };
      reader.readAsDataURL(file);
    },
  });
  const logoButtons = el('div', { class: 'toolbar' }, [
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => logoFileInput.click() }, ['⭱ اختيار صورة الشعار']),
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
      pendingLogo = '';
      logoPreview.innerHTML = '';
      logoPreview.appendChild(el('div', { class: 'logo-placeholder' }, ['لا يوجد شعار']));
    }}, ['✕ إزالة الشعار']),
  ]);
  const currencySelect = el('select', { class: 'input', 'data-field': 'currency' }, [
    'د.ع', 'دينار', 'ريال', 'دولار', 'جنيه', 'درهم'
  ].map((c) => el('option', { value: c, selected: settings.currency === c ? 'selected' : undefined }, [c === 'د.ع' ? 'دينار عراقي (د.ع)' : c])));
  body.appendChild(el('div', { class: 'field' }, [el('label', {}, ['العملة']), currencySelect]));

  area.appendChild(body);
  area.appendChild(el('div', { class: 'field-hint' }, ['حساب الدولار مستقل تماماً عن حساب الدينار لكل عميل — بدون أي تحويل أو سعر صرف بينهما.']));

  area.appendChild(el('div', { class: 'section-title' }, ['شعار المنشأة']));
  area.appendChild(el('div', { class: 'logo-upload-row' }, [logoPreview, logoButtons, logoFileInput]));
  area.appendChild(el('div', { class: 'field-hint' }, ['يظهر الشعار في الشريط الجانبي وأعلى فواتير الطباعة. يفضّل صورة مربعة بخلفية شفافة أو بيضاء.']));

  area.appendChild(el('div', { class: 'section-title' }, ['حفظ ونسخ احتياطي']));
  const actions = el('div', { class: 'toolbar' });
  actions.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
    const data = readFields(body, ['companyName', 'companyPhone', 'companyAddress']);
    data.currency = currencySelect.value;
    data.companyLogo = pendingLogo;
    STATE.settings = await window.api.settings.update(data);
    toast('تم حفظ الإعدادات');
    qs('#brandCompanyName').textContent = STATE.settings.companyName || 'دفتر الفواتير';
    applyBrandLogo();
  }}, ['حفظ الإعدادات']));
  actions.appendChild(el('button', { class: 'btn btn-ghost', onclick: async () => {
    const res = await window.api.backup.export();
    if (res.ok) toast('تم حفظ النسخة الاحتياطية');
  }}, ['⭳ تصدير نسخة احتياطية (JSON)']));
  actions.appendChild(el('button', { class: 'btn btn-ghost', onclick: async () => {
    const res = await window.api.backup.import();
    if (res.ok) {
      openBackupInspectModal(res);
    } else if (res.reason === 'invalid_format') {
      toast('الملف المختار ليس نسخة احتياطية صالحة', true);
    } else if (res.reason === 'read_error') {
      toast('تعذّرت قراءة الملف المختار', true);
    } else if (res.reason !== 'canceled') {
      toast('تعذّر قراءة النسخة الاحتياطية', true);
    }
  }}, ['🔍 فحص واستيراد نسخة احتياطية (JSON)']));
  area.appendChild(actions);

  const autoInfo = await window.api.backup.autoInfo();
  const isCustomDir = !!(settings.autoBackupCustomDir && settings.autoBackupCustomDir.trim());
  const autoHint = el('div', { class: 'field-hint' }, [
    'يأخذ البرنامج نسخة احتياطية تلقائية بعد كل عملية تغيّر البيانات (إضافة/تعديل/حذف عميل، فاتورة، أو تسديد) دون أي إجراء يدوي' +
    (autoInfo && autoInfo.dir ? '، وتُحفظ حالياً في: ' + autoInfo.dir : '') +
    (isCustomDir ? ' (مكان مخصّص حدّدته بنفسك — تبقى نسخة إضافية دائماً في المجلد الافتراضي كشبكة أمان).' : '.'),
  ]);
  area.appendChild(autoHint);
  const autoActions = el('div', { class: 'toolbar', style: 'margin-top:8px' });
  autoActions.appendChild(el('button', { class: 'btn btn-ghost', onclick: async () => {
    const res = await window.api.backup.openAutoFolder();
    if (!res.ok) toast('تعذّر فتح مجلد النسخ الاحتياطية التلقائية', true);
  }}, ['📂 فتح المجلد']));
  autoActions.appendChild(el('button', { class: 'btn btn-ghost', onclick: async () => {
    const res = await window.api.backup.chooseAutoFolder();
    if (res.ok) {
      STATE.settings = res.settings;
      toast('سيتم حفظ النسخة الاحتياطية التلقائية في المكان الجديد بعد كل عملية');
      navigate('settings');
    }
  }}, ['📁 تحديد مكان النسخ الاحتياطي التلقائي']));
  if (isCustomDir) {
    autoActions.appendChild(el('button', { class: 'btn btn-ghost', onclick: async () => {
      const res = await window.api.backup.clearAutoFolder();
      if (res.ok) {
        STATE.settings = res.settings;
        toast('تم الرجوع إلى المجلد الافتراضي للنسخ الاحتياطي التلقائي');
        navigate('settings');
      }
    }}, ['إلغاء المكان المخصّص']));
  }
  area.appendChild(autoActions);

  // ---- نسخة احتياطية يومية عبر البريد الإلكتروني ----
  const emailCfg = Object.assign({ enabled: false, to: '', host: '', port: 587, secure: false, user: '', pass: '', lastSentDate: '' }, settings.backupEmail || {});
  area.appendChild(el('div', { class: 'section-title' }, ['نسخة احتياطية يومية عبر البريد الإلكتروني']));
  area.appendChild(el('div', { class: 'field-hint' }, [
    'يرسل البرنامج نسخة احتياطية (JSON) تلقائياً مرة واحدة يومياً إلى البريد المحدّد أدناه — أول مرة يُفتح بها البرنامج في ذلك اليوم (لا يعمل والبرنامج مغلق تماماً). لحسابات Gmail يلزم إنشاء "كلمة مرور تطبيق" بدل كلمة المرور العادية.',
  ]));
  const emailEnabledInput = el('input', { type: 'checkbox', id: 'backupEmailEnabled', checked: emailCfg.enabled ? 'checked' : undefined });
  const emailToInput = el('input', { class: 'input', type: 'email', placeholder: 'example@gmail.com', value: emailCfg.to });
  const emailHostInput = el('input', { class: 'input', placeholder: 'smtp.gmail.com', value: emailCfg.host });
  const emailPortInput = el('input', { class: 'input', type: 'number', placeholder: '587', value: emailCfg.port || 587 });
  const emailSecureInput = el('input', { type: 'checkbox', id: 'backupEmailSecure', checked: emailCfg.secure ? 'checked' : undefined });
  const emailUserInput = el('input', { class: 'input', type: 'email', placeholder: 'البريد المرسِل — example@gmail.com', value: emailCfg.user });
  const emailPassInput = el('input', { class: 'input', type: 'password', placeholder: 'كلمة المرور / كلمة مرور التطبيق', value: emailCfg.pass });

  const emailGrid = el('div', { class: 'form-grid' }, [
    el('div', { class: 'field field-full', style: 'flex-direction:row;align-items:center;gap:8px' }, [
      emailEnabledInput, el('label', { for: 'backupEmailEnabled' }, ['تفعيل الإرسال اليومي التلقائي']),
    ]),
    el('div', { class: 'field' }, [el('label', {}, ['البريد المُرسَل إليه (المستلم)']), emailToInput]),
    el('div', { class: 'field' }, [el('label', {}, ['البريد المرسِل (اسم المستخدم)']), emailUserInput]),
    el('div', { class: 'field' }, [el('label', {}, ['كلمة المرور']), emailPassInput]),
    el('div', { class: 'field' }, [el('label', {}, ['خادم SMTP']), emailHostInput]),
    el('div', { class: 'field' }, [el('label', {}, ['المنفذ (Port)']), emailPortInput]),
    el('div', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px' }, [
      emailSecureInput, el('label', { for: 'backupEmailSecure' }, ['اتصال مشفّر SSL (منفذ 465 عادةً)']),
    ]),
  ]);
  area.appendChild(emailGrid);
  if (emailCfg.lastSentDate) {
    area.appendChild(el('div', { class: 'field-hint' }, ['آخر نسخة أُرسلت فعلياً بتاريخ: ' + emailCfg.lastSentDate]));
  }
  const emailActions = el('div', { class: 'toolbar', style: 'margin-top:8px' });
  const readEmailCfg = () => ({
    enabled: emailEnabledInput.checked,
    to: emailToInput.value.trim(),
    host: emailHostInput.value.trim(),
    port: Number(emailPortInput.value) || 587,
    secure: emailSecureInput.checked,
    user: emailUserInput.value.trim(),
    pass: emailPassInput.value,
    lastSentDate: emailCfg.lastSentDate || '',
  });
  emailActions.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
    const cfg = readEmailCfg();
    if (cfg.enabled && (!cfg.to || !cfg.host || !cfg.user || !cfg.pass)) {
      toast('أكمل بيانات البريد كاملة قبل تفعيل الإرسال التلقائي', true);
      return;
    }
    STATE.settings = await window.api.settings.update({ backupEmail: cfg });
    toast('تم حفظ إعدادات البريد');
  }}, ['حفظ إعدادات البريد']));
  emailActions.appendChild(el('button', { class: 'btn btn-ghost', onclick: async () => {
    const cfg = readEmailCfg();
    if (!cfg.to || !cfg.host || !cfg.user || !cfg.pass) {
      toast('أكمل بيانات البريد كاملة أولاً (ويفضّل حفظها) قبل الإرسال التجريبي', true);
      return;
    }
    STATE.settings = await window.api.settings.update({ backupEmail: cfg });
    toast('جارٍ إرسال نسخة تجريبية...');
    const res = await window.api.backup.sendEmailNow();
    if (res.ok) {
      toast('تم إرسال النسخة الاحتياطية بنجاح');
      navigate('settings');
    } else if (res.reason === 'missing_config') {
      toast('أكمل بيانات البريد كاملة أولاً', true);
    } else {
      toast('تعذّر الإرسال: ' + (res.message || 'تحقق من بيانات البريد والاتصال بالإنترنت'), true);
    }
  }}, ['✉ إرسال نسخة الآن (تجربة)']));
  area.appendChild(emailActions);

  area.appendChild(el('div', { class: 'section-title' }, ['معلومات الترقيم']));
  area.appendChild(el('div', {}, [
    'آخر رقم فاتورة بيع: ' + settings.saleInvoiceCounter + ' — آخر رقم فاتورة شراء: ' + settings.purchaseInvoiceCounter,
  ]));

  // ---- الترخيص ----
  area.appendChild(el('div', { class: 'section-title' }, ['الترخيص']));
  const licenseStatus = await window.api.license.getStatus();
  const licenseLine = licenseStatus.ok
    ? (licenseStatus.permanent
        ? 'الحالة: مفعّل بشكل دائم'
        : 'الحالة: مفعّل حتى ' + new Date(licenseStatus.expiryDate).toLocaleDateString('ar'))
    : 'الحالة: غير مفعّل';
  area.appendChild(el('div', {}, [licenseLine + ' — رمز هذا الحاسوب: ' + licenseStatus.deviceId]));

  const licenseActions = el('div', { class: 'toolbar', style: 'margin-top:8px' });
  licenseActions.appendChild(el('button', { class: 'btn btn-ghost', onclick: () => openLicenseModal() }, ['🔑 تفعيل / تحديث المفتاح']));
  if (licenseStatus.ok) {
    licenseActions.appendChild(el('button', { class: 'btn btn-danger', onclick: async () => {
      const sure = await confirmModal('هل تريد إلغاء تفعيل البرنامج على هذا الحاسوب؟');
      if (!sure) return;
      await window.api.license.deactivate();
      toast('تم إلغاء التفعيل');
      navigate('settings');
    }}, ['إلغاء التفعيل']));
  }
  area.appendChild(licenseActions);
}

// نافذة تفعيل/تحديث مفتاح الترخيص، تُستخدم أيضاً لتجديد الترخيص قبل انتهائه
async function openLicenseModal() {
  const status = await window.api.license.getStatus();
  const deviceInput = el('input', { class: 'input', readonly: true, value: status.deviceId, style: 'text-align:center;font-weight:700' });
  const keyInput = el('input', { class: 'input', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', style: 'text-align:center;font-weight:700;text-transform:uppercase;margin-top:10px' });
  const msg = el('div', { class: 'field-hint', style: 'margin-top:8px' }, ['']);

  const body = el('div', {}, [
    el('div', { class: 'field' }, [el('label', {}, ['رمز هذا الحاسوب']), deviceInput]),
    el('div', { class: 'field', style: 'margin-top:10px' }, [el('label', {}, ['مفتاح التفعيل']), keyInput]),
    msg,
  ]);

  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const result = await window.api.license.activate(keyInput.value.trim());
      if (result.ok) {
        toast('تم التفعيل بنجاح');
        closeModal();
        navigate('settings');
      } else {
        const map = {
          format: 'صيغة المفتاح غير صحيحة',
          invalid: 'المفتاح غير صحيح',
          device_mismatch: 'هذا المفتاح غير مخصّص لهذا الحاسوب',
          expired: 'هذا المفتاح منتهي الصلاحية',
        };
        msg.textContent = map[result.reason] || 'تعذّر التفعيل';
      }
    }}, ['تفعيل']),
    el('button', { class: 'btn btn-ghost', onclick: () => closeModal() }, ['إغلاق']),
  ];
  openModal('تفعيل / تحديث الترخيص', body, footer);
}

// ---------------- عن البرنامج ----------------
async function renderAbout(area) {
  area.innerHTML = '';

  const card = el('div', { class: 'about-card' }, [
    el('div', { class: 'about-app-mark' }, ['ف']),
    el('div', { class: 'about-app-name' }, ['دفتر الفواتير']),
    el('div', { class: 'about-app-desc' }, ['برنامج سطح مكتب عربي لإدارة العملاء والفواتير والمستحقات']),
  ]);
  area.appendChild(card);

  area.appendChild(el('div', { class: 'section-title' }, ['معلومات المطوّر']));
  const infoRows = [
    ['المطوّر', 'المهندس إبراهيم مؤيد عطارباشي'],
    ['الموقع', 'الموصل — المجموعة الثقافية — شركة المسار الذهبي'],
    ['رقم الهاتف', '+9647736970504'],
  ];
  const infoList = el('div', { class: 'about-info-list' }, infoRows.map(([label, value]) => (
    el('div', { class: 'about-info-row' }, [
      el('span', { class: 'about-info-label' }, [label]),
      el('span', { class: 'about-info-value' }, [value]),
    ])
  )));
  area.appendChild(infoList);

  const contactActions = el('div', { class: 'toolbar', style: 'margin-top:14px;max-width:420px;margin-inline:auto;justify-content:center' });
  contactActions.appendChild(el('button', {
    class: 'btn btn-primary',
    onclick: () => { window.api.system.openExternal('tel:+9647736970504'); },
  }, ['📞 اتصال']));
  contactActions.appendChild(el('button', {
    class: 'btn btn-ghost',
    onclick: () => { window.api.system.openExternal('https://wa.me/9647736970504'); },
  }, ['💬 واتساب']));
  area.appendChild(contactActions);

  area.appendChild(el('div', { class: 'field-hint', style: 'margin-top:16px;text-align:center' }, [
    'جميع الحقوق محفوظة © ' + new Date().getFullYear(),
  ]));
}

// ---------------- عناصر نماذج مشتركة ----------------
function field(name, label, value, type) {
  const attrs = { class: 'input', 'data-field': name, value: value || '' };
  if (type) { attrs.type = type; if (type === 'number') attrs.step = 'any'; }
  return el('div', { class: 'field' }, [el('label', {}, [label]), el('input', attrs)]);
}
function fieldFull(name, label, value, textarea) {
  const input = textarea
    ? el('textarea', { class: 'input', rows: 2, 'data-field': name }, [value || ''])
    : el('input', { class: 'input', 'data-field': name, value: value || '' });
  return el('div', { class: 'field field-full' }, [el('label', {}, [label]), input]);
}
function readFields(root, names) {
  const out = {};
  names.forEach((n) => {
    const inp = root.querySelector('[data-field="' + n + '"]');
    out[n] = inp ? inp.value : '';
  });
  return out;
}

// ---------------- النوافذ المنبثقة ----------------
function openModal(title, bodyNode, footerNodes, wide) {
  const root = qs('#modalRoot');
  root.innerHTML = '';
  const box = el('div', { class: 'modal-box' + (wide ? ' wide' : '') }, [
    el('div', { class: 'modal-header' }, [el('h2', {}, [title]), el('button', { class: 'modal-close', onclick: closeModal }, ['✕'])]),
    el('div', { class: 'modal-body' }, [bodyNode]),
    el('div', { class: 'modal-footer' }, footerNodes || []),
  ]);
  root.appendChild(el('div', { class: 'modal-backdrop', onclick: closeModal }));
  root.appendChild(box);
  root.classList.remove('hidden');
}
function closeModal() {
  qs('#modalRoot').classList.add('hidden');
  qs('#modalRoot').innerHTML = '';
}

// تأكيد غير حاجب (بديل عن confirm() الأصلي الذي قد يتجمد داخل نافذة Electron المعزولة)
function confirmModal(message) {
  return new Promise((resolve) => {
    const body = el('div', {}, [el('p', {}, [message])]);
    const footer = [
      el('button', { class: 'btn btn-primary', onclick: () => { closeModal(); resolve(true); } }, ['تأكيد']),
      el('button', { class: 'btn btn-ghost', onclick: () => { closeModal(); resolve(false); } }, ['إلغاء']),
    ];
    openModal('تأكيد', body, footer);
  });
}

// ---------------- الطباعة والمعاينة ----------------
function openPrintPreview(html, pdfName) {
  qs('#printArea').innerHTML = html;
  STATE.currentPdfName = pdfName || 'مستند';
  qs('#printPreviewRoot').classList.remove('hidden');
}
function closePrintPreview() {
  qs('#printPreviewRoot').classList.add('hidden');
}
qs('#ppCancelBtn').addEventListener('click', closePrintPreview);
qs('#ppPrintBtn').addEventListener('click', async () => {
  await window.api.print.current();
});
qs('#ppPdfBtn').addEventListener('click', async () => {
  const html = qs('#printArea').innerHTML;
  const res = await window.api.print.exportPdf({ html, defaultName: STATE.currentPdfName });
  if (res.ok) toast('تم حفظ ملف PDF');
  else if (res.reason !== 'canceled') toast('تعذّر حفظ ملف PDF', true);
});

function docHeaderHtml(docTypeLabel, metaLines) {
  const s = STATE.settings || {};
  const logoImg = s.companyLogo ? '<img class="doc-header-logo" src="' + s.companyLogo + '" alt="شعار" />' : '';
  return (
    '<div class="doc-header">' +
      '<div class="doc-header-brand">' +
        logoImg +
        '<div>' +
          '<h2>' + esc(s.companyName || 'المنشأة') + '</h2>' +
          '<div class="doc-meta">' + esc(s.companyPhone || '') + (s.companyPhone && s.companyAddress ? ' — ' : '') + esc(s.companyAddress || '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="doc-type">' + docTypeLabel + metaLines + '</div>' +
    '</div>'
  );
}

async function printInvoice(type, id) {
  const [inv, customer] = await Promise.all([
    window.api.invoices.get(type, id),
    (async () => { const list = await window.api.customers.list(); STATE.customersCache = list; return list; })(),
  ]);
  const cust = STATE.customersCache.find((c) => c.id === inv.customerId);
  const cur = inv.currency === 'USD' ? 'USD' : 'IQD';
  const label = (type === 'sale' ? 'فاتورة بيع' : 'فاتورة شراء') + (cur === 'USD' ? ' (دولار)' : '');
  const meta = '<div class="doc-meta">رقم: ' + esc(inv.number) + '<br/>التاريخ: ' + formatDate(inv.date, true) + '</div>';

  const amountLabel = type === 'sale' ? 'المبلغ (الأساسي)' : 'المبلغ (مطلوب)';

  const html =
    docHeaderHtml(label, meta) +
    '<div class="doc-section-title">بيانات ' + (type === 'sale' ? 'العميل' : 'المورّد') + '</div>' +
    '<div>' + esc(cust ? cust.name : '') + (cust && cust.phone ? ' — ' + esc(cust.phone) : '') + '</div>' +
    '<div class="doc-totals">' +
      '<div><span>' + amountLabel + '</span><span>' + formatMoney(inv.amount, cur) + '</span></div>' +
      '<div><span>الخصم</span><span>' + formatMoney(inv.discount, cur) + '</span></div>' +
      '<div class="grand"><span>الإجمالي</span><span>' + formatMoney(inv.total, cur) + '</span></div>' +
      '<div><span>المدفوع</span><span>' + formatMoney(inv.paidAmount, cur) + '</span></div>' +
      '<div><span>المتبقي</span><span>' + formatMoney(inv.total - inv.paidAmount, cur) + '</span></div>' +
    '</div>' +
    (inv.notes ? '<div class="doc-section-title">ملاحظات</div><div>' + esc(inv.notes) + '</div>' : '') +
    '<div class="doc-footer">تم إنشاء هذا المستند بواسطة دفتر الفواتير — ' + formatDate(new Date().toISOString(), true) + '</div>';

  openPrintPreview(html, (type === 'sale' ? 'فاتورة-بيع-' : 'فاتورة-شراء-') + inv.number);
}

async function printCustomerStatement(customerId) {
  const [customer, sales, purchases, payments] = await Promise.all([
    window.api.customers.get(customerId),
    window.api.invoices.listSale(),
    window.api.invoices.listPurchase(),
    window.api.payments.list(),
  ]);
  const mySales = sales.filter((i) => i.customerId === customerId);
  const myPurchases = purchases.filter((i) => i.customerId === customerId);
  const myPayments = payments.filter((p) => p.customerId === customerId);

  // يبني قسم كشف الحساب لعملة واحدة فقط (دينار أو دولار) — الحسابان مستقلان تماماً
  function buildSection(currency) {
    const cur = currency === 'USD' ? 'USD' : 'IQD';
    const inCur = (x) => (x.currency === 'USD' ? 'USD' : 'IQD') === cur;
    const sSales = mySales.filter(inCur);
    const sPurchases = myPurchases.filter(inCur);
    // تُستبعد هنا تسديدات الرصيد القديم (invoiceType: 'opening')؛ تُعالَج بشكل منفصل أدناه حتى لا تظهر كدفعة فاتورة
    const sPayments = myPayments.filter(inCur).filter((p) => p.invoiceType !== 'opening');
    const sOpeningPayments = myPayments.filter(inCur).filter((p) => p.invoiceType === 'opening');
    // القيمة الأصلية للرصيد القديم — تبقى تظهر في الكشف حتى بعد تسديدها بالكامل
    const openingOriginal = cur === 'USD'
      ? (Number(customer.openingBalanceUsdOriginal !== undefined ? customer.openingBalanceUsdOriginal : customer.openingBalanceUsd) || 0)
      : (Number(customer.openingBalanceOriginal !== undefined ? customer.openingBalanceOriginal : customer.openingBalance) || 0);

    const events = [];
    if (openingOriginal) {
      events.push({
        // date تاريخ العرض الفعلي (تاريخ إضافة العميل)، sortDate تاريخ ثابت قديم جداً يضمن ظهور "حساب قديم"
        // كأول حركة زمنياً دائماً بدون أن يشوّه التاريخ المطبوع بالكشف
        date: customer.createdAt || new Date(0).toISOString(),
        sortDate: new Date(0).toISOString(),
        label: 'حساب قديم',
        debit: openingOriginal > 0 ? openingOriginal : 0,
        credit: openingOriginal < 0 ? -openingOriginal : 0,
      });
    }
    sOpeningPayments.forEach((p) => {
      // تسديد رصيد قديم مستحق لنا (موجب) هو "دفعة مستلمة"؛ تسديد رصيد مستحق علينا (سالب) هو "دفعة مسددة"
      const isReceivable = openingOriginal >= 0;
      events.push({ date: p.date, label: 'تسديد رصيد قديم', debit: isReceivable ? 0 : p.amount, credit: isReceivable ? p.amount : 0 });
    });
    sSales.forEach((i) => {
      events.push({ date: i.date, label: 'فاتورة بيع ' + i.number, debit: i.total, credit: 0 });
      const paidViaPayments = sPayments.filter((p) => p.invoiceType === 'sale' && p.invoiceId === i.id).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const paidAtCreation = Math.max(0, (Number(i.paidAmount) || 0) - paidViaPayments);
      if (paidAtCreation > 0.001) events.push({ date: i.date, label: 'دفعة عند البيع — فاتورة ' + i.number, debit: 0, credit: paidAtCreation });
    });
    sPurchases.forEach((i) => {
      events.push({ date: i.date, label: 'فاتورة شراء ' + i.number, debit: 0, credit: i.total });
      const paidViaPayments = sPayments.filter((p) => p.invoiceType === 'purchase' && p.invoiceId === i.id).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const paidAtCreation = Math.max(0, (Number(i.paidAmount) || 0) - paidViaPayments);
      if (paidAtCreation > 0.001) events.push({ date: i.date, label: 'دفعة عند الشراء — فاتورة ' + i.number, debit: paidAtCreation, credit: 0 });
    });
    const batchedSale = {}, batchedPurchase = {};
    const singlePayments = [];
    sPayments.forEach((p) => {
      if (p.batchId) {
        const bucket = p.invoiceType === 'sale' ? batchedSale : batchedPurchase;
        if (!bucket[p.batchId]) bucket[p.batchId] = { date: p.date, amount: 0 };
        bucket[p.batchId].amount += Number(p.amount) || 0;
      } else {
        singlePayments.push(p);
      }
    });
    singlePayments.forEach((p) => events.push({
      date: p.date,
      label: (p.invoiceType === 'sale' ? 'دفعة مستلمة — ' : 'دفعة مسددة — ') + p.invoiceNumber,
      debit: p.invoiceType === 'purchase' ? p.amount : 0,
      credit: p.invoiceType === 'sale' ? p.amount : 0,
    }));
    Object.values(batchedSale).forEach((b) => events.push({ date: b.date, label: 'دفعة مستلمة (تسديد مجمّع)', debit: 0, credit: b.amount }));
    Object.values(batchedPurchase).forEach((b) => events.push({ date: b.date, label: 'دفعة مسددة (تسديد مجمّع)', debit: b.amount, credit: 0 }));
    events.sort((a, b) => new Date(a.sortDate || a.date) - new Date(b.sortDate || b.date));

    if (events.length === 0) return '';

    let rows = '';
    events.forEach((e) => {
      rows += '<tr><td>' + formatDate(e.date, true) + '</td><td>' + esc(e.label) + '</td><td>' + (e.debit ? '<span class="amt-us">' + formatMoney(e.debit, cur) + '</span>' : '—') + '</td><td>' + (e.credit ? '<span class="amt-them">' + formatMoney(e.credit, cur) + '</span>' : '—') + '</td></tr>';
    });
    const theyOweUs = sSales.reduce((s, i) => s + (i.total - i.paidAmount), 0) + (openingOriginal > 0 ? openingOriginal : 0);

    return (
      '<div class="doc-section-title">كشف حساب بـ' + currencyLabel(cur) + '</div>' +
      '<table class="doc-table"><thead><tr><th>التاريخ</th><th>الحركة</th><th>مدين</th><th>دائن</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="doc-totals">' +
        '<div class="grand"><span>إجمالي الباقي بـ' + currencyLabel(cur) + '</span><span class="amt-us">' + formatMoney(theyOweUs, cur) + '</span></div>' +
      '</div>'
    );
  }

  const meta = '<div class="doc-meta">العميل: ' + esc(customer.name) + '<br/>تاريخ التقرير: ' + formatDate(new Date().toISOString()) + '</div>';
  const html =
    docHeaderHtml('كشف حساب', meta) +
    buildSection('IQD') +
    buildSection('USD') +
    '<div class="doc-footer">تم إنشاء هذا المستند بواسطة دفتر الفواتير — ' + formatDate(new Date().toISOString(), true) + '</div>';

  openPrintPreview(html, 'كشف-حساب-' + (customer ? customer.name : ''));
}

function printHistoryReport(list) {
  let rows = '';
  const KIND_LABEL = { sale_invoice: 'فاتورة بيع', purchase_invoice: 'فاتورة شراء', sale_payment: 'دفعة بيع', purchase_payment: 'دفعة شراء', opening_payment: 'تسديد رصيد قديم' };
  list.forEach((h) => {
    rows += '<tr><td>' + formatDate(h.date, true) + '</td><td>' + esc(customerName(h.customerId)) + '</td><td>' + (KIND_LABEL[h.kind] || h.kind) + '</td><td>' + formatMoney(h.amount, h.currency) + '</td></tr>';
  });
  const totalIqd = list.filter((h) => h.currency !== 'USD').reduce((s, h) => s + h.amount, 0);
  const totalUsd = list.filter((h) => h.currency === 'USD').reduce((s, h) => s + h.amount, 0);
  const meta = '<div class="doc-meta">عدد الحركات: ' + list.length + '<br/>تاريخ التقرير: ' + formatDate(new Date().toISOString()) + '</div>';
  const html =
    docHeaderHtml('تقرير السجل', meta) +
    '<table class="doc-table"><thead><tr><th>التاريخ</th><th>العميل</th><th>نوع الحركة</th><th>المبلغ</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="doc-totals">' +
      '<div class="grand"><span>إجمالي المبالغ بالدينار</span><span>' + formatMoney(totalIqd, 'IQD') + '</span></div>' +
      '<div class="grand"><span>إجمالي المبالغ بالدولار</span><span>' + formatMoney(totalUsd, 'USD') + '</span></div>' +
    '</div>' +
    '<div class="doc-footer">تم إنشاء هذا المستند بواسطة دفتر الفواتير — ' + formatDate(new Date().toISOString(), true) + '</div>';
  openPrintPreview(html, 'تقرير-السجل-' + formatDate(new Date().toISOString()));
}

// ---------------- البحث الشامل (عميل/فاتورة/رقم) ----------------
const globalSearchInput = qs('#globalSearchInput');
const globalSearchResultsEl = qs('#globalSearchResults');
let gsDebounceTimer = null;

function hideGlobalSearchResults() {
  globalSearchResultsEl.classList.add('hidden');
}

globalSearchInput.addEventListener('input', () => {
  clearTimeout(gsDebounceTimer);
  const q = globalSearchInput.value.trim();
  if (!q) { hideGlobalSearchResults(); return; }
  gsDebounceTimer = setTimeout(() => runGlobalSearch(q), 200);
});
globalSearchInput.addEventListener('focus', () => {
  if (globalSearchInput.value.trim() && globalSearchResultsEl.children.length) {
    globalSearchResultsEl.classList.remove('hidden');
  }
});
globalSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { globalSearchInput.blur(); hideGlobalSearchResults(); }
});
document.addEventListener('click', (e) => {
  if (!qs('#globalSearch').contains(e.target)) hideGlobalSearchResults();
});

async function runGlobalSearch(query) {
  const q = query.toLowerCase();
  const [customers, sales, purchases] = await Promise.all([
    window.api.customers.list(),
    window.api.invoices.listSale(),
    window.api.invoices.listPurchase(),
  ]);
  // لا نعتمد هذا كتحديث كامل لحالة الشاشة الحالية، فقط لبناء أسماء العملاء داخل نتائج البحث
  const custById = {};
  customers.forEach((c) => { custById[c.id] = c; });

  const matchedCustomers = customers
    .filter((c) => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(query))
    .slice(0, 6);

  function matchInvoices(list) {
    return list
      .filter((inv) => {
        const custName = (custById[inv.customerId] && custById[inv.customerId].name) || '';
        return (
          (inv.number || '').toLowerCase().includes(q) ||
          custName.toLowerCase().includes(q) ||
          (inv.notes || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 6);
  }
  const matchedSales = matchInvoices(sales);
  const matchedPurchases = matchInvoices(purchases);

  renderGlobalSearchResults(matchedCustomers, matchedSales, matchedPurchases, custById);
}

function gsResultRow(title, sub, onclick) {
  return el('div', { class: 'gsr-item', onclick }, [
    el('span', { class: 'gsr-title' }, [title]),
    el('span', { class: 'gsr-sub' }, [sub || '']),
  ]);
}

function renderGlobalSearchResults(customers, sales, purchases, custById) {
  globalSearchResultsEl.innerHTML = '';
  const total = customers.length + sales.length + purchases.length;
  if (total === 0) {
    globalSearchResultsEl.appendChild(el('div', { class: 'gsr-empty' }, ['لا توجد نتائج مطابقة']));
    globalSearchResultsEl.classList.remove('hidden');
    return;
  }
  if (customers.length) {
    globalSearchResultsEl.appendChild(el('div', { class: 'gsr-group-title' }, ['العملاء']));
    customers.forEach((c) => {
      globalSearchResultsEl.appendChild(gsResultRow(c.name, c.phone || '', () => selectCustomerResult(c.id)));
    });
  }
  if (sales.length) {
    globalSearchResultsEl.appendChild(el('div', { class: 'gsr-group-title' }, ['فواتير البيع']));
    sales.forEach((inv) => {
      const cust = custById[inv.customerId];
      globalSearchResultsEl.appendChild(gsResultRow(inv.number, (cust ? cust.name + ' — ' : '') + formatMoney(inv.total), () => selectInvoiceResult('sale', inv)));
    });
  }
  if (purchases.length) {
    globalSearchResultsEl.appendChild(el('div', { class: 'gsr-group-title' }, ['فواتير الشراء']));
    purchases.forEach((inv) => {
      const cust = custById[inv.customerId];
      globalSearchResultsEl.appendChild(gsResultRow(inv.number, (cust ? cust.name + ' — ' : '') + formatMoney(inv.total), () => selectInvoiceResult('purchase', inv)));
    });
  }
  globalSearchResultsEl.classList.remove('hidden');
}

async function selectCustomerResult(id) {
  hideGlobalSearchResults();
  globalSearchInput.value = '';
  await navigate('customers');
  openCustomerProfile(id);
}

async function selectInvoiceResult(type, invoice) {
  hideGlobalSearchResults();
  globalSearchInput.value = '';
  await navigate(type === 'sale' ? 'sales' : 'purchases');
  openInvoiceForm(type, invoice);
}

// ---------------- التشغيل الأولي ----------------
(async function bootstrap() {
  STATE.settings = await window.api.settings.get();
  qs('#brandCompanyName').textContent = STATE.settings.companyName || 'دفتر الفواتير';
  applyBrandLogo();
  navigate('dashboard');
})();
