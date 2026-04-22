let currentUser = localStorage.getItem('currentUser');
let socket = null;
let currentFriend = null;
let allFriends = [];

// DOM элементы
const userInfoDiv = document.getElementById('userInfo');
const friendsListDiv = document.getElementById('friendsList');
const requestsListDiv = document.getElementById('requestsList');
const messagesArea = document.getElementById('messagesArea');
const chatHeader = document.getElementById('chatHeader');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const searchUserInput = document.getElementById('searchUser');
const searchBtn = document.getElementById('searchBtn');
const searchResult = document.getElementById('searchResult');

if (!currentUser) {
    window.location.href = '/';
}

// Запрос разрешения на уведомления
if (Notification.permission === 'default') {
    Notification.requestPermission();
}

// Функция показа уведомления
function showNotification(title, body) {
    if (Notification.permission === 'granted' && document.hidden) {
        new Notification(title, { body: body, icon: '/icons/icon-512.png' });
    }
}

// Подключение сокета
function connectSocket() {
    socket = io();
    
    socket.on('connect', () => {
        socket.emit('user online', currentUser);
    });
    
    socket.on('private message', (data) => {
        if (currentFriend === data.from) {
            addMessageToChat(data.from, data.text, data.time);
        } else {
            // Показать уведомление
            showNotification(data.from, data.text);
            // Обновить счётчик непрочитанных
            updateUnreadCount(data.from);
        }
        loadFriends();
    });
    
    socket.on('friend request', (data) => {
        loadRequests();
        showNotification('Новая заявка', `${data.from} хочет добавить вас в друзья`);
    });
    
    socket.on('user status', (data) => {
        updateFriendStatus(data.login, data.status);
    });
}

// Обновление статуса друга в списке
function updateFriendStatus(login, status) {
    const friendDiv = document.querySelector(`.friend-item[data-login="${login}"]`);
    if (friendDiv) {
        const statusDot = friendDiv.querySelector('.status-dot');
        if (statusDot) {
            statusDot.className = 'status-dot ' + (status === 'online' ? 'online' : 'offline');
        }
    }
}

// Обновление счётчика непрочитанных
function updateUnreadCount(from) {
    let unread = JSON.parse(localStorage.getItem('unread_' + currentUser) || '{}');
    unread[from] = (unread[from] || 0) + 1;
    localStorage.setItem('unread_' + currentUser, JSON.stringify(unread));
    updateFriendsListUI();
}

function clearUnreadCount(friendLogin) {
    let unread = JSON.parse(localStorage.getItem('unread_' + currentUser) || '{}');
    delete unread[friendLogin];
    localStorage.setItem('unread_' + currentUser, JSON.stringify(unread));
    updateFriendsListUI();
}

async function loadUserInfo() {
    userInfoDiv.innerHTML = `<span>👤 ${currentUser}</span>`;
}

async function loadFriends() {
    const res = await fetch('/api/get-friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: currentUser })
    });
    const data = await res.json();
    allFriends = data.friends;
    updateFriendsListUI();
}

function updateFriendsListUI() {
    if (allFriends.length === 0) {
        friendsListDiv.innerHTML = '<div class="empty-message">Нет друзей. Добавьте кого-нибудь!</div>';
        return;
    }
    
    const unread = JSON.parse(localStorage.getItem('unread_' + currentUser) || '{}');
    
    friendsListDiv.innerHTML = '';
    allFriends.forEach(friend => {
        const friendDiv = document.createElement('div');
        friendDiv.className = 'friend-item';
        friendDiv.setAttribute('data-login', friend.login);
        const unreadCount = unread[friend.login] || 0;
        const unreadBadge = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';
        friendDiv.innerHTML = `
            <div class="friend-avatar">${friend.avatar || '👤'}</div>
            <div class="friend-info">
                <div class="friend-name">
                    ${escapeHtml(friend.name)}
                    <span class="status-dot offline"></span>
                    ${unreadBadge}
                </div>
                <div class="friend-login">@${escapeHtml(friend.login)}</div>
                <div class="friend-last-seen" id="lastSeen_${friend.login}">—</div>
            </div>
        `;
        friendDiv.addEventListener('click', () => {
            clearUnreadCount(friend.login);
            openChat(friend.login, friend.name);
        });
        friendsListDiv.appendChild(friendDiv);
    });
}

