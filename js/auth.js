// ============================================================
// auth.js — تسجيل الدخول/الخروج، وحماية الصفحات التي تتطلب جلسة
// ============================================================

import {
  createIdentity, identityFromNsec, saveSession, getSession, clearSession,
  hasNip07, publishProfile, fetchProfile
} from './nostr-client.js';
import { toast, qs, qsa, store } from './utils.js';

/** يجب استدعاؤها في أعلى كل صفحة محمية (غير index/login) */
export function requireAuth() {
  const session = getSession();
  if (!session) {
    location.href = 'login.html';
    return null;
  }
  return session;
}

export function logout() {
  clearSession();
  toast('تم تسجيل الخروج', 'info');
  setTimeout(() => location.href = 'login.html', 600);
}

/* -----------------------------------------------------------
   تهيئة شاشة تسجيل الدخول (login.html)
----------------------------------------------------------- */
export function initLoginPage() {
  const existing = getSession();
  if (existing) { location.href = 'index.html'; return; }

  const tabNew = qs('#tab-new');
  const tabExisting = qs('#tab-existing');
  const panelNew = qs('#panel-new');
  const panelExisting = qs('#panel-existing');

  tabNew?.addEventListener('click', () => switchTab('new'));
  tabExisting?.addEventListener('click', () => switchTab('existing'));

  function switchTab(which) {
    tabNew.classList.toggle('active', which === 'new');
    tabExisting.classList.toggle('active', which === 'existing');
    panelNew.classList.toggle('hide-mobile-force', which !== 'new');
    panelNew.style.display = which === 'new' ? 'block' : 'none';
    panelExisting.style.display = which === 'existing' ? 'block' : 'none';
  }

  // إنشاء حساب Nostr جديد بالكامل من المتصفح (لا سيرفر يرى المفتاح أبداً)
  qs('#btn-generate')?.addEventListener('click', () => {
    const id = createIdentity();
    qs('#new-npub').textContent = id.npub;
    qs('#new-nsec').textContent = id.nsec;
    qs('#generated-box').style.display = 'block';
    qs('#btn-confirm-new').dataset.identity = JSON.stringify(id);
    qs('#btn-confirm-new').disabled = false;
  });

  qs('#confirm-saved-key')?.addEventListener('change', (e) => {
    qs('#btn-confirm-new').disabled = !e.target.checked;
  });

  qs('#btn-confirm-new')?.addEventListener('click', async (e) => {
    const id = JSON.parse(e.target.dataset.identity);
    const remember = qs('#remember-new')?.checked ?? true;
    saveSession(id, remember);
    await ensureDefaultProfile(id);
    toast('تم إنشاء حسابك بنجاح، أهلاً بك في سوق دي زد 🎉', 'success');
    setTimeout(() => location.href = 'index.html', 700);
  });

  // الدخول بمفتاح موجود (nsec)
  qs('#form-existing')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = qs('#input-nsec').value.trim();
    if (!val) return toast('أدخل المفتاح الخاص (nsec) أولاً', 'error');
    try {
      const id = identityFromNsec(val);
      const remember = qs('#remember-existing')?.checked ?? true;
      saveSession(id, remember);
      toast('تم تسجيل الدخول', 'success');
      setTimeout(() => location.href = 'index.html', 500);
    } catch (err) {
      toast('المفتاح غير صالح، تحقق من نسخه بالكامل', 'error');
    }
  });

  // الدخول عبر إضافة المتصفح (NIP-07: Alby, nos2x...)
  const nip07Btn = qs('#btn-nip07');
  if (nip07Btn) {
    if (!hasNip07()) {
      nip07Btn.disabled = true;
      nip07Btn.title = 'لم يتم العثور على إضافة Nostr في متصفحك';
    }
    nip07Btn.addEventListener('click', async () => {
      try {
        const pub = await window.nostr.getPublicKey();
        const id = { privHex: '', pubHex: pub, npub: '', nsec: '' };
        saveSession(id, true);
        toast('تم تسجيل الدخول عبر الإضافة', 'success');
        setTimeout(() => location.href = 'index.html', 500);
      } catch {
        toast('تم رفض الاتصال بالإضافة', 'error');
      }
    });
  }

  switchTab('new');
}

