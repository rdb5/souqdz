/* =========================================================
   سوق الجزائر — منطق التطبيق
   يعمل بالكامل على شبكة Nostr، بدون أي خادم أو قاعدة بيانات.
   كل ما يُخزَّن محليًا (localStorage) يبقى على جهاز المستخدم فقط.
   ========================================================= */

const NT = window.NostrTools;

// وسم فريد لتطبيقنا: كل الإعلانات المنشورة من هذا التطبيق تحمله،
// وهذا ما يجعل واجهة التطبيق "مغلقة" على سوقنا فقط رغم أن الشبكة عمومية.
const APP_TAG = "dzsouq-v1";
const LISTING_KIND = 30402; // NIP-99: Classified Listing
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://relay.snort.social",
];

const LS_RELAYS   = "dzsouq_relays";
const LS_SK       = "dzsouq_sk_hex";      // يُحفظ فقط إذا اختار المستخدم "تذكرني"
const LS_SESSION  = "dzsouq_session_sk";  // نسخة الجلسة (sessionStorage)
const LS_MODE     = "dzsouq_login_mode";  // "ext" | "local"
const LS_READDMS  = (pk) => `dzsouq_read_dm_${pk}`;
const LS_PROFILES = "dzsouq_profile_cache";

// ---------------------------------------------------------
// حالة التطبيق
// ---------------------------------------------------------
const state = {
  pk: null,
  mode: null,            // 'ext' | 'local'
  skBytes: null,         // Uint8Array عند تسجيل الدخول بالمفتاح المحلي
  skHex: null,
  relays: [],
  pool: null,
  listings: new Map(),      // id -> event
  myListings: new Map(),
  dms: new Map(),            // otherPubkey -> [ {event, plaintext} ... ]
  notifications: [],         // {id, text, ts, read}
  profileCache: {},
  activeConversation: null,
  subs: [],
};

// ---------------------------------------------------------
// أدوات صغيرة
// ---------------------------------------------------------
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }

function toast(msg, ms=3200){
  const host = $("#toastHost");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(()=> el.remove(), ms);
}

