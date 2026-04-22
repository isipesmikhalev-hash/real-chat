const express = require('express');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==================== КОНФИГУРАЦИЯ ====================
const ADMIN_PASSWORD = 'admin123';
const ADMIN_SECRET_PATH = '/admin-panel-2024';

// ==================== РАБОТА С ФАЙЛАМИ ====================
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file) {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file));
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getDialogId(user1, user2) {
    return [user1, user2].sort().join('_');
}

// Инициализация файлов
if (!fs.existsSync(USERS_FILE)) writeJSON(USERS_FILE, []);
if (!fs.existsSync(PROFILES_FILE)) writeJSON(PROFILES_FILE, []);
if (!fs.existsSync(MESSAGES_FILE)) writeJSON(MESSAGES_FILE, []);
if (!fs.existsSync(REQUESTS_FILE)) writeJSON(REQUESTS_FILE, []);

// ==================== API РЕГИСТРАЦИИ ====================
app.post('/api/register', async (req, res) => {
    const { login, password, name } = req.body;
    if (!login || !password || !name) {
        return res.json({ success: false, error: 'Заполните все поля' });
    }
    
    const users = readJSON(USERS_FILE);
    if (users.find(u => u.login === login)) {
        return res.json({ success: false, error: 'Пользователь уже существует' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    users.push({ login, passwordHash });
    writeJSON(USERS_FILE, users);
    
    const profiles = readJSON(PROFILES_FILE);
    profiles.push({ login, name, friends: [] });
    writeJSON(PROFILES_FILE, profiles);
    
    res.json({ success: true });
});

// ==================== API ЛОГИНА ====================
app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.login === login);
    
    if (!user) return res.json({ success: false, error: 'Пользователь не найден' });
    
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.json({ success: false, error: 'Неверный пароль' });
    
    res.json({ success: true, login });
});

// ==================== API ДРУЗЕЙ ====================
app.post('/api/search-user', (req, res) => {
    const { login, currentUser } = req.body;
    const profiles = readJSON(PROFILES_FILE);
    const user = profiles.find(p => p.login === login);
    
    if (!user) return res.json({ success: false, error: 'Пользователь не найден' });
    if (user.login === currentUser) return res.json({ success: false, error: 'Это вы' });
    
    const currentProfile = profiles.find(p => p.login === currentUser);
    if (currentProfile.friends.includes(login)) {
        return res.json({ success: false, error: 'Уже в друзьях' });
    }
    
    res.json({ success: true, name: user.name, login: user.login });
});

app.post('/api/send-request', (req, res) => {
    const { from, to } = req.body;
    const requests = readJSON(REQUESTS_FILE);
    
    if (requests.find(r => (r.from === from && r.to === to))) {
        return res.json({ success: false, error: 'Заявка уже отправлена' });
    }
    
    requests.push({ from, to, status: 'pending' });
    writeJSON(REQUESTS_FILE, requests);
    res.json({ success: true });
});

app.post('/api/get-requests', (req, res) => {
    const { login } = req.body;
    const requests = readJSON(REQUESTS_FILE);
    const profiles = readJSON(PROFILES_FILE);
    
    const incoming = requests.filter(r => r.to === login && r.status === 'pending');
    const result = incoming.map(r => {
        const profile = profiles.find(p => p.login === r.from);
        return { from: r.from, name: profile ? profile.name : r.from };
    });
    
    res.json({ success: true, requests: result });
});

app.post('/api/accept-request', (req, res) => {
    const { login, friendLogin } = req.body;
    let requests = readJSON(REQUESTS_FILE);
    requests = requests.filter(r => !(r.from === friendLogin && r.to === login));
    writeJSON(REQUESTS_FILE, requests);
    
    const profiles = readJSON(PROFILES_FILE);
    const userProfile = profiles.find(p => p.login === login);
    const friendProfile = profiles.find(p => p.login === friendLogin);
    
    if (!userProfile.friends.includes(friendLogin)) userProfile.friends.push(friendLogin);
    if (!friendProfile.friends.includes(login)) friendProfile.friends.push(login);
    writeJSON(PROFILES_FILE, profiles);
    
    res.json({ success: true });
});

app.post('/api/get-friends', (req, res) => {
    const { login } = req.body;
    const profiles = readJSON(PROFILES_FILE);
    const userProfile = profiles.find(p => p.login === login);
    
    const friends = userProfile.friends.map(friendLogin => {
        const friend = profiles.find(p => p.login === friendLogin);
        return { login: friendLogin, name: friend ? friend.name : friendLogin };
    });
    
    res.json({ success: true, friends });
});

// ==================== API СООБЩЕНИЙ ====================
app.post('/api/get-messages', (req, res) => {
    const { user1, user2 } = req.body;
    const dialogId = getDialogId(user1, user2);
    const messages = readJSON(MESSAGES_FILE);
    const dialog = messages.find(m => m.dialogId === dialogId);
    res.json({ success: true, messages: dialog ? dialog.messages : [] });
});

// ==================== SOCKET.IO ====================
global.userSockets = {};

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);
    
    socket.on('user online', (login) => {
        global.userSockets[login] = socket.id;
        socket.login = login;
        console.log(`${login} онлайн`);
    });
    
    socket.on('private message', (data) => {
        const { from, to, text, time } = data;
        const dialogId = getDialogId(from, to);
        
        const messages = readJSON(MESSAGES_FILE);
        let dialog = messages.find(m => m.dialogId === dialogId);
        if (!dialog) {
            dialog = { dialogId, messages: [] };
            messages.push(dialog);
        }
        dialog.messages.push({ from, text, time });
        writeJSON(MESSAGES_FILE, messages);
        
        const recipientSocketId = global.userSockets[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private message', { from, text, time });
        }
    });
    
    socket.on('disconnect', () => {
        if (socket.login) {
            delete global.userSockets[socket.login];
            console.log(`${socket.login} отключился`);
        }
    });
});

// ==================== АДМИН-ПАНЕЛЬ (HTML) ====================
app.get(ADMIN_SECRET_PATH, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Админ-панель</title>
            <style>
                body { font-family: Arial; background: #0a0a0a; color: white; padding: 20px; }
                .card { background: #1a1a1a; border-radius: 20px; padding: 30px; max-width: 800px; margin: 50px auto; }
                input, button { padding: 10px; margin: 5px; }
                button { background: #a855f7; color: white; border: none; cursor: pointer; }
                .error { color: red; }
            </style>
        </head>
        <body>
            <div class="card" id="app">
                <h1>🔐 Админ-панель</h1>
                <input type="password" id="pwd" placeholder="Пароль">
                <button onclick="login()">Войти</button>
                <div id="result"></div>
            </div>
            <script>
                async function login() {
                    const password = document.getElementById('pwd').value;
                    const res = await fetch('/admin-panel-2024/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password })
                    });
                    const data = await res.json();
                    if (data.success) {
                        document.getElementById('result').innerHTML = '<p style="color:green">✅ Вход выполнен. <a href="/">Вернуться в чат</a></p>';
                    } else {
                        document.getElementById('result').innerHTML = '<p class="error">❌ Неверный пароль</p>';
                    }
                }
            </script>
        </body>
        </html>
    `);
});

app.post(ADMIN_SECRET_PATH + '/login', (req, res) => {
    const { password } = req.body;
    res.json({ success: password === ADMIN_PASSWORD });
});

// ==================== ЗАПУСК ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🔐 Админ-панель: /${ADMIN_SECRET_PATH}`);
});