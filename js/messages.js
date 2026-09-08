// ============================================================
// messages.js — محادثات مشفرة طرفيًا (NIP-04) بدون أي قاعدة بيانات:
// الرسائل تُقرأ مباشرة من الريلايز وتُفك تشفيرها في متصفحك فقط
// باستخدام مفتاحك الخاص، الذي لا يغادر جهازك أبدًا.
// ============================================================

import { fetchAllThreads, fetchConversation, sendDM, fetchProfile, hexToNpub, subscribe, KIND } from './nostr-client.js';
import { esc, timeAgo, qs, qsa, toast, initialsOf, colorFromString, getParam } from './utils.js';

export async function initMessagesListPage(session) {
  const list = qs('#threads-list');
  list.innerHTML = `<div class="loading-row"><span class="spinner"></span> جاري تحميل المحادثات المشفرة...</div>`;
  const threads = await fetchAllThreads(session.privHex, session.pubHex);

  if (!threads.length) {
    list.innerHTML = `<div class="empty-state"><div class="ic">🔒</div><h3>لا محادثات بعد</h3><p>راسل بائعًا من صفحة أي منتج لتبدأ محادثة مشفرة بالكامل.</p></div>`;
    return;
  }

  const rows = await Promise.all(threads.map(async t => {
    const profile = await fetchProfile(t.pub);
    const name = profile?.name || hexToNpub(t.pub).slice(0, 16) + '…';
    return `
      <a class="chat-list-item" href="chat.html?to=${t.pub}">
        <div class="avatar" style="background:${colorFromString(t.pub)}">${initialsOf(name)}</div>
        <div class="info">
          <div class="name">${esc(name)}</div>
          <div class="last">${esc(t.lastText)}</div>
        </div>
        <div style="font-size:.68rem;color:var(--ink-soft)">${timeAgo(t.created_at)}</div>
      </a>`;
  }));
  list.innerHTML = rows.join('');
}

export async function initChatWindowPage(session) {
  const theirPub = getParam('to');
  if (!theirPub) { location.href = 'messages.html'; return; }

  const profile = await fetchProfile(theirPub);
  qs('#chat-title').textContent = profile?.name || 'مستخدم Nostr';
  qs('#chat-sub').textContent = hexToNpub(theirPub).slice(0, 24) + '…';

  const box = qs('#chat-messages');
  box.innerHTML = `<div class="loading-row"><span class="spinner"></span> فك تشفير الرسائل...</div>`;

  async function renderAll() {
    const msgs = await fetchConversation(session.privHex, session.pubHex, theirPub);
    if (!msgs.length) {
      box.innerHTML = `<div class="empty-state"><div class="ic">💬</div><h3>ابدأ المحادثة</h3><p>رسالتك الأولى مشفرة بالكامل ولن يقرأها أحد سوى الطرفين.</p></div>`;
      return;
    }
    box.innerHTML = msgs.map(m => `
      <div class="msg-bubble ${m.mine ? 'mine' : 'theirs'}">
        ${esc(m.text)}
        <span class="time">${timeAgo(m.created_at)}</span>
      </div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  await renderAll();

  // اشتراك لحظي لأي رسالة جديدة قادمة من هذا الطرف
  const sub = subscribe(
    [{ kinds: [KIND.DM], authors: [theirPub], '#p': [session.pubHex] }],
    () => renderAll()
  );
  window.addEventListener('beforeunload', () => sub.close());

  qs('#chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = qs('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await sendDM(session.privHex, session.pubHex, theirPub, text);
      await renderAll();
    } catch {
      toast('تعذّر إرسال الرسالة، حاول مجددًا', 'error');
    }
  });

  // إن جاء المستخدم من صفحة منتج، أرسل أول رسالة تلقائيًا تتضمن اسم المنتج
  const item = getParam('item');
  if (item && !qs('#chat-messages .msg-bubble')) {
    qs('#chat-input').value = `مرحبًا، أنا مهتم بمنتج "${item}"، هل مازال متوفرًا؟`;
  }
}
