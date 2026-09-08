// ============================================================
// notifications.js — إشعارات داخل التطبيق مبنية بالكامل على أحداث
// Nostr (رسائل جديدة، ردود على إعلاناتك، تحديثات الطلبات) بدون
// أي قاعدة بيانات: كل إشعار هو ببساطة حدث موسوم بمفتاحك العام.
// ============================================================

import { queryEvents, subscribe, KIND, fetchProfile, hexToNpub, APP_TAG } from './nostr-client.js';
import { store, timeAgo, esc, qs, toast } from './utils.js';

const SEEN_KEY = 'souq_notif_last_seen';

function getLastSeen() { return store.get(SEEN_KEY, 0); }
function setLastSeen(ts) { store.set(SEEN_KEY, ts); }

/** يجلب كل الأحداث التي تخص المستخدم: رسائل + إشارات على طلباته */
async function fetchRawNotifications(myPub) {
  const [dms, orderUpdates] = await Promise.all([
    queryEvents({ kinds: [KIND.DM], '#p': [myPub], limit: 50 }),
    queryEvents({ kinds: [KIND.ORDER], '#p': [myPub], '#t': [APP_TAG], limit: 50 }),
  ]);
  const items = [
    ...dms.map(ev => ({ type: 'message', from: ev.pubkey, created_at: ev.created_at, ev })),
    ...orderUpdates.map(ev => ({ type: 'order', from: ev.pubkey, created_at: ev.created_at, ev })),
  ];
  return items.sort((a, b) => b.created_at - a.created_at);
}

export async function getUnreadCount(myPub) {
  const items = await fetchRawNotifications(myPub);
  const lastSeen = getLastSeen();
  return items.filter(i => i.created_at > lastSeen).length;
}

/** يُستخدم في كل صفحة لعرض عداد صغير أعلى أيقونة الجرس */
export async function refreshNotifBadge(myPub) {
  const badge = qs('#notif-count');
  if (!badge) return;
  const count = await getUnreadCount(myPub);
  if (count > 0) { badge.style.display = 'flex'; badge.textContent = count > 9 ? '9+' : count; }
  else badge.style.display = 'none';
}

export async function refreshMsgBadge(myPub) {
  const badge = qs('#msg-count');
  if (!badge) return;
  // تقدير بسيط: أي حدث DM جديد بعد آخر زيارة لصفحة الرسائل
  const lastSeen = store.get('souq_msgs_last_seen', 0);
  const dms = await queryEvents({ kinds: [KIND.DM], '#p': [myPub], limit: 30 });
  const unread = dms.filter(e => e.created_at > lastSeen && e.pubkey !== myPub).length;
  if (unread > 0) { badge.style.display = 'flex'; badge.textContent = unread > 9 ? '9+' : unread; }
  else badge.style.display = 'none';
}

export async function initNotificationsPage(session) {
  const list = qs('#notif-list');
  list.innerHTML = `<div class="loading-row"><span class="spinner"></span> جاري التحقق من التحديثات...</div>`;

  const items = await fetchRawNotifications(session.pubHex);
  const lastSeen = getLastSeen();

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="ic">🔔</div><h3>لا إشعارات حتى الآن</h3><p>ستصلك هنا الرسائل الجديدة وتحديثات طلباتك.</p></div>`;
    return;
  }

  const rows = await Promise.all(items.map(async it => {
    const profile = await fetchProfile(it.from);
    const name = profile?.name || hexToNpub(it.from).slice(0, 14) + '…';
    const unread = it.created_at > lastSeen;
    const icon = it.type === 'message' ? '✉️' : '📦';
    const text = it.type === 'message'
      ? `رسالة جديدة (مشفرة) من ${esc(name)}`
      : `تحديث على أحد طلباتك من ${esc(name)}`;
    const link = it.type === 'message' ? `chat.html?to=${it.from}` : `orders.html`;
    return `
      <a class="notif-item ${unread ? 'unread' : ''}" href="${link}">
        <div class="notif-icon">${icon}</div>
        <div class="txt">${text}<div class="t">${timeAgo(it.created_at)}</div></div>
      </a>`;
  }));
  list.innerHTML = rows.join('');
  setLastSeen(Math.floor(Date.now() / 1000));
}

/** طلب صلاحية إشعارات المتصفح، واستخدامها عند وصول حدث جديد فور حدوثه */
export function enableLiveBrowserNotifications(myPub) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();

  subscribe(
    [
      { kinds: [KIND.DM], '#p': [myPub], since: Math.floor(Date.now() / 1000) },
      { kinds: [KIND.ORDER], '#p': [myPub], since: Math.floor(Date.now() / 1000) },
    ],
    (ev) => {
      const text = ev.kind === KIND.DM ? 'لديك رسالة جديدة مشفرة 🔒' : 'تحديث جديد على أحد طلباتك 📦';
      toast(text, 'info');
      if (Notification.permission === 'granted') {
        new Notification('سوق دي زد', { body: text, icon: '' });
      }
    }
  );
}
