// ==================== ПЕРЕМЕННЫЕ ====================
let socket = null;
let currentUser = '';
let isConnected = false;

// DOM элементы
const loginScreen = document.getElementById('loginScreen');
const chatScreen = document.getElementById('chatScreen');
const usernameInput = document.getElementById('usernameInput');
const joinBtn = document.getElementById('joinBtn');
const messagesArea = document.getElementById('messagesArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const usersList = document.getElementById('usersList');
const usersCount = document.getElementById('usersCount');
const typingIndicator = document.getElementById('typingIndicator');
const themeToggle = document.getElementById('themeToggle');

// Таймер для индикатора печати
let typingTimeout = null;

// Функция для получения цвета аватарки (оттенки серого)
function getAvatarColor(name) {
    const colors = ['#555', '#666', '#777', '#888', '#999', '#aaa'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

// Функция для получения инициалов
function getInitials(name) {
    return name.charAt(0).toUpperCase();
}

// ==================== ПОДКЛЮЧЕНИЕ К СЕРВЕРУ ====================
function connectToServer(username) {
    socket = io();
    currentUser = username;

    socket.on('connect', () => {
        console.log('Подключено к серверу');
        socket.emit('user joined', username);
        isConnected = true;
    });

    // Получение истории сообщений
    socket.on('chat history', (history) => {
        messagesArea.innerHTML = '';
        if (history.length === 0) {
            const welcomeDiv = document.createElement('div');
            welcomeDiv.className = 'welcome-message';
            welcomeDiv.textContent = '✨ Добро пожаловать в чат! Напишите первое сообщение ✨';
            messagesArea.appendChild(welcomeDiv);
        } else {
            history.forEach(msg => addMessageToChat(msg.user, msg.text, msg.time));
        }
    });

    // Новое сообщение
    socket.on('chat message', (msg) => {
        // Убираем приветственное сообщение, если оно есть
        const welcomeMsg = messagesArea.querySelector('.welcome-message');
        if (welcomeMsg) welcomeMsg.remove();
        addMessageToChat(msg.user, msg.text, msg.time);
    });

    // Обновление списка пользователей
    socket.on('users list', (users) => {
        usersList.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            const avatarColor = getAvatarColor(user);
            const initials = getInitials(user);
            li.innerHTML = `
                <div class="user-avatar" style="background: ${avatarColor};">${initials}</div>
                <span>${escapeHtml(user)}</span>
            `;
            usersList.appendChild(li);
        });
        usersCount.textContent = users.length;
    });

    // Индикатор печати
    socket.on('user typing', (data) => {
        if (data.isTyping) {
            typingIndicator.textContent = `${data.user} печатает...`;
        } else {
            if (typingIndicator.textContent === `${data.user} печатает...`) {
                typingIndicator.textContent = '';
            }
        }
    });
}

// ==================== ДОБАВЛЕНИЕ СООБЩЕНИЯ В ЧАТ ====================
function addMessageToChat(user, text, time) {
    const messageDiv = document.createElement('div');
    const isSystem = user === 'Система';
    const isOwn = user === currentUser;

    if (isSystem) {
        messageDiv.className = 'message system';
        messageDiv.innerHTML = `
            <div class="message-text">${escapeHtml(text)}</div>
        `;
    } else {
        messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;
        messageDiv.innerHTML = `
            <div class="message-header">${escapeHtml(user)}</div>
            <div class="message-text">${escapeHtml(text)}</div>
            <div class="message-time">${time}</div>
        `;
    }
    
    messagesArea.appendChild(messageDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// Защита от XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== ОТПРАВКА СООБЩЕНИЯ ====================
function sendMessage() {
    const text = messageInput.value.trim();
    if (text && isConnected) {
        socket.emit('chat message', {
            user: currentUser,
            text: text
        });
        messageInput.value = '';
        
        // Лёгкая вибрация при отправке (если поддерживается)
        if (navigator.vibrate) navigator.vibrate(50);
    }
}

// ==================== ИНДИКАТОР ПЕЧАТИ ====================
function onTyping() {
    if (!isConnected) return;
    
    socket.emit('typing', true);
    
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', false);
    }, 1000);
}

// ==================== ВХОД В ЧАТ ====================
function joinChat() {
    const username = usernameInput.value.trim();
    if (username === '') {
        alert('Введите ваше имя');
        return;
    }
    
    if (username.length > 20) {
        alert('Имя не должно превышать 20 символов');
        return;
    }
    
    loginScreen.style.display = 'none';
    chatScreen.style.display = 'flex';
    connectToServer(username);
}

// ==================== ТЁМНАЯ/СВЕТЛАЯ ТЕМА ====================
function applyTheme(isDark) {
    if (isDark) {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
        localStorage.setItem('theme', 'dark');
        if (themeToggle) themeToggle.checked = false;
    } else {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        localStorage.setItem('theme', 'light');
        if (themeToggle) themeToggle.checked = true;
    }
}

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    applyTheme(false);
} else {
    applyTheme(true);
}

if (themeToggle) {
    themeToggle.addEventListener('change', (e) => {
        applyTheme(!e.target.checked);
    });
}

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================
joinBtn.addEventListener('click', joinChat);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});
messageInput.addEventListener('input', onTyping);

// Вход по Enter на экране логина
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinChat();
});