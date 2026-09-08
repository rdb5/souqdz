// ============================================================
// cart.js — السلة (محلية في متصفحك فقط) + الطلبات (أحداث Nostr
// موقعة ومشفّرة تُرسل للبائع مباشرة، بدون أي خادم أو قاعدة بيانات)
// ============================================================

import { store, formatDZD, esc, timeAgo, qs, toast } from './utils.js';
import { publishEvent, queryEvents, KIND, APP_TAG, encryptDM, decryptDM, fetchProfile, hexToNpub } from './nostr-client.js';

function cartKey(pub) { return `souq_cart_${pub}`; }

export function getCart(myPub) { return store.get(cartKey(myPub), []); }
function saveCart(myPub, items) { store.set(cartKey(myPub), items); }

export function addToCart(myPub, listing) {
  const cart = getCart(myPub);
  const found = cart.find(i => i.dTag === listing.dTag);
  if (found) { found.qty += 1; }
  else cart.push({ dTag: listing.dTag, author: listing.author, title: listing.title, price: listing.price, image: listing.images?.[0] || '', qty: 1 });
  saveCart(myPub, cart);
  toast('تمت الإضافة إلى السلة 🛒', 'success');
}

export function removeFromCart(myPub, dTag) {
  saveCart(myPub, getCart(myPub).filter(i => i.dTag !== dTag));
}
export function setQty(myPub, dTag, qty) {
  const cart = getCart(myPub);
  const item = cart.find(i => i.dTag === dTag);
  if (item) item.qty = Math.max(1, qty);
  saveCart(myPub, cart);
}
export function cartTotal(cart) { return cart.reduce((s, i) => s + i.price * i.qty, 0); }

/* -----------------------------------------------------------
   إتمام الطلب: يُنشئ حدث Nostr لكل بائع على حدة، مشفّر بالكامل
   بحيث لا يقدر أحد غير البائع والمشتري على قراءة تفاصيل الطلب
----------------------------------------------------------- */
export async function initCartPage(session) {
  const list = qs('#cart-list');
  const summary = qs('#cart-summary');
  render();

  function render() {
    const cart = getCart(session.pubHex);
    if (!cart.length) {
      list.innerHTML = `<div class="empty-state"><div class="ic">🛒</div><h3>سلتك فارغة</h3><p>تصفح الإعلانات وأضف ما يعجبك</p><a href="index.html" class="btn btn-primary" style="margin-top:10px">تصفح المنتجات</a></div>`;
      summary.style.display = 'none';
      return;
    }
    list.innerHTML = cart.map(i => `
      <div class="cart-row">
        <div class="thumb-sm" style="${i.image ? `background-image:url('${esc(i.image)}');background-size:cover` : ''}"></div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:.88rem">${esc(i.title)}</div>
          <div class="num" style="color:var(--clay-dark);font-weight:800">${formatDZD(i.price)}</div>
        </div>
        <div class="qty-box">
          <button data-act="dec" data-tag="${i.dTag}">−</button>
          <span class="num">${i.qty}</span>
          <button data-act="inc" data-tag="${i.dTag}">+</button>
        </div>
        <button data-act="del" data-tag="${i.dTag}" style="background:none;border:none;color:var(--danger);font-size:1.1rem">🗑️</button>
      </div>`).join('');

    summary.style.display = 'block';
    const total = cartTotal(cart);
    summary.querySelector('#cart-total').textContent = formatDZD(total);

    list.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const cart2 = getCart(session.pubHex);
      const item = cart2.find(i => i.dTag === tag);
      if (btn.dataset.act === 'inc') setQty(session.pubHex, tag, item.qty + 1);
      if (btn.dataset.act === 'dec') setQty(session.pubHex, tag, item.qty - 1);
      if (btn.dataset.act === 'del') removeFromCart(session.pubHex, tag);
      render();
    }));
  }

  qs('#btn-checkout')?.addEventListener('click', async () => {
    const cart = getCart(session.pubHex);
    if (!cart.length) return;
    const phone = qs('#checkout-phone')?.value.trim();
    const wilaya = qs('#checkout-wilaya')?.value.trim();
    const address = qs('#checkout-address')?.value.trim();
    if (!phone || !wilaya || !address) return toast('أكمل معلومات التوصيل أولاً', 'error');

    const btn = qs('#btn-checkout');
    btn.disabled = true; btn.textContent = 'جاري إرسال الطلب...';

    try {
      const bySeller = {};
      cart.forEach(i => { (bySeller[i.author] ??= []).push(i); });

      for (const [sellerPub, items] of Object.entries(bySeller)) {
        await createOrder(session, sellerPub, items, { phone, wilaya, address });
      }
      saveCart(session.pubHex, []);
      toast('تم إرسال طلبك للبائع(ين) بنجاح ✅', 'success');
      setTimeout(() => location.href = 'orders.html', 900);
    } catch (e) {
      toast('حدث خطأ أثناء إرسال الطلب', 'error');
      btn.disabled = false; btn.textContent = 'تأكيد الطلب';
    }
  });
}

