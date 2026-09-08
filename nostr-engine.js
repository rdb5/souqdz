// nostr-engine.js
// الاتصال بريلاي نوستر (سيرفرات لامركزية)
const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
let wsConnections = [];

function connectToNostr() {
    relays.forEach(url => {
        let ws = new WebSocket(url);
        ws.onopen = () => {
            console.log("Connected to " + url);
            if(window.location.pathname.includes('index.html') || window.location.pathname === '/') {
                fetchListings(ws);
            }
        };
        wsConnections.push(ws);
    });
}

// جلب الإعلانات فقط (NIP-99 - Kind 30402)
function fetchListings(ws) {
    const subId = "market-" + Math.random().toString(36).substring(7);
    const req = ["REQ", subId, { kinds: [30402], limit: 50 }];
    ws.send(JSON.stringify(req));

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data[0] === "EVENT") {
            displayListing(data[2]);
        }
    };
}

function displayListing(event) {
    const container = document.getElementById('marketplace-grid');
    if(!container) return;

    // استخراج البيانات من الحدث
    let title = "إعلان بدون عنوان", price = "غير محدد", image = "https://via.placeholder.com/250";
    event.tags.forEach(tag => {
        if(tag[0] === 'title') title = tag[1];
        if(tag[0] === 'price') price = tag[1] + ' ' + (tag[2] || 'DZD');
        if(tag[0] === 'image' && image.includes('placeholder')) image = tag[1];
    });

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
        <img src="${image}" alt="${title}" onerror="this.src='https://via.placeholder.com/250'">
        <h3>${title}</h3>
        <p class="price">${price}</p>
        <button onclick="contactSeller('${event.pubkey}')">تواصل مع البائع مشفراً</button>
    `;
    container.appendChild(card);
}

// التحقق من تسجيل الدخول
function checkLogin() {
    const userKey = localStorage.getItem('nostr_privkey');
    if(!userKey) {
        if(!window.location.pathname.includes('login.html')) {
            window.location.href = 'login.html';
        }
    }
}

function contactSeller(pubkey) {
    localStorage.setItem('chat_target', pubkey);
    window.location.href = 'chat.html';
}

window.onload = () => {
    if(!window.location.pathname.includes('login.html')) checkLogin();
    connectToNostr();
};
