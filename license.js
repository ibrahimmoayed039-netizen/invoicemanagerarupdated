// license.js — نظام تفعيل محلي بالكامل (بدون إنترنت وبدون خادم)
// المفتاح مقفول على عنوان MAC لجهاز المستخدم، ويحمل مدة صلاحية (أو تفعيل دائم)
// موقّعة رقمياً بحيث لا يمكن توليد مفتاح صالح إلا من ملف مولد المفاتيح
// (key-generator.html) الذي يستخدم نفس المفتاح السرّي أدناه.
//
// ⚠️ مهم: SECRET هنا يجب أن يطابق تماماً SECRET الموجود داخل key-generator.html
// غيّره إلى قيمة عشوائية خاصة بك قبل التوزيع النهائي على العملاء، وحافظ على
// تطابق القيمتين معاً (لن تعمل المفاتيح القديمة إذا غيّرته بعد توزيعها).

const os = require('os');
const crypto = require('crypto');

const SECRET = 'K7pXz2Qf9Wm4Rt6Yb1Ln8Vd3Hs5Gc0Ap-InvoiceManagerAR';
const PERMANENT = 0xffffffff; // قيمة خاصة تعني "تفعيل دائم بدون تاريخ انتهاء"
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ---------------- Base32 (بدون حشو، للأطوال المستخدمة هنا فقط) ----------------
function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += B32_ALPHABET[parseInt(bits.substr(i, 5).padEnd(5, '0'), 2)];
  }
  return out;
}
function base32Decode(str) {
  let bits = '';
  for (const ch of String(str || '').toUpperCase()) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // تجاهل الشرطات والمسافات وأي رمز غير صالح
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
  return Buffer.from(bytes);
}
function formatGroups(str, size) {
  const groups = [];
  for (let i = 0; i < str.length; i += size) groups.push(str.slice(i, i + size));
  return groups.join('-');
}

// ---------------- تحديد عنوان MAC الثابت لهذا الحاسوب ----------------
function pickMac() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.internal) continue;
      if (!iface.mac || iface.mac === '00:00:00:00:00:00') continue;
      candidates.push({ name, mac: iface.mac });
    }
  }
  if (!candidates.length) return null;
  // نفضّل بطاقة الشبكة الفعلية (لان/واي فاي) على أي بطاقة افتراضية (VPN، VMware، إلخ)
  // لأن هذه الأخيرة قد يتغيّر عنوانها أو لا تكون متاحة دائماً
  const isVirtual = (name) => /virtual|vmware|vbox|hyper-v|tap|tailscale|radmin|docker|veth|loopback|wsl|zerotier/i.test(name);
  candidates.sort((a, b) => {
    const av = isVirtual(a.name) ? 1 : 0;
    const bv = isVirtual(b.name) ? 1 : 0;
    if (av !== bv) return av - bv;
    return a.name.localeCompare(b.name);
  });
  return candidates[0].mac.toUpperCase();
}

function machineHash5() {
  const mac = pickMac() || 'NO-MAC-FOUND';
  const full = crypto.createHash('sha256').update('InvoiceManagerAR|' + mac).digest();
  return full.subarray(0, 5); // 40 بت — تكفي هذه الفئة من الاستخدام
}

// رمز الجهاز الذي يُعرض للمستخدم ويرسله للمطوّر لتوليد مفتاح خاص بحاسوبه
function getDeviceId() {
  return formatGroups(base32Encode(machineHash5()), 4); // مثال: AB3F-9KXQ
}

function sign(hash5, expiryUint32) {
  const expBuf = Buffer.alloc(4);
  expBuf.writeUInt32BE(expiryUint32 >>> 0, 0);
  const h = crypto.createHmac('sha256', SECRET).update(Buffer.concat([hash5, expBuf])).digest();
  return h.subarray(0, 6); // توقيع 48 بت
}

// يفكّك مفتاح التفعيل ويتحقق من: التوقيع، تطابق الجهاز، وتاريخ الانتهاء
function verifyKey(rawKey) {
  const cleaned = String(rawKey || '').replace(/[^A-Za-z2-7]/g, '');
  if (cleaned.length !== 24) return { ok: false, reason: 'format' };
  const bytes = base32Decode(cleaned);
  if (bytes.length !== 15) return { ok: false, reason: 'format' };

  const keyHash5 = bytes.subarray(0, 5);
  const expiry = bytes.readUInt32BE(5);
  const sig = bytes.subarray(9, 15);

  const expected = sign(keyHash5, expiry);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) {
    return { ok: false, reason: 'invalid' };
  }

  const myHash5 = machineHash5();
  if (!keyHash5.equals(myHash5)) return { ok: false, reason: 'device_mismatch' };

  if (expiry !== PERMANENT) {
    const expiryDate = new Date(expiry * 1000);
    if (expiryDate.getTime() < Date.now()) return { ok: false, reason: 'expired', expiryDate };
    return { ok: true, permanent: false, expiryDate };
  }
  return { ok: true, permanent: true, expiryDate: null };
}

function checkStoredLicense(db) {
  const settings = db.getSettings();
  const key = settings && settings.licenseKey;
  if (!key) return { ok: false, reason: 'missing' };
  return verifyKey(key);
}

function activate(db, rawKey) {
  const result = verifyKey(rawKey);
  if (result.ok) {
    db.updateSettings({ licenseKey: String(rawKey || '').trim().toUpperCase() });
  }
  return result;
}

function deactivate(db) {
  db.updateSettings({ licenseKey: '' });
  return { ok: true };
}

module.exports = { getDeviceId, verifyKey, checkStoredLicense, activate, deactivate };