async function createOrder(session, sellerPub, items, delivery) {
  const orderId = `order-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const payload = JSON.stringify({ items: items.map(i => ({ title: i.title, price: i.price, qty: i.qty })), total: cartTotal(items), ...delivery });
  const cipher = await encryptDM(session.privHex, sellerPub, payload);
  const template = {
    kind: KIND.ORDER,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', orderId], ['p', sellerPub], ['t', APP_TAG], ['status', 'pending']],
    content: cipher,
  };
  await publishEvent(template, session.privHex);
  return orderId;
}

/* -----------------------------------------------------------
   صفحة الطلبات (orders.html) — كمشتري وكبائع في آن واحد
----------------------------------------------------------- */
export async function initOrdersPage(session) {
  const buyBox = qs('#orders-buying');
  const sellBox = qs('#orders-selling');
  buyBox.innerHTML = sellBox.innerHTML = `<div class="loading-row"><span class="spinner"></span> جاري التحميل...</div>`;

  const [myOrders, incoming, allUpdates] = await Promise.all([
    queryEvents({ kinds: [KIND.ORDER], authors: [session.pubHex], '#t': [APP_TAG] }),
    queryEvents({ kinds: [KIND.ORDER], '#p': [session.pubHex], '#t': [APP_TAG] }),
    queryEvents({ kinds: [KIND.ORDER], '#t': [APP_TAG] }), // نستخدمها لاستخراج التحديثات عبر orderRef
  ]);

  const incomingAsSeller = incoming.filter(e => e.pubkey !== session.pubHex);
  const statusUpdates = allUpdates.filter(e => e.tags.some(t => t[0] === 'orderRef'));

  function latestStatusFor(orderId, fallback) {
    const updates = statusUpdates.filter(e => e.tags.find(t => t[0] === 'orderRef')?.[1] === orderId);
    if (!updates.length) return fallback;
    updates.sort((a, b) => b.created_at - a.created_at);
    return updates[0]; // event, يحتاج فك تشفير لاحقًا
  }

  // كمشتري
  if (!myOrders.length) {
    buyBox.innerHTML = `<div class="empty-state"><div class="ic">📦</div><h3>لا طلبات بعد</h3></div>`;
  } else {
    const rows = await Promise.all(myOrders.map(async ev => {
      const orderId = ev.tags.find(t => t[0] === 'd')?.[1];
      const sellerPub = ev.tags.find(t => t[0] === 'p')?.[1];
      const text = await decryptDM(session.privHex, sellerPub, ev.content);
      let data = {}; try { data = JSON.parse(text); } catch {}
      const statusEv = latestStatusFor(orderId, null);
      let statusLabel = ev.tags.find(t=>t[0]==='status')?.[1] || 'pending';
      if (statusEv) {
        const stxt = await decryptDM(session.privHex, sellerPub, statusEv.content);
        try { statusLabel = JSON.parse(stxt).status; } catch {}
      }
      return orderRowHTML(data, sellerPub, statusLabel, ev.created_at, false);
    }));
    buyBox.innerHTML = rows.join('');
  }

  // كبائع
  if (!incomingAsSeller.length) {
    sellBox.innerHTML = `<div class="empty-state"><div class="ic">🏪</div><h3>لا طلبات واردة بعد</h3></div>`;
  } else {
    const rows = await Promise.all(incomingAsSeller.map(async ev => {
      const orderId = ev.tags.find(t => t[0] === 'd')?.[1];
      const buyerPub = ev.pubkey;
      const text = await decryptDM(session.privHex, buyerPub, ev.content);
      let data = {}; try { data = JSON.parse(text); } catch {}
      const statusEv = latestStatusFor(orderId, null);
      let statusLabel = ev.tags.find(t=>t[0]==='status')?.[1] || 'pending';
      if (statusEv) {
        const stxt = await decryptDM(session.privHex, buyerPub, statusEv.content);
        try { statusLabel = JSON.parse(stxt).status; } catch {}
      }
      return orderRowHTML(data, buyerPub, statusLabel, ev.created_at, true, orderId, buyerPub);
    }));
    sellBox.innerHTML = rows.join('');
    attachSellerActions(session);
  }
}

const STATUS_LABELS = { pending: 'قيد الانتظار', confirmed: 'مؤكد', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغى' };
const STATUS_COLORS = { pending: 'badge-gold', confirmed: 'badge-green', shipped: 'badge-clay', delivered: 'badge-green', cancelled: 'badge-clay' };

function orderRowHTML(data, otherPub, status, createdAt, isSeller, orderId, buyerPub) {
  const itemsTxt = (data.items || []).map(i => `${esc(i.title)} × ${i.qty}`).join('، ');
  return `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div>
          <div style="font-weight:800;font-size:.9rem;">${itemsTxt || 'طلب'}</div>
          <div style="font-size:.78rem;color:var(--ink-soft);margin-top:4px;">${timeAgo(createdAt)} · ${esc(hexToNpub(otherPub).slice(0,16))}…</div>
          ${data.address ? `<div style="font-size:.78rem;color:var(--ink-soft);margin-top:2px;">📍 ${esc(data.wilaya || '')} — ${esc(data.address)} — ☎ ${esc(data.phone||'')}</div>` : ''}
        </div>
        <span class="badge ${STATUS_COLORS[status] || 'badge-gold'}">${STATUS_LABELS[status] || status}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <div class="num" style="font-weight:900;color:var(--souk-green-dark)">${formatDZD(data.total || 0)}</div>
        ${isSeller ? `
        <select class="seller-status-select" data-order="${orderId}" data-buyer="${buyerPub}" style="padding:6px 10px;border-radius:8px;border:1px solid var(--sand-deep);font-size:.75rem;">
          <option value="confirmed" ${status==='confirmed'?'selected':''}>تأكيد الطلب</option>
          <option value="shipped" ${status==='shipped'?'selected':''}>تم الشحن</option>
          <option value="delivered" ${status==='delivered'?'selected':''}>تم التسليم</option>
          <option value="cancelled" ${status==='cancelled'?'selected':''}>إلغاء</option>
        </select>` : ''}
      </div>
    </div>`;
}

function attachSellerActions(session) {
  document.querySelectorAll('.seller-status-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const orderId = sel.dataset.order;
      const buyerPub = sel.dataset.buyer;
      const status = sel.value;
      const cipher = await encryptDM(session.privHex, buyerPub, JSON.stringify({ status }));
      await publishEvent({
        kind: KIND.ORDER,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', `${orderId}-upd-${Date.now()}`], ['orderRef', orderId], ['p', buyerPub], ['t', APP_TAG], ['status', status]],
        content: cipher,
      }, session.privHex);
      toast('تم تحديث حالة الطلب، وسيتم إعلام المشتري', 'success');
    });
  });
}
