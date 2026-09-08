// ============================================================
// nostr-client.js — كل التواصل مع شبكة Nostr يمر من هنا فقط.
// لا توجد أي قاعدة بيانات: كل شيء (منتجات، صور كروابط، رسائل،
// إشعارات) هو أحداث Nostr موقعة تُقرأ وتُنشر مباشرة من/إلى الريلايز.
// نستعمل مكتبة nostr-tools عبر CDN (esm.sh) — لا تثبيت مطلوب.
// ============================================================

import {
  SimplePool, generateSecretKey, getPublicKey, finalizeEvent,
  nip19, nip04
} from 'https://esm.sh/nostr-tools@2.7.2';

import { store } from './utils.js';

/* -----------------------------------------------------------
   ثوابت التطبيق
----------------------------------------------------------- */

// وسم فريد يميّز إعلانات "سوق دي زد" عن كل منشورات Nostr العالمية.
// بفضل هذا الوسم، التطبيق يعرض فقط محتواه الخاص (سوق مغلق فعليًا)
// رغم أن الشبكة نفسها عمومية.
export const APP_TAG = 'souq-dz-v1';

export const KIND = {
  PROFILE:  0,     // بيانات الملف الشخصي (NIP-01)
  LISTING:  30402, // إعلان بيع (NIP-99: Classified Listing)
  DM:       4,     // رسالة مشفرة (NIP-04)
  DELETE:   5,     // حذف حدث (NIP-09)
  ORDER:    30403, // حالة طلب شراء (نوع مخصص لسوق دي زد)
};

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social',
];

export function getRelays() {
  return store.get('souq_relays', DEFAULT_RELAYS);
}
export function setRelays(list) {
  store.set('souq_relays', list);
}

/* -----------------------------------------------------------
   مفاتيح المستخدم
----------------------------------------------------------- */

export function createIdentity() {
  const sk = generateSecretKey();          // Uint8Array
  const pk = getPublicKey(sk);              // hex string
  return {
    privHex: bytesToHex(sk),
    pubHex: pk,
    nsec: nip19.nsecEncode(sk),
    npub: nip19.npubEncode(pk),
  };
}

export function identityFromNsec(nsecOrHex) {
  let sk;
  if (nsecOrHex.startsWith('nsec1')) {
    const dec = nip19.decode(nsecOrHex);
    sk = dec.data;
  } else {
    sk = hexToBytes(nsecOrHex.trim());
  }
  const pk = getPublicKey(sk);
  return {
    privHex: bytesToHex(sk),
    pubHex: pk,
    nsec: nip19.nsecEncode(sk),
    npub: nip19.npubEncode(pk),
  };
}

export function npubToHex(npub) {
  if (!npub.startsWith('npub1')) return npub;
  return nip19.decode(npub).data;
}
export function hexToNpub(hex) {
  return nip19.npubEncode(hex);
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}

/* -----------------------------------------------------------
   جلسة المستخدم الحالية (مخزّنة محليًا في متصفح المستخدم فقط،
   لا تُرسل لأي سيرفر لأنه لا يوجد سيرفر أصلًا)
----------------------------------------------------------- */

export function saveSession(identity, remember) {
  const target = remember ? store : store.session;
  target.set('souq_session', identity);
}
export function getSession() {
  return store.get('souq_session') || store.session.get('souq_session');
}
export function clearSession() {
  store.remove('souq_session');
  store.session.remove('souq_session');
}
export function hasNip07() {
  return typeof window.nostr !== 'undefined';
}

/* -----------------------------------------------------------
   Pool مشترك للاتصال بكل الريلايز
----------------------------------------------------------- */

let poolInstance = null;
export function getPool() {
  if (!poolInstance) poolInstance = new SimplePool();
  return poolInstance;
}

/* -----------------------------------------------------------
   توقيع ونشر حدث
----------------------------------------------------------- */

export async function publishEvent(template, privHex) {
  const pool = getPool();
  const relays = getRelays();
  let signed;
  if (!privHex && hasNip07()) {
    // استخدام إضافة المتصفح (NIP-07) إن وُجدت بدل تخزين المفتاح
    template.created_at = Math.floor(Date.now() / 1000);
    signed = await window.nostr.signEvent(template);
  } else {
    const sk = hexToBytes(privHex);
    signed = finalizeEvent(template, sk);
  }
  await Promise.any(pool.publish(relays, signed).map(p => p.catch(() => {})));
  return signed;
}