function hexToBytes(hex){
  if(hex instanceof Uint8Array) return hex;
  hex = hex.trim();
  const arr = new Uint8Array(hex.length/2);
  for(let i=0;i<arr.length;i++) arr[i] = parseInt(hex.substr(i*2,2),16);
  return arr;
}
function bytesToHex(bytes){
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function short(pk){ return pk ? pk.slice(0,8)+"…"+pk.slice(-6) : ""; }
function safeNpub(pk){
  try{ return NT.nip19.npubEncode(pk); }catch(e){ return pk; }
}

function loadProfileCache(){
  try{ state.profileCache = JSON.parse(localStorage.getItem(LS_PROFILES) || "{}"); }
  catch(e){ state.profileCache = {}; }
}
function saveProfileCache(){
  localStorage.setItem(LS_PROFILES, JSON.stringify(state.profileCache));
}

function getRelays(){
  const stored = localStorage.getItem(LS_RELAYS);
  if(stored){
    try{ return JSON.parse(stored); }catch(e){ /* fallthrough */ }
  }
  return [...DEFAULT_RELAYS];
}
function saveRelays(list){
  localStorage.setItem(LS_RELAYS, JSON.stringify(list));
}

// ---------------------------------------------------------
// طبقة التوقيع: تدعم إضافة المتصفح (NIP-07) أو المفتاح المحلي
// ---------------------------------------------------------
const Signer = {
  async getPublicKey(){
    if(state.mode === "ext") return await window.nostr.getPublicKey();
    return NT.getPublicKey(state.skBytes);
  },
  async signEvent(evt){
    if(state.mode === "ext") return await window.nostr.signEvent(evt);
    return NT.finalizeEvent(evt, state.skBytes);
  },
  async nip04Encrypt(pubkey, text){
    if(state.mode === "ext" && window.nostr.nip04) return await window.nostr.nip04.encrypt(pubkey, text);
    return await NT.nip04.encrypt(state.skHex, pubkey, text);
  },
  async nip04Decrypt(pubkey, cipher){
    if(state.mode === "ext" && window.nostr.nip04) return await window.nostr.nip04.decrypt(pubkey, cipher);
    return await NT.nip04.decrypt(state.skHex, pubkey, cipher);
  }
};

// ---------------------------------------------------------
// تهيئة الاتصال بالشبكة
// ---------------------------------------------------------
function initPool(){
  state.relays = getRelays();
  state.pool = new NT.SimplePool();
}

function fetchEvents(filters, timeoutMs = 6000){
  return new Promise((resolve)=>{
    const events = [];
    let done = false;
    let sub;
    const finish = ()=>{
      if(done) return;
      done = true;
      try{ sub && sub.close(); }catch(e){}
      resolve(events);
    };
    try{
      sub = state.pool.subscribeMany(state.relays, filters, {
        onevent(e){ events.push(e); },
        oneose(){ finish(); }
      });
    }catch(err){
      console.error("fetchEvents error", err);
      return resolve(events);
    }
    setTimeout(finish, timeoutMs);
  });
}

async function publishEvent(evt){
  try{
    let pubs = state.pool.publish(state.relays, evt);
    if(!Array.isArray(pubs)) pubs = [pubs];
    const results = await Promise.allSettled(pubs);
    const ok = results.some(r=>r.status === "fulfilled");
    if(!ok) console.warn("لم يقبل أي relay الحدث", results);
    return ok;
  }catch(err){
    console.error("publishEvent error", err);
    return false;
  }
}

// ---------------------------------------------------------
// تسجيل الدخول / إنشاء الحساب
// ---------------------------------------------------------
async function loginWithExtension(){
  if(!window.nostr){
    toast("لم يتم العثور على إضافة Nostr في متصفحك (مثل Alby أو nos2x).");
    return;
  }
  try{
    state.mode = "ext";
    const pk = await window.nostr.getPublicKey();
    state.pk = pk;
    localStorage.setItem(LS_MODE, "ext");
    await enterApp();
  }catch(err){
    console.error(err);
    toast("تعذر الدخول عبر الإضافة.");
  }
}

function parseAnyPrivateKey(input){
  input = input.trim();
  if(input.startsWith("nsec1")){
    const dec = NT.nip19.decode(input);
    if(dec.type !== "nsec") throw new Error("مفتاح غير صالح");
    return dec.data instanceof Uint8Array ? dec.data : hexToBytes(dec.data);
  }
  if(/^[0-9a-fA-F]{64}$/.test(input)) return hexToBytes(input);
  throw new Error("صيغة المفتاح غير مدعومة");
}

async function loginWithNsec(){
  const raw = $("#nsecInput").value;
  const remember = $("#rememberKey").checked;
  try{
    const skBytes = parseAnyPrivateKey(raw);
    setLocalKey(skBytes, remember);
    await enterApp();
  }catch(err){
    console.error(err);
    toast("المفتاح غير صحيح. تأكد من نسخه بشكل كامل.");
  }
}

function setLocalKey(skBytes, remember){
  state.mode = "local";
  state.skBytes = skBytes;
  state.skHex = bytesToHex(skBytes);
  state.pk = NT.getPublicKey(skBytes);
  localStorage.setItem(LS_MODE, "local");
  if(remember){
    localStorage.setItem(LS_SK, state.skHex);
  }else{
    sessionStorage.setItem(LS_SESSION, state.skHex);
  }
}

function createNewAccount(){
  const skBytes = NT.generateSecretKey();
  const nsec = NT.nip19.nsecEncode(skBytes);
  $("#newNsecOut").value = nsec;
  $("#newKeyModal").classList.remove("hidden");
  $("#confirmSaved").checked = false;
  $("#btnEnterApp").disabled = true;
  $("#newKeyModal").dataset.skHex = bytesToHex(skBytes);
}

function tryAutoLogin(){
  const mode = localStorage.getItem(LS_MODE);
  if(mode === "ext" && window.nostr){
    state.mode = "ext";
    window.nostr.getPublicKey().then(pk=>{
      state.pk = pk;
      enterApp();
    }).catch(()=> showLogin());
    return true;
  }
  if(mode === "local"){
    const hex = localStorage.getItem(LS_SK) || sessionStorage.getItem(LS_SESSION);
    if(hex){
      setLocalKey(hexToBytes(hex), !!localStorage.getItem(LS_SK));
      enterApp();
      return true;
    }
  }
  return false;
}

function logout(){
  localStorage.removeItem(LS_SK);
  localStorage.removeItem(LS_MODE);
  sessionStorage.removeItem(LS_SESSION);
  state.subs.forEach(s=>{ try{ s.close(); }catch(e){} });
  location.reload();
}

function showLogin(){
  $("#loginScreen").classList.remove("hidden");
  $("#app").classList.add("hidden");
}

// ---------------------------------------------------------
// دخول للتطبيق بعد نجاح المصادقة
// ---------------------------------------------------------
async function enterApp(){
  $("#loginScreen").classList.add("hidden");
  $("#newKeyModal").classList.add("hidden");
  $("#app").classList.remove("hidden");

  $("#myNpub").value = safeNpub(state.pk);
  populateStaticLists();
  renderRelayEditor();

  initPool();
  wireNav();
  subscribeListings();
  subscribeDMs();
  loadMyProfile();

  toast("مرحبًا بك في سوق الجزائر 👋");
}

// ---------------------------------------------------------
// قوائم ثابتة (فئات / ولايات)
// ---------------------------------------------------------
function populateStaticLists(){
  const catSelects = [$("#filterCategory"), $("#fCategory")];
  catSelects.forEach(sel=>{
    CATEGORIES.forEach(c=>{
      const opt = document.createElement("option");
      opt.value = c.id; opt.textContent = c.label;
      sel.appendChild(opt.cloneNode(true));
    });
  });
  const wilSelects = [$("#filterWilaya"), $("#fWilaya")];
  wilSelects.forEach(sel=>{
    WILAYAS.forEach(w=>{
      const opt = document.createElement("option");
      opt.value = w; opt.textContent = w;
      sel.appendChild(opt);
    });
  });
}

// ---------------------------------------------------------
// التنقل بين الأقسام
// ---------------------------------------------------------
function wireNav(){
  $all(".nav-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      $all(".nav-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      $all(".view").forEach(v=>v.classList.remove("active"));
      $(`#view-${btn.dataset.view}`).classList.add("active");
    });
  });
  $("#btnMyAccount").addEventListener("click", ()=>{
    $all(".nav-btn").forEach(b=>b.classList.remove("active"));
    $all(".view").forEach(v=>v.classList.remove("active"));
    $("#view-account").classList.add("active");
  });
  $("#btnNotifBell").addEventListener("click", ()=>{
    $all(".nav-btn").forEach(b=>b.classList.remove("active"));
    $all(".view").forEach(v=>v.classList.remove("active"));
    $("#view-notifs").classList.add("active");
    markNotificationsRead();
  });
}

