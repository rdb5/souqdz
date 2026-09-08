// ============================================================
// utils.js — أدوات عامة يُعاد استخدامها في كل صفحات التطبيق
// ============================================================

export const qs  = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** تنسيق السعر بالدينار الجزائري */
export function formatDZD(n) {
  const num = Number(n) || 0;
  return `${num.toLocaleString('en-US')} د.ج`;
}

/** تحويل تاريخ unix (ثواني) إلى "منذ ..." */
export function timeAgo(unixSeconds) {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'الآن';
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
  if (diff < 2592000) return `منذ ${Math.floor(diff / 86400)} يوم`;
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString('ar-DZ');
}

/** تفادي حقن HTML */
export function esc(str = '') {
  return String(str)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** تخزين/قراءة JSON بأمان */
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  remove(key) { localStorage.removeItem(key); },
  session: {
    get(key, fallback = null) {
      try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, value) { sessionStorage.setItem(key, JSON.stringify(value)); },
    remove(key) { sessionStorage.removeItem(key); }
  }
};

/** توست إشعار سريع أعلى الشاشة */
export function toast(msg, type = 'info', ms = 3200) {
  let holder = qs('#toast-holder');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'toast-holder';
    document.body.appendChild(holder);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  holder.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** أحرف أولى من اسم/مفتاح لعرضها كصورة رمزية */
export function initialsOf(str = '') {
  const clean = str.replace(/^npub1/, '').trim();
  return clean.slice(0, 2).toUpperCase();
}

/** لون ثابت مُشتق من نص (لأفاتار متسق لكل مستخدم) */
export function colorFromString(str = '') {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hues = ['#1B4B43', '#C4622D', '#8a6c1f', '#2F6B4F', '#5B3A29', '#3D5A80'];
  return hues[Math.abs(hash) % hues.length];
}

/** ضبط عنصر تنقل نشط حسب اسم الملف الحالي */
export function markActiveNav() {
  const page = location.pathname.split('/').pop() || 'index.html';
  qsa('[data-nav]').forEach(a => {
    a.classList.toggle('active', a.getAttribute('data-nav') === page);
  });
}

/** قراءة باراميتر من رابط الصفحة */
export function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

/** تحويل ملف صورة مرفوع إلى base64 dataURL (لعرض معاينة قبل الرفع لخدمة استضافة صور) */
export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** debounce بسيط لصناديق البحث */
export function debounce(fn, wait = 350) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

export const CATEGORIES = [
  { id: 'vehicles',   label: 'سيارات ومركبات', icon: '🚗' },
  { id: 'realestate', label: 'عقارات',          icon: '🏠' },
  { id: 'phones',     label: 'هواتف وتابلت',    icon: '📱' },
  { id: 'electronics',label: 'إلكترونيات',       icon: '💻' },
  { id: 'furniture',  label: 'أثاث ومنزل',       icon: '🛋️' },
  { id: 'fashion',    label: 'أزياء وملابس',     icon: '👗' },
  { id: 'jobs',       label: 'عروض عمل',         icon: '💼' },
  { id: 'services',   label: 'خدمات',            icon: '🛠️' },
  { id: 'animals',    label: 'حيوانات',          icon: '🐑' },
  { id: 'other',      label: 'أخرى',             icon: '📦' },
];

export const WILAYAS = [
  'الجزائر العاصمة','وهران','قسنطينة','عنابة','سطيف','باتنة','بجاية','تلمسان','بليدة','تيزي وزو',
  'بسكرة','ورقلة','سيدي بلعباس','مستغانم','معسكر','الشلف','جيجل','سكيكدة','غرداية','البويرة',
  'المسيلة','تيارت','أم البواقي','برج بوعريريج','خنشلة','تبسة','الوادي','بشار','أدرار','تمنراست'
];
