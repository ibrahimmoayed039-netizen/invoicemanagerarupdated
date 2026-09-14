// activation.js — منطق شاشة تفعيل البرنامج (تُعرض عند عدم وجود ترخيص صالح)

function qs(sel) { return document.querySelector(sel); }

function showStatus(message, kind) {
  const box = qs('#actStatusMsg');
  box.textContent = message;
  box.classList.remove('hidden', 'error', 'success');
  box.classList.add(kind === 'success' ? 'success' : 'error');
}

function reasonMessage(status) {
  switch (status.reason) {
    case 'expired':
      return 'انتهت صلاحية الترخيص' + (status.expiryDate ? (' بتاريخ ' + new Date(status.expiryDate).toLocaleDateString('ar')) : '') + '. يرجى إدخال مفتاح تفعيل جديد.';
    case 'device_mismatch':
      return 'هذا المفتاح غير مخصّص لهذا الحاسوب.';
    case 'invalid':
      return 'مفتاح التفعيل غير صحيح.';
    case 'format':
      return 'صيغة مفتاح التفعيل غير صحيحة، تأكد من نسخه كاملاً.';
    case 'missing':
    default:
      return '';
  }
}

async function init() {
  const status = await window.api.license.getStatus();
  qs('#actDeviceId').value = status.deviceId;

  const msg = reasonMessage(status);
  if (msg) showStatus(msg, 'error');

  qs('#actCopyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(status.deviceId);
      qs('#actCopyBtn').textContent = 'تم النسخ ✓';
      setTimeout(() => { qs('#actCopyBtn').textContent = 'نسخ'; }, 1800);
    } catch (_) {
      qs('#actDeviceId').select();
    }
  });

  qs('#actWhatsappBtn').addEventListener('click', () => {
    const text = encodeURIComponent('السلام عليكم، أرغب بمفتاح تفعيل لبرنامج دفتر الفواتير. رمز الجهاز: ' + status.deviceId);
    window.api.system.openExternal('https://wa.me/9647736970504?text=' + text);
  });

  qs('#actSubmitBtn').addEventListener('click', submitKey);
  qs('#actKeyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitKey();
  });
}

async function submitKey() {
  const input = qs('#actKeyInput');
  const btn = qs('#actSubmitBtn');
  const key = input.value.trim();
  if (!key) {
    showStatus('يرجى إدخال مفتاح التفعيل.', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'جارِ التحقق…';
  const result = await window.api.license.activate(key);
  btn.disabled = false;
  btn.textContent = 'تفعيل البرنامج';

  if (result.ok) {
    const successMsg = result.permanent
      ? 'تم التفعيل بنجاح — تفعيل دائم.'
      : 'تم التفعيل بنجاح — ساري حتى ' + new Date(result.expiryDate).toLocaleDateString('ar');
    showStatus(successMsg, 'success');
    setTimeout(() => { window.api.license.enterApp(); }, 900);
  } else {
    showStatus(reasonMessage(result) || 'تعذّر التفعيل، تحقّق من المفتاح وحاول مجدداً.', 'error');
  }
}

init();