// ---------------------------------------------------------
// الإعلانات: تصفح
// ---------------------------------------------------------
function subscribeListings(){
  $("#relayStatus").textContent = "جارِ الاتصال بشبكة Nostr...";
  let gotAny = false;
  const sub = state.pool.subscribeMany(
    state.relays,
    [{ kinds:[LISTING_KIND], "#t":[APP_TAG], limit: 300 }],
    {
      onevent(evt){
        gotAny = true;
        $("#relayStatus").textContent = "متصل بالشبكة ✓";
        upsertListing(evt);
      },
      oneose(){
        if(!gotAny) $("#relayStatus").textContent = "متصل، لا توجد إعلانات بعد.";
        renderListings();
      }
    }
  );
  state.subs.push(sub);
}

function upsertListing(evt){
  // نتجاهل الأحداث القديمة إن وُجد إصدار أحدث لنفس (author + d tag)
  const dTag = (evt.tags.find(t=>t[0]==="d")||[])[1] || evt.id;
  const key = evt.pubkey + ":" + dTag;
  const existing = state.listings.get(key);
  if(existing && existing.created_at >= evt.created_at) return;
  if(evt.tags.some(t=>t[0]==="deleted")) { state.listings.delete(key); return; }
  state.listings.set(key, evt);
  if(evt.pubkey === state.pk) state.myListings.set(key, evt);
  renderListings();
  renderMyListings();
}

