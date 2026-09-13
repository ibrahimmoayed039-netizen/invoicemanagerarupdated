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
function currencyDecimals(cur) {
  // الدينار العراقي عملياً بلا كسور (لا تُستخدم الفلوس في التعاملات اليومية)
  return cur === 'د.ع' ? 0 : 2;
}
function formatMoney(n) {
  const val = Number(n || 0);
  const cur = (STATE.settings && STATE.settings.currency) || '';
  const d = currencyDecimals(cur);
  return val.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' ' + cur;
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
    statCard('إجمالي المبيعات', formatMoney(summary.totalSales), ''),
    statCard('الباقي من العملاء', formatMoney(summary.totalTheyOweUs), 'owed-us'),
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
      el('td', { class: 'num' }, [formatMoney(h.amount)]),
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
    let theyOweUs = 0, weOweThem = 0;
    const c = customers.find((x) => x.id === id);
    const opening = (c && Number(c.openingBalance)) || 0;
    if (opening > 0) theyOweUs += opening;
    else if (opening < 0) weOweThem += -opening;
    sales.filter((i) => i.customerId === id).forEach((i) => { theyOweUs += i.total - i.paidAmount; });
    purchases.filter((i) => i.customerId === id).forEach((i) => { weOweThem += i.total - i.paidAmount; });
    return { theyOweUs, weOweThem };
  }

  function draw(list) {
    wrap.innerHTML = '';
    if (list.length === 0) {
      wrap.appendChild(emptyState('لا يوجد عملاء', 'اضغط على "عميل جديد" لإضافة أول عميل.'));
      return;
    }
    const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
      el('th', {}, ['الاسم']), el('th', {}, ['الهاتف']), el('th', {}, ['العنوان']),
      el('th', {}, ['الباقي']), el('th', {}, ['إجراءات']),
    ])])]);
    const tbody = el('tbody');
    list.forEach((c) => {
      const bal = balanceFor(c.id);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [c.name]),
        el('td', {}, [c.phone || '—']),
        el('td', {}, [c.address || '—']),
        el('td', { class: 'num' }, [bal.theyOweUs > 0.001 ? el('span', { class: 'amt-us' }, [formatMoney(bal.theyOweUs)]) : '—']),
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
  }
  draw(customers);
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    draw(customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)));
  });
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
  const body = el('div', { class: 'form-grid' }, [
    field('name', 'الاسم *', existing && existing.name),
    field('phone', 'رقم الهاتف', existing && existing.phone),
    moneyField('openingBalance', 'الحساب القديم', existing && existing.openingBalance ? existing.openingBalance : ''),
    fieldFull('address', 'العنوان', existing && existing.address),
    fieldFull('notes', 'ملاحظات', existing && existing.notes, true),
  ]);
  const hint = el('div', { class: 'field-hint' }, ['الحساب القديم: أدخل رقماً موجباً إذا كان للعميل دين من قبل استخدام البرنامج، أو سالباً إذا كنتم مدينين له، واتركه فارغاً إن لم يوجد. أما الحساب الجديد فيُحسب تلقائياً من الفواتير والتسديدات التي تسجّلها داخل البرنامج.']);
  body.insertBefore(hint, body.children[3]);
  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const data = readFields(body, ['name', 'phone', 'address', 'notes', 'openingBalance']);
      if (!data.name.trim()) { toast('الاسم مطلوب', true); return; }
      data.openingBalance = parseMoneyStr(data.openingBalance);
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
    .map((i) => ({ type: 'sale', inv: i }));
  const duePurchases = purchases.filter((i) => i.customerId === customerId && (i.total - i.paidAmount) > 0.001)
    .map((i) => ({ type: 'purchase', inv: i }));
  const dueList = [...dueSales, ...duePurchases];
  const openingDue = customer && Number(customer.openingBalance) > 0.001 ? Number(customer.openingBalance) : 0;
  if (openingDue) dueList.push({ type: 'opening', customer, amount: openingDue });

  if (dueList.length === 0) {
    toast('لا توجد مبالغ مستحقة لهذا العميل', true);
    return;
  }
  if (dueList.length === 1) {
    const item = dueList[0];
    if (item.type === 'opening') openOpeningBalanceSettleForm(item.customer, finish);
    else openPaymentForm(item.type, item.inv, finish);
    return;
  }

  // أكثر من بند مستحق: اعرض المجموع الكلي مع إمكانية التسديد منه دفعة واحدة، أو اختيار بند بعينه
  const getRemaining = (item) => (item.type === 'opening' ? item.amount : (item.inv.total - item.inv.paidAmount));
  const grandTotal = dueList.reduce((sum, item) => sum + getRemaining(item), 0);

  // ترتيب البنود من الأقدم للأحدث عند التوزيع (الرصيد السابق يُعتبر الأقدم دائماً)
  const sortedForSettlement = dueList.slice().sort((a, b) => {
    if (a.type === 'opening') return -1;
    if (b.type === 'opening') return 1;
    return new Date(a.inv.date) - new Date(b.inv.date);
  });

  const totalAmountInput = moneyInput({ class: 'input', placeholder: 'أدخل المبلغ المدفوع' });
  const totalDateInput = el('input', { class: 'input', type: 'date', value: todayInputValue() });
  const totalNotesInput = el('textarea', { class: 'input', rows: 2 });

  const settleFromTotal = async () => {
    let leftover = numVal(totalAmountInput);
    if (leftover <= 0) { toast('أدخل مبلغاً صحيحاً أكبر من صفر', true); return; }
    const paymentDate = totalDateInput.value ? new Date(totalDateInput.value).toISOString() : new Date().toISOString();
    const notes = totalNotesInput.value;
    const batchId = 'batch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    for (const item of sortedForSettlement) {
      if (leftover <= 0.001) break;
      const remaining = getRemaining(item);
      if (remaining <= 0.001) continue;
      const applied = Math.min(leftover, remaining);
      if (item.type === 'opening') {
        const newBalance = (Number(item.customer.openingBalance) || 0) - applied;
        await window.api.customers.update(item.customer.id, { openingBalance: newBalance });
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

  const body = el('div', {}, [
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field field-full' }, [el('label', {}, ['المجموع الكلي المستحق']), el('div', { style: 'font-weight:700;font-size:1.1em' }, [formatMoney(grandTotal)])]),
    ]),
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [el('label', {}, ['المبلغ المدفوع الآن (من المجموع)']), totalAmountInput]),
      el('div', { class: 'field' }, [el('label', {}, ['تاريخ الدفعة']), totalDateInput]),
      el('div', { class: 'field field-full' }, [el('label', {}, ['ملاحظات']), totalNotesInput]),
      el('div', { class: 'field field-full' }, [el('button', { class: 'btn btn-primary', onclick: settleFromTotal }, ['تسديد من المجموع الكلي'])]),
    ]),
    el('div', { class: 'section-title' }, ['أو اختر بنداً محدداً للتسديد']),
    el('div', { class: 'table-wrap' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', {}, ['البند']), el('th', {}, ['النوع']), el('th', {}, ['المتبقي']), el('th', {}, ['']),
        ])]),
        el('tbody', {}, dueList.map((item) => {
          const isOpening = item.type === 'opening';
          const label = isOpening ? 'حساب قديم' : item.inv.number;
          const typeLabel = isOpening ? '—' : (item.type === 'sale' ? 'بيع' : 'شراء');
          const amount = getRemaining(item);
          return el('tr', {}, [
            el('td', {}, [label]),
            el('td', {}, [typeLabel]),
            el('td', { class: 'num' }, [formatMoney(amount)]),
            el('td', {}, [el('button', {
              class: 'btn btn-primary btn-sm',
              onclick: () => {
                closeModal();
                if (isOpening) openOpeningBalanceSettleForm(item.customer, finish);
                else openPaymentForm(item.type, item.inv, finish);
              },
            }, ['تسديد'])]),
          ]);
        })),
      ]),
    ]),
  ]);
  openModal('اختر البند المراد تسديده', body, [el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إلغاء'])]);
}

function openOpeningBalanceSettleForm(customer, onDone) {
  const body = el('div', { class: 'form-grid single' }, [
    moneyField('amount', 'المبلغ المسدد', customer.openingBalance),
  ]);
  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const raw = readFields(body, ['amount']);
      const amount = parseMoneyStr(raw.amount);
      if (amount <= 0) { toast('أدخل مبلغاً صحيحاً أكبر من صفر', true); return; }
      const newBalance = (Number(customer.openingBalance) || 0) - amount;
      await window.api.customers.update(customer.id, { openingBalance: newBalance });
      closeModal();
      toast('تم تسجيل تسديد الرصيد السابق');
      if (onDone) onDone();
    }}, ['تسجيل التسديد']),
    el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إلغاء']),
  ];
  openModal('تسديد الحساب القديم — ' + customer.name, body, footer);
}