async function loadRequests() {
    const res = await fetch('/api/get-requests', {
        method: 'POST',
        headers: { 'Content-Type':application/json' },
        body: JSON.stringify({ login: currentUser })
    });
    const data = await res.json();
    
    if (data.requests.length === 0) {
        requestsListDiv.innerHTML = '<div class="empty-message">Нет заявок</div>';
        return;
    }
    
    requestsListDiv.innerHTML = '';
    data.requests.forEach(req => {
        const reqDiv = document.createElement('div');
        reqDiv.className = 'request-item';
        reqDiv.innerHTML = `
            <span>📨 ${escapeHtml(req.name)} (@${escapeHtml(req.from)})</span>
            <button class="accept-btn" data-login="${req.from}">✅ Принять</button>
        `;
        requestsListDiv.appendChild(reqDiv);
    });
    
    document.querySelectorAll('.accept-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const friendLogin = btn.dataset.login;
            await fetch('/api/accept-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ login: currentUser, friendLogin })
            });
            loadRequests();
            loadFriends();
        });
    });
}

searchBtn.addEventListener('click', async () => {
    const searchLogin = searchUserInput.value.trim();
    if (!searchLogin) return;
    
    const res = await fetch('/api/search-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: searchLogin, currentUser })
    });
    const data = await res.json();
    
    if (!data.success) {
        searchResult.innerHTML = `<div class="error-message">${data.error}</div>`;
        return;
    }
    
    searchResult.innerHTML = `
        <div class="search-result-item">
            <span>👤 ${escapeHtml(data.name)} (@${escapeHtml(data.login)})</span>
            <button id="sendRequestBtn">➕ Добавить в друзья</button>
        </div>
    `;
    
    document.getElementById('sendRequestBtn').addEventListener('click', async () => {
        await fetch('/api/send-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: currentUser, to: data.login })
        });
        searchResult.innerHTML = '<div class="success-message">✅ Заявка отправлена!</div>';
        setTimeout(() => { searchResult.innerHTML = ''; }, 2000);
    });
});

async function openChat(friendLogin, friendName) {
    currentFriend = friendLogin;
    chatHeader.innerHTML = `<h3>💬 Чат с ${escapeHtml(friendName)}</h3>`;
    messageInput.disabled = false;
    sendBtn.disabled = false;
    
    const res = await fetch('/api/get-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user1: currentUser, user2: friendLogin })
    });
    const data = await res.json();
    
    messagesArea.innerHTML = '';
    if (data.messages.length === 0) {
        messagesArea.innerHTML = '<div class="welcome-message">✨ Напишите первое сообщение ✨</div>';
    } else {
        data.messages.forEach(msg => {
            addMessageToChat(msg.from, msg.text, msg.time);
        });
    }
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function addMessageToChat(from, text, time) {
    const isOwn = from === currentUser;
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;
    messageDiv.innerHTML = `
        <div class="message-header">${escapeHtml(from)}</div>
        <div class="message-text">${escapeHtml(text)}</div>
        <div class="message-time">${time}</div>
    `;
    messagesArea.appendChild(messageDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentFriend) return;
    
    const time = new Date().toLocaleTimeString();
    socket.emit('private message', {
        from: currentUser,
        to: currentFriend,
        text: text,
        time: time
    });
    addMessageToChat(currentUser, text, time);
    messageInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Загрузка данных и подключение
loadUserInfo();
loadFriends();
loadRequests();
connectSocket();