function parseListing(evt){
  const tag = (name)=> (evt.tags.find(t=>t[0]===name)||[])[1];
  const images = evt.tags.filter(t=>t[0]==="image").map(t=>t[1]);
  return {
    id: evt.id,
    pubkey: evt.pubkey,
    title: tag("title") || "(بدون عنوان)",
    desc: evt.content || "",
    price: tag("price") || "0",
    currency: (evt.tags.find(t=>t[0]==="price")||[])[2] || "DZD",
    category: tag("category") || "other",
    wilaya: tag("wilaya") || "",
    images,
    created_at: evt.created_at,
  };
}

function renderListings(){
  const grid = $("#listingsGrid");
  const q = ($("#searchInput").value || "").trim().toLowerCase();
  const cat = $("#filterCategory").value;
  const wil = $("#filterWilaya").value;
  const minP = parseFloat($("#filterMinPrice").value);
  const maxP = parseFloat($("#filterMaxPrice").value);

  let items = Array.from(state.listings.values()).map(parseListing);
  items = items.filter(it=>{
    if(q && !(it.title.toLowerCase().includes(q) || it.desc.toLowerCase().includes(q))) return false;
    if(cat && it.category !== cat) return false;
    if(wil && it.wilaya !== wil) return false;
    const price = parseFloat(it.price) || 0;
    if(!isNaN(minP) && price < minP) return false;
    if(!isNaN(maxP) && price > maxP) return false;
    return true;
  });
  items.sort((a,b)=> b.created_at - a.created_at);

  grid.innerHTML = "";
  $("#emptyBrowse").classList.toggle("hidden", items.length>0);
  items.forEach(it=> grid.appendChild(listingCard(it)));
}

function listingCard(it, mine=false){
  const card = document.createElement("div");
  card.className = "card";
  const catLabel = (CATEGORIES.find(c=>c.id===it.category)||{}).label || it.category;
  card.innerHTML = `
    ${it.images[0] ? `<img src="${escapeHtml(it.images[0])}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-noimg',textContent:'🛍️'}))">`
                   : `<div class="card-noimg">🛍️</div>`}
    <div class="card-body">
      <div class="card-title">${escapeHtml(it.title)}</div>
      <div class="card-price">${escapeHtml(String(it.price))} ${escapeHtml(it.currency)}</div>
      <div class="card-meta"><span>${escapeHtml(catLabel)}</span><span>${escapeHtml(it.wilaya)}</span></div>
    </div>
    <div class="card-actions"></div>
  `;
  const actions = card.querySelector(".card-actions");
  if(mine){
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger btn-sm btn-block";
    delBtn.textContent = "حذف الإعلان";
    delBtn.onclick = ()=> deleteListing(it.id);
    actions.appendChild(delBtn);
  }else{
    const chatBtn = document.createElement("button");
    chatBtn.className = "btn btn-primary btn-sm btn-block";
    chatBtn.textContent = it.pubkey===state.pk ? "هذا إعلانك" : "تواصل مع البائع";
    chatBtn.disabled = it.pubkey===state.pk;
    chatBtn.onclick = ()=> openConversation(it.pubkey, it.title);
    actions.appendChild(chatBtn);
  }
  return card;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

function renderMyListings(){
  const grid = $("#myListingsGrid");
  const items = Array.from(state.myListings.values()).map(parseListing).sort((a,b)=>b.created_at-a.created_at);
  grid.innerHTML = "";
  $("#emptyMine").classList.toggle("hidden", items.length>0);
  items.forEach(it=> grid.appendChild(listingCard(it, true)));
}

// ---------------------------------------------------------
// نشر / حذف إعلان
// ---------------------------------------------------------
$("#btnAddImage").addEventListener("click", ()=>{
  const wrap = $("#imageInputs");
  const inp = document.createElement("input");
  inp.type = "url"; inp.className = "fImage"; inp.placeholder = "https://...";
  wrap.appendChild(inp);
});

$("#sellForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const title = $("#fTitle").value.trim();
  const desc = $("#fDesc").value.trim();
  const price = $("#fPrice").value.trim() || "0";
  const currency = $("#fCurrency").value;
  const category = $("#fCategory").value;
  const wilaya = $("#fWilaya").value;
  const images = $all(".fImage").map(i=>i.value.trim()).filter(Boolean);

  if(!title || !desc || !category || !wilaya){
    toast("رجاءً أكمل كل الحقول المطلوبة.");
    return;
  }

  const dId = "listing-" + Date.now() + "-" + Math.random().toString(36).slice(2,8);
  const tags = [
    ["d", dId],
    ["t", APP_TAG],
    ["title", title],
    ["price", price, currency],
    ["category", category],
    ["wilaya", wilaya],
  ];
  images.forEach(url=> tags.push(["image", url]));

  const template = {
    kind: LISTING_KIND,
    created_at: Math.floor(Date.now()/1000),
    tags,
    content: desc,
  };

  try{
    const signed = await Signer.signEvent(template);
    const ok = await publishEvent(signed);
    if(ok){
      toast("تم نشر الإعلان بنجاح ✅");
      upsertListing(signed);
      $("#sellForm").reset();
      $("#imageInputs").innerHTML = `<input class="fImage" type="url" placeholder="https://...">`;
      document.querySelector('.nav-btn[data-view="browse"]').click();
    }else{
      toast("تعذر نشر الإعلان على أي relay. حاول مجددًا.");
    }
  }catch(err){
    console.error(err);
    toast("حدث خطأ أثناء التوقيع أو النشر.");
  }
});