async function openCustomerProfile(id) {
  const [customer, sales, payments] = await Promise.all([
    window.api.customers.get(id),
    window.api.invoices.listSale(),
    window.api.payments.list(),
  ]);
  const mySales = sales.filter((i) => i.customerId === id);
  const myPayments = payments.filter((p) => p.customerId === id);

  const ledger = buildCustomerLedger(customer, mySales, myPayments);
  const currentBalance = ledger.length ? ledger[ledger.length - 1].balance : 0;
  const balanceLabel = currentBalance > 0.001 ? ' (الباقي)' : ' (مسدد بالكامل)';

  const body = el('div', {}, [
    el('div', { class: 'form-grid' }, [
      infoLine('الهاتف', customer.phone || '—'),
      infoLine('العنوان', customer.address || '—'),
      infoLine('الرصيد الحالي', formatMoney(Math.abs(currentBalance)) + balanceLabel),
    ]),
    el('div', { class: 'section-title' }, ['دفتر الحساب (بيع وتسديد)']),
    customerLedgerTable(ledger.slice().reverse()),
  ]);
  const footer = [
    el('button', { class: 'btn btn-primary', onclick: () => { closeModal(); printCustomerStatement(customer.id); } }, ['🖨 طباعة كشف حساب']),
    el('button', { class: 'btn btn-ghost', onclick: closeModal }, ['إغلاق']),
  ];
  openModal('ملف العميل: ' + customer.name, body, footer, true);
}