async function ensureDefaultProfile(id) {
  try {
    const existing = await fetchProfile(id.pubHex);
    if (!existing) {
      await publishProfile({ name: 'بائع جديد', about: 'عضو في سوق دي زد 🇩🇿', wilaya: '' }, id.privHex);
    }
  } catch { /* لا مشكلة إن فشل، يمكن إكمال الملف لاحقاً */ }
}

/* -----------------------------------------------------------
   بناء الهيدر + التنقل السفلي/الجانبي في كل صفحة تلقائيًا
----------------------------------------------------------- */
export function renderShell({ activePage, title = 'سوق دي زد', showBack = false } = {}) {
  const header = document.createElement('div');
  header.className = 'topbar';
  header.innerHTML = `
    ${showBack
      ? `<button class="icon-btn" onclick="history.back()">←</button>`
      : `<a href="index.html" class="logo"><span class="mark">🛍️</span><span class="hide-mobile">سوق دي زد</span></a>`}
    <div class="searchbox hide-mobile">
      <span>🔎</span>
      <input placeholder="ابحث عن منتج، خدمة، سيارة..." onkeydown="if(event.key==='Enter') location.href='search.html?q='+encodeURIComponent(this.value)"/>
    </div>
    <a href="search.html" class="icon-btn hide-desktop">🔎</a>
    <a href="notifications.html" class="icon-btn" data-nav="notifications.html">🔔<span id="notif-count" class="badge-dot" style="display:none">0</span></a>
    <a href="messages.html" class="icon-btn" data-nav="messages.html">✉️<span id="msg-count" class="badge-dot" style="display:none">0</span></a>
  `;
  document.body.prepend(header);

  const nav = document.createElement('div');
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    <a href="index.html" data-nav="index.html"><span class="ic">🏠</span>الرئيسية</a>
    <a href="categories.html" data-nav="categories.html"><span class="ic">📂</span>التصنيفات</a>
    <a href="sell.html" class="fab" data-nav="sell.html">+</a>
    <a href="orders.html" data-nav="orders.html"><span class="ic">📦</span>طلباتي</a>
    <a href="profile.html" data-nav="profile.html"><span class="ic">👤</span>حسابي</a>
  `;
  document.body.appendChild(nav);

  qsa('[data-nav]').forEach(a => {
    if (a.getAttribute('data-nav') === activePage) a.classList.add('active');
  });
  document.title = `${title} · سوق دي زد`;
}

export function renderSidebarInto(container, activePage) {
  const el = document.createElement('div');
  el.className = 'sidebar';
  el.innerHTML = `
    <a href="index.html" data-nav="index.html">🏠 الرئيسية</a>
    <a href="categories.html" data-nav="categories.html">📂 كل التصنيفات</a>
    <a href="sell.html" data-nav="sell.html">➕ أضف إعلانًا</a>
    <a href="cart.html" data-nav="cart.html">🛒 السلة</a>
    <a href="orders.html" data-nav="orders.html">📦 طلباتي</a>
    <a href="messages.html" data-nav="messages.html">✉️ الرسائل</a>
    <a href="notifications.html" data-nav="notifications.html">🔔 الإشعارات</a>
    <a href="wallet.html" data-nav="wallet.html">⚡ المحفظة</a>
    <a href="seller-dashboard.html" data-nav="seller-dashboard.html">📊 لوحة البائع</a>
    <a href="settings.html" data-nav="settings.html">⚙️ الإعدادات</a>
  `;
  container.prepend(el);
  qsa('[data-nav]', el).forEach(a => { if (a.getAttribute('data-nav') === activePage) a.classList.add('active'); });
}