async function deleteListing(id){
  if(!confirm("هل تريد حذف هذا الإعلان؟")) return;
  const template = {
    kind: 5,
    created_at: Math.floor(Date.now()/1000),
    tags: [["e", id]],
    content: "deleted by owner",
  };
  try{
    const signed = await Signer.signEvent(template);
    await publishEvent(signed);
    for(const [key, evt] of state.listings){
      if(evt.id === id){ state.listings.delete(key); state.myListings.delete(key); }
    }
    renderListings(); renderMyListings();
    toast("تم إرسال طلب الحذف إلى الشبكة.");
  }catch(err){
    console.error(err);
    toast("تعذر حذف الإعلان.");
  }
}

$("#searchInput").addEventListener("input", debounce(renderListings, 250));
$("#btnApplyFilters").addEventListener("click", renderListings);

function debounce(fn, ms){
  let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); };
}

// ---------------------------------------------------------
// الرسائل المشفرة (NIP-04 عبر Nostr، بدون أي خادم)
// ---------------------------------------------------------
function subscribeDMs(){
  const sub = state.pool.subscribeMany(
    state.relays,
    [
      { kinds:[4], "#p":[state.pk] },
      { kinds:[4], authors:[state.pk] },
    ],
    { onevent(evt){ handleIncomingDM(evt); } }
  );
  state.subs.push(sub);
}

async function handleIncomingDM(evt){
  const isMine = evt.pubkey === state.pk;
  const otherPk = isMine ? (evt.tags.find(t=>t[0]==="p")||[])[1] : evt.pubkey;
  if(!otherPk) return;

  const listForOther = state.dms.get(otherPk) || [];
  if(listForOther.some(m=>m.event.id === evt.id)) return; // مكرر

  let plaintext = "🔒 تعذر فك التشفير";
  try{
    plaintext = await Signer.nip04Decrypt(otherPk, evt.content);
  }catch(err){ console.warn("decrypt failed", err); }

  listForOther.push({ event: evt, plaintext, mine: isMine });
  listForOther.sort((a,b)=> a.event.created_at - b.event.created_at);
  state.dms.set(otherPk, listForOther);

  renderConversationList();
  if(state.activeConversation === otherPk) renderThread(otherPk);

  if(!isMine){
    pushNotification(`رسالة جديدة من ${short(otherPk)}`, otherPk);
  }
}