// يبني سجل حركات العميل (حساب قديم + فواتير بيع + تسديدات) مرتباً بالتاريخ مع إجمالي متحرك
function buildCustomerLedger(customer, sales, payments) {
  const opening = Number(customer && customer.openingBalance) || 0;
  const events = [];
  if (opening) {
    events.push({ date: (customer && customer.createdAt) || new Date(0).toISOString(), label: 'حساب قديم', amount: opening });
  }
  sales.forEach((i) => {
    events.push({ date: i.date, label: 'فاتورة بيع ' + i.number, amount: i.total });
    // أي مبلغ دُفع عند إنشاء/تعديل الفاتورة مباشرة (paidAmount) دون المرور بعملية "تسديد" منفصلة
    const paidViaPayments = payments
      .filter((p) => p.invoiceType === 'sale' && p.invoiceId === i.id)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const paidAtCreation = Math.max(0, (Number(i.paidAmount) || 0) - paidViaPayments);
    if (paidAtCreation > 0.001) {
      events.push({ date: i.date, label: 'دفعة عند البيع — فاتورة ' + i.number, amount: -paidAtCreation });
    }
  });
  const salePayments = payments.filter((p) => p.invoiceType === 'sale');
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
  single.forEach((p) => events.push({ date: p.date, label: 'تسديد — فاتورة ' + p.invoiceNumber, amount: -p.amount }));
  Object.values(batched).forEach((b) => events.push({ date: b.date, label: 'تسديد', amount: -b.amount }));
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  return events.map((e) => {
    running += e.amount;
    return { date: e.date, label: e.label, amount: e.amount, balance: running };
  });
}

