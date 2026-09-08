// ============================================================
// marketplace.js — كل منطق عرض/نشر/بحث الإعلانات
// ============================================================

import {
  fetchListings, fetchListingById, publishListing, setListingStatus,
  fetchProfile, hexToNpub, npubToHex
} from './nostr-client.js';
import { formatDZD, timeAgo, esc, qs, qsa, toast, CATEGORIES, WILAYAS, getParam, fileToDataURL, debounce } from './utils.js';

/* -----------------------------------------------------------
   بطاقة منتج (تُستخدم في الرئيسية، التصنيفات، البحث، لوحة البائع)
----------------------------------------------------------- */
export function listingCardHTML(l) {
  const cat = CATEGORIES.find(c => c.id === l.category);
  const img = l.images?.[0];
  return `
    <a href="product.html?id=${encodeURIComponent(l.dTag)}&author=${l.author}" class="product-card">
      <div class="thumb" style="${img ? `background-image:url('${esc(img)}')` : ''}">
        ${img ? '' : (cat?.icon || '📦')}
        <span class="price-tag num">${formatDZD(l.price)}</span>
      </div>
      <div class="body">
        <div class="title">${esc(l.title)}</div>
        <div class="meta"><span>${esc(l.wilaya || 'الجزائر')}</span><span>${timeAgo(l.created_at)}</span></div>
      </div>
    </a>`;
}

function emptyStateHTML(msg = 'لا توجد إعلانات هنا بعد') {
  return `<div class="empty-state"><div class="ic">🕊️</div><h3>${msg}</h3><p>كن أول من ينشر هنا!</p>
    <a href="sell.html" class="btn btn-primary" style="margin-top:10px">أضف إعلانك الآن</a></div>`;
}

function loadingHTML() {
  return `<div class="loading-row"><span class="spinner"></span> جاري الجلب من شبكة Nostr...</div>`;
}