function renderConversationList(){
  const host = $("#convItems");
  host.innerHTML = "";
  const keys = Array.from(state.dms.keys());
  $("#emptyConv").classList.toggle("hidden", keys.length>0);
  keys.sort((a,b)=>{
    const la = state.dms.get(a).slice(-1)[0].event.created_at;
    const lb = state.dms.get(b).slice(-1)[0].event.created_at;
    return lb-la;
  });
  keys.forEach(pk=>{
    const item = document.createElement("div");
    item.className = "conv-item" + (state.activeConversation===pk ? " active":"");
    const last = state.dms.get(pk).slice(-1)[0];
    item.innerHTML = `<strong>${short(pk)}</strong><span class="pk">${escapeHtml((last.plaintext||"").slice(0,40))}</span>`;
    item.onclick = ()=> openConversation(pk);
    host.appendChild(item);
  });
}

function openConversation(pk, contextTitle){
  state.activeConversation = pk;
  document.querySelector('.nav-btn[data-view="chat"]').click();
  renderConversationList();
  renderThread(pk, contextTitle);
}

function renderThread(pk, contextTitle){
  const thread = $("#chatThread");
  const msgs = state.dms.get(pk) || [];
  thread.innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--border);font-weight:700">
      ${short(pk)} ${contextTitle ? "— بخصوص: "+escapeHtml(contextTitle) : ""}
    </div>
    <div class="chat-messages" id="chatMessages"></div>
    <form class="chat-input-row" id="chatForm">
      <input id="chatInput" placeholder="اكتب رسالة مشفرة..." autocomplete="off" style="flex:1">
      <button class="btn btn-primary" type="submit">إرسال</button>
    </form>
  `;
  const box = $("#chatMessages");
  msgs.forEach(m=>{
    const div = document.createElement("div");
    div.className = "msg " + (m.mine ? "mine":"theirs");
    div.textContent = m.plaintext;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;

  $("#chatForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const input = $("#chatInput");
    const text = input.value.trim();
    if(!text) return;
    input.value = "";
    try{
      const cipher = await Signer.nip04Encrypt(pk, text);
      const template = {
        kind: 4,
        created_at: Math.floor(Date.now()/1000),
        tags: [["p", pk]],
        content: cipher,
      };
      const signed = await Signer.signEvent(template);
      await publishEvent(signed);
      handleIncomingDM(signed);
    }catch(err){
      console.error(err);
      toast("تعذر إرسال الرسالة.");
    }
  });
}

// ---------------------------------------------------------
// الإشعارات
// ---------------------------------------------------------
function pushNotification(text, refPk){
  const n = { id: Date.now()+Math.random(), text, ts: Date.now(), read:false, refPk };
  state.notifications.unshift(n);
  renderNotifications();
  updateBadge();
  if(Notification && Notification.permission === "granted"){
    try{ new Notification("سوق الجزائر", { body:text }); }catch(e){}
  }
}
function updateBadge(){
  const unread = state.notifications.filter(n=>!n.read).length;
  const badge = $("#notifBadge");
  badge.textContent = unread;
  badge.classList.toggle("hidden", unread===0);
}
function markNotificationsRead(){
  state.notifications.forEach(n=>n.read=true);
  updateBadge();
  renderNotifications();
}
function renderNotifications(){
  const host = $("#notifList");
  host.innerHTML = "";
  $("#emptyNotifs").classList.toggle("hidden", state.notifications.length>0);
  state.notifications.forEach(n=>{
    const el = document.createElement("div");
    el.className = "notif-item" + (n.read?"":" unread");
    el.innerHTML = `<span>${escapeHtml(n.text)}</span><small>${new Date(n.ts).toLocaleTimeString("ar-DZ")}</small>`;
    if(n.refPk) el.style.cursor="pointer", el.onclick=()=>openConversation(n.refPk);
    host.appendChild(el);
  });
}
$("#btnEnableNotifs").addEventListener("click", async ()=>{
  if(!("Notification" in window)){ toast("متصفحك لا يدعم الإشعارات."); return; }
  const perm = await Notification.requestPermission();
  toast(perm==="granted" ? "تم تفعيل الإشعارات ✅" : "تم رفض الإذن.");
});

// ---------------------------------------------------------
// الملف الشخصي (kind 0)
// ---------------------------------------------------------
async function loadMyProfile(){
  const events = await fetchEvents([{ kinds:[0], authors:[state.pk], limit:1 }], 4000);
  if(events.length){
    try{
      const meta = JSON.parse(events[0].content);
      $("#fDisplayName").value = meta.name || "";
      $("#fAbout").value = meta.about || "";
    }catch(e){}
  }
}
$("#btnSaveProfile").addEventListener("click", async ()=>{
  const meta = { name: $("#fDisplayName").value.trim(), about: $("#fAbout").value.trim() };
  const template = { kind:0, created_at: Math.floor(Date.now()/1000), tags:[], content: JSON.stringify(meta) };
  try{
    const signed = await Signer.signEvent(template);
    await publishEvent(signed);
    toast("تم حفظ الملف الشخصي.");
  }catch(err){
    console.error(err); toast("تعذر حفظ الملف الشخصي.");
  }
});

// ---------------------------------------------------------
// إعدادات الـ relays
// ---------------------------------------------------------
function renderRelayEditor(){
  const host = $("#relayListEditor");
  host.innerHTML = "";
  state.relays.forEach(url=>{
    const row = document.createElement("div");
    row.className = "relay-row";
    row.innerHTML = `<span>${escapeHtml(url)}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.onclick = ()=>{
      state.relays = state.relays.filter(r=>r!==url);
      saveRelays(state.relays);
      renderRelayEditor();
      toast("تم حذف الـ relay. أعد تحميل الصفحة لتطبيق التغيير بالكامل.");
    };
    row.appendChild(btn);
    host.appendChild(row);
  });
}
$("#btnAddRelay").addEventListener("click", ()=>{
  const val = $("#newRelayInput").value.trim();
  if(!val.startsWith("wss://") && !val.startsWith("ws://")){
    toast("يجب أن يبدأ عنوان الـ relay بـ wss://");
    return;
  }
  state.relays.push(val);
  saveRelays(state.relays);
  $("#newRelayInput").value = "";
  renderRelayEditor();
  toast("أُضيف الـ relay. أعد تحميل الصفحة لتطبيق التغيير بالكامل.");
});