function customerLedgerTable(events) {
  if (events.length === 0) return emptyState('لا توجد حركات بعد', 'أضف فاتورة بيع لهذا العميل ليبدأ ظهور الحركات هنا.');
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
    el('th', {}, ['التاريخ']), el('th', {}, ['البيان']), el('th', {}, ['المبلغ']), el('th', {}, ['الإجمالي']),
  ])])]);
  const tbody = el('tbody');
  events.forEach((e) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [formatDate(e.date, true)]),
      el('td', {}, [e.label]),
      el('td', { class: 'num' }, [el('span', { class: e.amount >= 0 ? 'amt-us' : 'amt-them' }, [formatMoney(Math.abs(e.amount))])]),
      el('td', { class: 'num' }, [Math.abs(e.balance) > 0.001 ? el('span', { class: e.balance >= 0 ? 'amt-us' : 'amt-them' }, [formatMoney(Math.abs(e.balance))]) : formatMoney(0)]),
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function paymentsHistoryTable(list) {
  if (list.length === 0) return emptyState('لا توجد تسديدات بعد', '');
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
    el('th', {}, ['التاريخ']), el('th', {}, ['نوع الفاتورة']), el('th', {}, ['رقم الفاتورة']), el('th', {}, ['المبلغ المسدد']), el('th', {}, ['ملاحظات']),
  ])])]);
  const tbody = el('tbody');
  list.forEach((p) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [formatDate(p.date, true)]),
      el('td', {}, [p.invoiceType === 'sale' ? 'بيع (وارد منّا)' : 'شراء (صادر لنا)']),
      el('td', {}, [p.invoiceNumber]),
      el('td', { class: 'num' }, [formatMoney(p.amount)]),
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
    const remaining = i.total - i.paidAmount;
    const actions = [['🖨 طباعة', () => printInvoice(type, i.id)]];
    if (remaining > 0.001) actions.push(['تسديد', () => openPaymentForm(type, i, onPaid)]);
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [i.number]), el('td', {}, [formatDate(i.date, true)]),
      el('td', { class: 'num' }, [formatMoney(i.total)]),
      el('td', { class: 'num' }, [remaining > 0.001 ? el('span', { class: remClass }, [formatMoney(remaining)]) : 'مسددة']),
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

  function draw() {
    const custId = custFilter.value;
    const st = statusFilter.value;
    const list = invoices.filter((i) => (!custId || i.customerId === custId) && (!st || statusOf(i) === st));
    wrap.innerHTML = '';
    if (list.length === 0) {
      wrap.appendChild(emptyState('لا توجد فواتير', 'اضغط على "' + addLabel + '" لإنشاء أول فاتورة.'));
      return;
    }
    const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
      el('th', {}, ['رقم الفاتورة']), el('th', {}, ['العميل']), el('th', {}, ['التاريخ']),
      el('th', {}, ['الإجمالي']), el('th', {}, ['المتبقي']), el('th', {}, ['الحالة']), el('th', {}, ['إجراءات']),
    ])])]);
    const tbody = el('tbody');
    list.forEach((inv) => {
      const s = statusOf(inv);
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
        el('td', { class: 'num' }, [formatMoney(inv.total)]),
        el('td', { class: 'num' }, [(() => {
          const remaining = inv.total - inv.paidAmount;
          return remaining > 0.001 ? el('span', { class: type === 'sale' ? 'amt-us' : 'amt-them' }, [formatMoney(remaining)]) : formatMoney(0);
        })()]),
        el('td', {}, [statusBadge(s)]),
        el('td', {}, [rowActions(actions)]),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }
  custFilter.addEventListener('change', draw);
  statusFilter.addEventListener('change', draw);
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
  body.appendChild(grid);

  const amountLabel = type === 'sale' ? 'المبلغ (الأساسي)' : 'المبلغ (مطلوب)';
  const amountInput = moneyInput({ class: 'input', value: existing ? existing.amount : 0 });
  const discountInput = moneyInput({ class: 'input', value: existing ? existing.discount : 0 });
  const paidInput = moneyInput({ class: 'input', value: existing ? existing.paidAmount : 0 });
  const notesInput = el('textarea', { class: 'input', rows: 2 }, [existing ? existing.notes : '']);
  const grandTotalLine = el('div', { style: 'text-align:left; font-weight:700; margin-top:10px; font-size:15px' }, ['الإجمالي: 0.00']);

  function recalcTotals() {
    const total = Math.max(0, numVal(amountInput) - numVal(discountInput));
    const d = currencyDecimals((STATE.settings && STATE.settings.currency) || '');
    grandTotalLine.textContent = 'الإجمالي: ' + total.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
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
  recalcTotals();

  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const amount = numVal(amountInput);
      if (amount <= 0) { toast('أدخل مبلغاً أكبر من صفر', true); return; }
      const data = {
        customerId: custSelect.value,
        date: dateInput.value ? new Date(dateInput.value).toISOString() : new Date().toISOString(),
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

function openPaymentForm(type, invoice, onDone) {
  const remaining = invoice.total - invoice.paidAmount;
  const amountInput = moneyInput({ class: 'input', placeholder: 'أدخل المبلغ المدفوع' });
  const dateInput = el('input', { class: 'input', type: 'date', value: todayInputValue() });
  const notesInput = el('textarea', { class: 'input', rows: 2 });
  const body = el('div', { class: 'form-grid' }, [
    el('div', { class: 'field' }, [el('label', {}, ['المتبقي الحالي']), el('div', {}, [formatMoney(remaining)])]),
    el('div', { class: 'field' }, [el('label', {}, ['المبلغ المدفوع الآن']), amountInput]),
    el('div', { class: 'field' }, [el('label', {}, ['تاريخ الدفعة']), dateInput]),
    el('div', { class: 'field field-full' }, [el('label', {}, ['ملاحظات']), notesInput]),
  ]);
  const footer = [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const amount = numVal(amountInput);
      if (amount <= 0) { toast('أدخل مبلغاً صحيحاً', true); return; }
      const res = await window.api.payments.add({
        invoiceId: invoice.id,
        invoiceType: type,
        amount,
        date: dateInput.value ? new Date(dateInput.value).toISOString() : new Date().toISOString(),
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

  const owed = dues
    .filter((d) => d.theyOweUs > 0.001)
    .sort((a, b) => b.theyOweUs - a.theyOweUs);

  if (owed.length === 0) {
    area.appendChild(emptyState('لا توجد مبالغ مستحقة على العملاء', 'جميع العملاء مسددون بالكامل.'));
    return;
  }
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
    el('th', {}, ['العميل']), el('th', {}, ['الهاتف']), el('th', {}, ['المبلغ المستحق']), el('th', {}, ['إجراءات']),
  ])])]);
  const tbody = el('tbody');
  owed.forEach((d) => {
    const cust = custById[d.customerId];
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [d.customerName]),
      el('td', {}, [(cust && cust.phone) || '—']),
      el('td', { class: 'num' }, [el('span', { class: 'amt-us' }, [formatMoney(d.theyOweUs)])]),
      el('td', {}, [rowActions([
        ['تسديد', () => quickSettleForCustomer(d.customerId, () => navigate('dues'))],
        ['عرض الملف', () => openCustomerProfile(d.customerId)],
        ['كشف حساب', () => printCustomerStatement(d.customerId)],
      ])]),
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  area.appendChild(wrap);
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
  function draw() {
    const list = filtered();
    wrap.innerHTML = '';
    if (list.length === 0) { wrap.appendChild(emptyState('لا توجد نتائج', 'جرّب تغيير عوامل التصفية.')); return; }
    const table = el('table', {}, [el('thead', {}, [el('tr', {}, [
      el('th', {}, ['التاريخ']), el('th', {}, ['العميل']), el('th', {}, ['نوع الحركة']), el('th', {}, ['التفاصيل']), el('th', {}, ['المبلغ']),
    ])])]);
    const tbody = el('tbody');
    list.forEach((h) => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [formatDate(h.date, true)]),
        el('td', {}, [customerName(h.customerId)]),
        el('td', {}, [KIND_LABEL[h.kind] || h.kind]),
        el('td', {}, [h.label]),
        el('td', { class: 'num' }, [formatMoney(h.amount)]),
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }
  [kindFilter, custFilter, fromInput, toInput].forEach((i) => i.addEventListener('input', draw));
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
  const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: currencyDecimals(cur), maximumFractionDigits: currencyDecimals(cur) }) + ' ' + cur;

  const totalSales = sales.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const totalPurchases = purchases.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const dueSales = sales.reduce((s, i) => s + Math.max((Number(i.total) || 0) - (Number(i.paidAmount) || 0), 0), 0);
  const duePurchases = purchases.reduce((s, i) => s + Math.max((Number(i.total) || 0) - (Number(i.paidAmount) || 0), 0), 0);

  const rows = [
    ['اسم الشركة داخل الملف', (data.settings && data.settings.companyName) || '—'],
    ['تاريخ الملف', res.fileDate ? formatDate(res.fileDate, true) : '—'],
    ['عدد العملاء', String(customers.length)],
    ['عدد فواتير البيع', String(sales.length) + ' — إجمالي ' + money(totalSales)],
    ['عدد فواتير الشراء', String(purchases.length) + ' — إجمالي ' + money(totalPurchases)],
    ['عدد الدفعات المسجّلة', String(payments.length)],
    ['الباقي (غير مسدد)', money(dueSales)],
    ['المستحق علينا (غير مسدد)', money(duePurchases)],
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

  const currencySelect = el('select', { class: 'input', 'data-field': 'currency' }, [
    'د.ع', 'دينار', 'ريال', 'دولار', 'جنيه', 'درهم'
  ].map((c) => el('option', { value: c, selected: settings.currency === c ? 'selected' : undefined }, [c === 'د.ع' ? 'دينار عراقي (د.ع)' : c])));
  body.appendChild(el('div', { class: 'field' }, [el('label', {}, ['العملة']), currencySelect]));

  area.appendChild(body);

  area.appendChild(el('div', { class: 'section-title' }, ['حفظ ونسخ احتياطي']));
  const actions = el('div', { class: 'toolbar' });
  actions.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
    const data = readFields(body, ['companyName', 'companyPhone', 'companyAddress']);
    data.currency = currencySelect.value;
    STATE.settings = await window.api.settings.update(data);
    toast('تم حفظ الإعدادات');
    qs('#brandCompanyName').textContent = STATE.settings.companyName || 'دفتر الفواتير';
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

  area.appendChild(el('div', { class: 'section-title' }, ['معلومات الترقيم']));
  area.appendChild(el('div', {}, [
    'آخر رقم فاتورة بيع: ' + settings.saleInvoiceCounter + ' — آخر رقم فاتورة شراء: ' + settings.purchaseInvoiceCounter,
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
  return (
    '<div class="doc-header">' +
      '<div>' +
        '<h2>' + esc(s.companyName || 'المنشأة') + '</h2>' +
        '<div class="doc-meta">' + esc(s.companyPhone || '') + (s.companyPhone && s.companyAddress ? ' — ' : '') + esc(s.companyAddress || '') + '</div>' +
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
  const label = type === 'sale' ? 'فاتورة بيع' : 'فاتورة شراء';
  const meta = '<div class="doc-meta">رقم: ' + esc(inv.number) + '<br/>التاريخ: ' + formatDate(inv.date, true) + '</div>';

  const amountLabel = type === 'sale' ? 'المبلغ (الأساسي)' : 'المبلغ (مطلوب)';

  const html =
    docHeaderHtml(label, meta) +
    '<div class="doc-section-title">بيانات ' + (type === 'sale' ? 'العميل' : 'المورّد') + '</div>' +
    '<div>' + esc(cust ? cust.name : '') + (cust && cust.phone ? ' — ' + esc(cust.phone) : '') + '</div>' +
    '<div class="doc-totals">' +
      '<div><span>' + amountLabel + '</span><span>' + formatMoney(inv.amount) + '</span></div>' +
      '<div><span>الخصم</span><span>' + formatMoney(inv.discount) + '</span></div>' +
      '<div class="grand"><span>الإجمالي</span><span>' + formatMoney(inv.total) + '</span></div>' +
      '<div><span>المدفوع</span><span>' + formatMoney(inv.paidAmount) + '</span></div>' +
      '<div><span>المتبقي</span><span>' + formatMoney(inv.total - inv.paidAmount) + '</span></div>' +
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

  const opening = Number(customer.openingBalance) || 0;
  const events = [];
  if (opening) {
    events.push({
      date: customer.createdAt || new Date(0).toISOString(),
      label: 'حساب قديم',
      debit: opening > 0 ? opening : 0,
      credit: opening < 0 ? -opening : 0,
    });
  }
  mySales.forEach((i) => {
    events.push({ date: i.date, label: 'فاتورة بيع ' + i.number, debit: i.total, credit: 0 });
    const paidViaPayments = myPayments.filter((p) => p.invoiceType === 'sale' && p.invoiceId === i.id).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const paidAtCreation = Math.max(0, (Number(i.paidAmount) || 0) - paidViaPayments);
    if (paidAtCreation > 0.001) events.push({ date: i.date, label: 'دفعة عند البيع — فاتورة ' + i.number, debit: 0, credit: paidAtCreation });
  });
  myPurchases.forEach((i) => {
    events.push({ date: i.date, label: 'فاتورة شراء ' + i.number, debit: 0, credit: i.total });
    const paidViaPayments = myPayments.filter((p) => p.invoiceType === 'purchase' && p.invoiceId === i.id).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const paidAtCreation = Math.max(0, (Number(i.paidAmount) || 0) - paidViaPayments);
    if (paidAtCreation > 0.001) events.push({ date: i.date, label: 'دفعة عند الشراء — فاتورة ' + i.number, debit: paidAtCreation, credit: 0 });
  });
  const batchedSale = {}, batchedPurchase = {};
  const singlePayments = [];
  myPayments.forEach((p) => {
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
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  let rows = '';
  events.forEach((e) => {
    rows += '<tr><td>' + formatDate(e.date, true) + '</td><td>' + esc(e.label) + '</td><td>' + (e.debit ? '<span class="amt-us">' + formatMoney(e.debit) + '</span>' : '—') + '</td><td>' + (e.credit ? '<span class="amt-them">' + formatMoney(e.credit) + '</span>' : '—') + '</td></tr>';
  });
  const theyOweUs = mySales.reduce((s, i) => s + (i.total - i.paidAmount), 0) + (opening > 0 ? opening : 0);
  const weOweThem = myPurchases.reduce((s, i) => s + (i.total - i.paidAmount), 0) + (opening < 0 ? -opening : 0);

  const meta = '<div class="doc-meta">العميل: ' + esc(customer.name) + '<br/>تاريخ التقرير: ' + formatDate(new Date().toISOString()) + '</div>';
  const html =
    docHeaderHtml('كشف حساب', meta) +
    '<table class="doc-table"><thead><tr><th>التاريخ</th><th>الحركة</th><th>مدين</th><th>دائن</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="doc-totals">' +
      '<div class="grand"><span>إجمالي الباقي</span><span class="amt-us">' + formatMoney(theyOweUs) + '</span></div>' +
    '</div>' +
    '<div class="doc-footer">تم إنشاء هذا المستند بواسطة دفتر الفواتير — ' + formatDate(new Date().toISOString(), true) + '</div>';

  openPrintPreview(html, 'كشف-حساب-' + (customer ? customer.name : ''));
}

function printHistoryReport(list) {
  let rows = '';
  const KIND_LABEL = { sale_invoice: 'فاتورة بيع', purchase_invoice: 'فاتورة شراء', sale_payment: 'دفعة بيع', purchase_payment: 'دفعة شراء' };
  list.forEach((h) => {
    rows += '<tr><td>' + formatDate(h.date, true) + '</td><td>' + esc(customerName(h.customerId)) + '</td><td>' + (KIND_LABEL[h.kind] || h.kind) + '</td><td>' + formatMoney(h.amount) + '</td></tr>';
  });
  const total = list.reduce((s, h) => s + h.amount, 0);
  const meta = '<div class="doc-meta">عدد الحركات: ' + list.length + '<br/>تاريخ التقرير: ' + formatDate(new Date().toISOString()) + '</div>';
  const html =
    docHeaderHtml('تقرير السجل', meta) +
    '<table class="doc-table"><thead><tr><th>التاريخ</th><th>العميل</th><th>نوع الحركة</th><th>المبلغ</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="doc-totals"><div class="grand"><span>إجمالي المبالغ</span><span>' + formatMoney(total) + '</span></div></div>' +
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
  navigate('dashboard');
})();