/** جلب أحداث مطابقة لفلتر (مرة واحدة، وليس اشتراك مستمر) */
export async function queryEvents(filter) {
  const pool = getPool();
  const relays = getRelays();
  try {
    const events = await pool.querySync(relays, filter, { maxWait: 4500 });
    return events;
  } catch (e) {
    console.error('queryEvents error', e);
    return [];
  }
}

/** اشتراك مستمر لتحديثات لحظية (إشعارات/رسائل جديدة) */
export function subscribe(filters, onEvent, onEose) {
  const pool = getPool();
  const relays = getRelays();
  const sub = pool.subscribeMany(relays, filters, {
    onevent: onEvent,
    oneose: () => onEose && onEose(),
  });
  return sub; // نداء sub.close() لإيقاف الاشتراك
}

/* -----------------------------------------------------------
   الملف الشخصي (kind 0)
----------------------------------------------------------- */

export async function fetchProfile(pubHex) {
  const events = await queryEvents({ kinds: [KIND.PROFILE], authors: [pubHex], limit: 1 });
  if (!events.length) return null;
  try { return { ...JSON.parse(events[0].content), pubkey: pubHex, updated_at: events[0].created_at }; }
  catch { return null; }
}

export async function publishProfile(profileObj, privHex) {
  const template = {
    kind: KIND.PROFILE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(profileObj),
  };
  return publishEvent(template, privHex);
}

/* -----------------------------------------------------------
   الإعلانات / المنتجات (kind 30402 — NIP-99) موسومة بـ APP_TAG
   لتبقى داخل نطاق التطبيق فقط
----------------------------------------------------------- */

export async function fetchListings({ category, wilaya, search, author, limit = 60 } = {}) {
  const filter = { kinds: [KIND.LISTING], '#t': [APP_TAG], limit };
  if (category) filter['#c'] = [category];
  if (author) filter.authors = [author];
  let events = await queryEvents(filter);

  // إبقاء آخر نسخة فقط من كل إعلان (بحسب المعرّف الفريد d) وإزالة المحذوف/المباع
  const byId = new Map();
  for (const ev of events) {
    const d = ev.tags.find(t => t[0] === 'd')?.[1];
    if (!d) continue;
    const existing = byId.get(d);
    if (!existing || existing.created_at < ev.created_at) byId.set(d, ev);
  }
  let listings = Array.from(byId.values())
    .map(parseListingEvent)
    .filter(l => l.status !== 'sold-hidden');

  if (wilaya) listings = listings.filter(l => l.wilaya === wilaya);
  if (search) {
    const s = search.trim().toLowerCase();
    listings = listings.filter(l => l.title.toLowerCase().includes(s) || l.description.toLowerCase().includes(s));
  }
  return listings.sort((a, b) => b.created_at - a.created_at);
}

export async function fetchListingById(dTag, authorHex) {
  const filter = { kinds: [KIND.LISTING], '#d': [dTag], '#t': [APP_TAG] };
  if (authorHex) filter.authors = [authorHex];
  const events = await queryEvents(filter);
  if (!events.length) return null;
  events.sort((a, b) => b.created_at - a.created_at);
  return parseListingEvent(events[0]);
}

function parseListingEvent(ev) {
  const tag = (name) => ev.tags.find(t => t[0] === name)?.[1] || '';
  const images = ev.tags.filter(t => t[0] === 'image').map(t => t[1]);
  let content = {};
  try { content = JSON.parse(ev.content); } catch { content = { description: ev.content }; }
  return {
    id: ev.id,
    dTag: tag('d'),
    author: ev.pubkey,
    title: tag('title') || content.title || 'بدون عنوان',
    price: Number(tag('price')) || content.price || 0,
    currency: tag('currency') || 'DZD',
    category: tag('c') || content.category || 'other',
    wilaya: tag('wilaya') || content.wilaya || '',
    condition: tag('condition') || content.condition || 'used',
    status: tag('status') || 'active',
    images: images.length ? images : (content.images || []),
    description: content.description || '',
    created_at: ev.created_at,
  };
}