// ---------------------------------------------------------
// أزرار عامة
// ---------------------------------------------------------
$("#btnLoginExt").addEventListener("click", loginWithExtension);
$("#btnShowNsec").addEventListener("click", ()=> $("#nsecBox").classList.toggle("hidden"));
$("#btnLoginNsec").addEventListener("click", loginWithNsec);
$("#btnCreateAccount").addEventListener("click", createNewAccount);
$("#copyNsec").addEventListener("click", ()=>{
  $("#newNsecOut").select();
  document.execCommand("copy");
  toast("تم نسخ المفتاح.");
});
$("#confirmSaved").addEventListener("change", (e)=>{
  $("#btnEnterApp").disabled = !e.target.checked;
});
$("#btnEnterApp").addEventListener("click", async ()=>{
  const hex = $("#newKeyModal").dataset.skHex;
  const remember = $("#rememberNewKey").checked;
  setLocalKey(hexToBytes(hex), remember);
  await enterApp();
});
$("#copyNpub").addEventListener("click", ()=>{
  $("#myNpub").select();
  document.execCommand("copy");
  toast("تم نسخ المعرّف العام.");
});
$("#btnLogout").addEventListener("click", ()=>{
  if(confirm("هل تريد تسجيل الخروج؟ تأكد أنك حفظت مفتاحك السري إن لم تفعل ذلك بعد.")) logout();
});

// ---------------------------------------------------------
// الإقلاع
// ---------------------------------------------------------
loadProfileCache();
if(!tryAutoLogin()) showLogin();