/* -----------------------------------------------------------
   الصفحة الرئيسية (index.html)
----------------------------------------------------------- */
export async function initHomePage() {
  const grid = qs('#home-grid');
  const chipRow = qs('#home-chips');
  if (chipRow) {
    chipRow.innerHTML = `<a class="chip active" href="index.html">الكل</a>` +
      CATEGORIES.map(c => `<a class="chip" href="categories.html?cat=${c.id}">${c.icon} ${c.label}</a>`).join('');
  }
  if (!grid) return;
  grid.innerHTML = loadingHTML();
  try {
    const listings = await fetchListings({ limit: 40 });
    grid.innerHTML = listings.length ? listings.map(listingCardHTML).join('') : emptyStateHTML('لا توجد إعلانات منشورة حالياً');
  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><div class="ic">⚠️</div><h3>تعذّر الاتصال بالريلايز</h3><p>تحقق من اتصالك بالإنترنت أو غيّر الريلايز من الإعدادات</p></div>`;
  }
}

/* -----------------------------------------------------------
   صفحة التصنيفات (categories.html)
----------------------------------------------------------- */
export async function initCategoriesPage() {
  const list = qs('#cat-list');
  const grid = qs('#cat-grid');
  const titleEl = qs('#cat-title');
  const selected = getParam('cat');

  if (list) {
    list.innerHTML = CATEGORIES.map(c => `
      <a class="chip ${c.id === selected ? 'active' : ''}" href="categories.html?cat=${c.id}">${c.icon} ${c.label}</a>
    `).join('');
  }

  if (!grid) return;
  const catObj = CATEGORIES.find(c => c.id === selected);
  if (titleEl) titleEl.textContent = catObj ? `${catObj.icon} ${catObj.label}` : 'كل الإعلانات';

  grid.innerHTML = loadingHTML();
  const listings = await fetchListings({ category: selected || undefined, limit: 60 });
  grid.innerHTML = listings.length ? listings.map(listingCardHTML).join('') : emptyStateHTML('لا إعلانات في هذا التصنيف بعد');
}

/* -----------------------------------------------------------
   صفحة البحث (search.html)
----------------------------------------------------------- */
export async function initSearchPage() {
  const input = qs('#search-input');
  const grid = qs('#search-grid');
  const wilayaSel = qs('#filter-wilaya');
  const catSel = qs('#filter-cat');

  if (wilayaSel) wilayaSel.innerHTML = `<option value="">كل الولايات</option>` + WILAYAS.map(w => `<option>${w}</option>`).join('');
  if (catSel) catSel.innerHTML = `<option value="">كل التصنيفات</option>` + CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');

  const q = getParam('q');
  if (q && input) input.value = q;

  async function runSearch() {
    grid.innerHTML = loadingHTML();
    const listings = await fetchListings({
      search: input?.value || undefined,
      wilaya: wilayaSel?.value || undefined,
      category: catSel?.value || undefined,
      limit: 80,
    });
    grid.innerHTML = listings.length ? listings.map(listingCardHTML).join('') : emptyStateHTML('لا نتائج مطابقة لبحثك');
  }

  input?.addEventListener('input', debounce(runSearch, 450));
  wilayaSel?.addEventListener('change', runSearch);
  catSel?.addEventListener('change', runSearch);
  runSearch();
}

/* -----------------------------------------------------------
   صفحة المنتج (product.html)
----------------------------------------------------------- */
export async function initProductPage(session) {
  const box = qs('#product-box');
  const id = getParam('id');
  const author = getParam('author');
  if (!id || !author) { box.innerHTML = emptyStateHTML('إعلان غير موجود'); return; }

  box.innerHTML = loadingHTML();
  const listing = await fetchListingById(id, author);
  if (!listing) { box.innerHTML = emptyStateHTML('هذا الإعلان لم يعد متوفرًا'); return; }

  const seller = await fetchProfile(author);
  const cat = CATEGORIES.find(c => c.id === listing.category);
  const isMine = session && session.pubHex === author;
  const mainImg = listing.images?.[0];

  box.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:16px;">
      <div class="thumb" style="aspect-ratio:4/3;border-radius:0;${mainImg ? `background-image:url('${esc(mainImg)}')` : ''}">
        ${mainImg ? '' : `<span style="font-size:3rem">${cat?.icon || '📦'}</span>`}
      </div>
    </div>
    ${listing.images?.length > 1 ? `<div class="chip-row">${listing.images.map(i => `<img src="${esc(i)}" style="width:70px;height:70px;object-fit:cover;border-radius:12px 4px 12px 4px;flex-shrink:0" />`).join('')}</div>` : ''}

    <div class="card" style="margin-bottom:14px;">
      <span class="badge badge-clay">${cat?.icon || ''} ${cat?.label || 'أخرى'}</span>
      <h1 style="font-size:1.3rem;margin:10px 0 4px;">${esc(listing.title)}</h1>
      <div class="num" style="font-size:1.5rem;font-weight:900;color:var(--souk-green-dark)">${formatDZD(listing.price)}</div>
      <div class="meta" style="display:flex;gap:14px;color:var(--ink-soft);font-size:.82rem;margin-top:8px;">
        <span>📍 ${esc(listing.wilaya || 'غير محدد')}</span>
        <span>🕐 ${timeAgo(listing.created_at)}</span>
        <span>${listing.condition === 'new' ? '✨ جديد' : '♻️ مستعمل'}</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:800;margin-bottom:8px;">الوصف</div>
      <p style="white-space:pre-wrap;line-height:1.7;font-size:.9rem;color:var(--ink)">${esc(listing.description || 'لا يوجد وصف إضافي.')}</p>
    </div>

    <div class="card" style="margin-bottom:90px;">
      <div style="font-weight:800;margin-bottom:10px;">البائع</div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="avatar">${(seller?.name || 'ب').slice(0,1)}</div>
        <div style="flex:1">
          <div style="font-weight:800">${esc(seller?.name || 'بائع في سوق دي زد')}</div>
          <div style="font-size:.75rem;color:var(--ink-soft)">${esc(hexToNpub(author).slice(0,20))}...</div>
        </div>
        <a href="seller-dashboard.html?view=${author}" class="btn btn-ghost btn-sm">الملف</a>
      </div>
      ${!isMine ? `
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button class="btn btn-primary btn-block" id="btn-buy">🛒 أضف للسلة واطلب</button>
        <a href="messages.html?to=${author}&item=${encodeURIComponent(listing.title)}" class="btn btn-outline">راسل البائع</a>
      </div>` : `
      <div style="display:flex;gap:10px;margin-top:16px;">
        <a href="sell.html?edit=${listing.dTag}" class="btn btn-outline btn-block">✏️ تعديل الإعلان</a>
        <button class="btn btn-danger" id="btn-mark-sold">تم البيع</button>
      </div>`}
    </div>
  `;

  qs('#btn-buy')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('souq:add-to-cart', { detail: listing }));
  });

  qs('#btn-mark-sold')?.addEventListener('click', async () => {
    await setListingStatus(listing.dTag, listing, session.privHex, 'sold-hidden');
    toast('تم تعليم الإعلان كمُباع', 'success');
    setTimeout(() => location.href = 'seller-dashboard.html', 800);
  });
}