export async function publishListing(data, privHex, existingDTag = null) {
  const dTag = existingDTag || `souq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tags = [
    ['d', dTag],
    ['t', APP_TAG],
    ['title', data.title],
    ['price', String(data.price)],
    ['currency', 'DZD'],
    ['c', data.category],
    ['wilaya', data.wilaya],
    ['condition', data.condition || 'used'],
    ['status', data.status || 'active'],
    ...(data.images || []).map(url => ['image', url]),
  ];
  const template = {
    kind: KIND.LISTING,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify({ description: data.description || '' }),
  };
  await publishEvent(template, privHex);
  return dTag;
}

export async function setListingStatus(dTag, data, privHex, status) {
  return publishListing({ ...data, status }, privHex, dTag);
}

/* -----------------------------------------------------------
   الرسائل المشفرة (NIP-04) — لا قاعدة بيانات، محادثة تُقرأ
   مباشرة من الريلايز وتُفك تشفيرها محليًا بمفتاح المستخدم فقط
----------------------------------------------------------- */

export async function encryptDM(privHex, theirPubHex, text) {
  if (!privHex && hasNip07() && window.nostr.nip04) {
    return window.nostr.nip04.encrypt(theirPubHex, text);
  }
  return nip04.encrypt(privHex, theirPubHex, text);
}

export async function decryptDM(privHex, theirPubHex, cipherText) {
  try {
    if (!privHex && hasNip07() && window.nostr.nip04) {
      return await window.nostr.nip04.decrypt(theirPubHex, cipherText);
    }
    return await nip04.decrypt(privHex, theirPubHex, cipherText);
  } catch {
    return '⚠️ تعذّر فك تشفير هذه الرسالة';
  }
}

export async function sendDM(myPriv, myPub, theirPub, text, extraTags = []) {
  const cipher = await encryptDM(myPriv, theirPub, text);
  const template = {
    kind: KIND.DM,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', theirPub], ['t', APP_TAG], ...extraTags],
    content: cipher,
  };
  return publishEvent(template, myPriv);
}

export async function fetchConversation(myPriv, myPub, theirPub) {
  const [sent, received] = await Promise.all([
    queryEvents({ kinds: [KIND.DM], authors: [myPub], '#p': [theirPub] }),
    queryEvents({ kinds: [KIND.DM], authors: [theirPub], '#p': [myPub] }),
  ]);
  const all = [...sent, ...received].sort((a, b) => a.created_at - b.created_at);
  const decrypted = [];
  for (const ev of all) {
    const otherParty = ev.pubkey === myPub ? theirPub : ev.pubkey;
    const text = await decryptDM(myPriv, otherParty, ev.content);
    decrypted.push({ id: ev.id, mine: ev.pubkey === myPub, text, created_at: ev.created_at });
  }
  return decrypted;
}

/** جلب كل جهات الاتصال التي بيني وبينها رسائل (لبناء قائمة المحادثات) */
export async function fetchAllThreads(myPriv, myPub) {
  const [sent, received] = await Promise.all([
    queryEvents({ kinds: [KIND.DM], authors: [myPub] }),
    queryEvents({ kinds: [KIND.DM], '#p': [myPub] }),
  ]);
  const map = new Map();
  const consider = (ev, otherPub) => {
    const cur = map.get(otherPub);
    if (!cur || cur.created_at < ev.created_at) map.set(otherPub, ev);
  };
  sent.forEach(ev => { const p = ev.tags.find(t => t[0] === 'p')?.[1]; if (p) consider(ev, p); });
  received.forEach(ev => consider(ev, ev.pubkey));
  const threads = [];
  for (const [pub, ev] of map.entries()) {
    const otherParty = ev.pubkey === myPub ? pub : ev.pubkey;
    const text = await decryptDM(myPriv, otherParty, ev.content);
    threads.push({ pub, lastText: text, created_at: ev.created_at });
  }
  return threads.sort((a, b) => b.created_at - a.created_at);
}