/* -----------------------------------------------------------
   صفحة النشر / التعديل (sell.html)
----------------------------------------------------------- */
export async function initSellPage(session) {
  const catSel = qs('#f-category');
  const wilayaSel = qs('#f-wilaya');
  const form = qs('#sell-form');
  const previewRow = qs('#image-preview');
  const editTag = getParam('edit');

  catSel.innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
  wilayaSel.innerHTML = WILAYAS.map(w => `<option>${w}</option>`).join('');

  let images = [];

  qs('#f-images')?.addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      if (images.length >= 6) return toast('الحد الأقصى 6 صور لكل إعلان', 'error');
      const dataUrl = await fileToDataURL(file);
      images.push(dataUrl);
    }
    renderPreview();
  });

  function renderPreview() {
    previewRow.innerHTML = images.map((img, i) => `
      <div style="position:relative;flex-shrink:0;">
        <img src="${img}" style="width:80px;height:80px;object-fit:cover;border-radius:12px 4px 12px 4px" />
        <button type="button" data-i="${i}" class="remove-img" style="position:absolute;top:-6px;left:-6px;width:22px;height:22px;border-radius:50%;background:var(--danger);color:#fff;border:none;">×</button>
      </div>`).join('');
    qsa('.remove-img', previewRow).forEach(btn => btn.addEventListener('click', () => {
      images.splice(Number(btn.dataset.i), 1); renderPreview();
    }));
  }

  if (editTag) {
    qs('#sell-title-h1').textContent = 'تعديل الإعلان';
    const listing = await fetchListingById(editTag, session.pubHex);
    if (listing) {
      qs('#f-title').value = listing.title;
      qs('#f-price').value = listing.price;
      qs('#f-description').value = listing.description;
      catSel.value = listing.category;
      wilayaSel.value = listing.wilaya;
      qs('#f-condition').value = listing.condition;
      images = listing.images || [];
      renderPreview();
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs('#btn-publish');
    btn.disabled = true; btn.textContent = 'جاري النشر على شبكة Nostr...';
    try {
      const data = {
        title: qs('#f-title').value.trim(),
        price: Number(qs('#f-price').value),
        category: catSel.value,
        wilaya: wilayaSel.value,
        condition: qs('#f-condition').value,
        description: qs('#f-description').value.trim(),
        images,
      };
      if (!data.title || !data.price) throw new Error('أكمل الحقول الأساسية');
      const dTag = await publishListing(data, session.privHex, editTag || null);
      toast('تم نشر إعلانك بنجاح ✅', 'success');
      setTimeout(() => location.href = `product.html?id=${encodeURIComponent(dTag)}&author=${session.pubHex}`, 900);
    } catch (err) {
      toast(err.message || 'حدث خطأ أثناء النشر', 'error');
      btn.disabled = false; btn.textContent = 'نشر الإعلان 🚀';
    }
  });
}

/* -----------------------------------------------------------
   لوحة تحكم البائع (seller-dashboard.html)
----------------------------------------------------------- */
export async function initSellerDashboard(session) {
  const viewingOther = getParam('view');
  const targetPub = viewingOther || session.pubHex;
  const isMine = targetPub === session.pubHex;

  const profile = await fetchProfile(targetPub);
  qs('#dash-name').textContent = profile?.name || 'بائع في سوق دي زد';
  qs('#dash-about').textContent = profile?.about || '';
  qs('#dash-actions').style.display = isMine ? 'flex' : 'none';
  qs('#dash-msg-btn').style.display = isMine ? 'none' : 'inline-flex';
  qs('#dash-msg-btn')?.setAttribute('href', `messages.html?to=${targetPub}`);

  const grid = qs('#dash-grid');
  grid.innerHTML = loadingHTML();
  const listings = await fetchListings({ author: targetPub, limit: 100 });

  qs('#stat-active').textContent = listings.filter(l => l.status === 'active').length;
  qs('#stat-total').textContent = listings.length;
  qs('#stat-value').textContent = formatDZD(listings.reduce((s, l) => s + (l.price || 0), 0));

  grid.innerHTML = listings.length ? listings.map(listingCardHTML).join('') : emptyStateHTML('لا إعلانات منشورة بعد');
}
