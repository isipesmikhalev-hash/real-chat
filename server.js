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

// ==================== КОНФИГУРАЦИЯ АДМИНА ====================
const ADMIN_PASSWORD = 'dartik24891074*';
const ADMIN_SECRET_PATH = '/admin-panel-2024';

// ==================== РАБОТА С ФАЙЛАМИ ====================
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function initFile(file, defaultData) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
}

initFile(USERS_FILE, []);
initFile(PROFILES_FILE, []);
initFile(MESSAGES_FILE, []);
initFile(REQUESTS_FILE, []);

function readJSON(file) {
    return JSON.parse(fs.readFileSync(file));
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getDialogId(user1, user2) {
    return [user1, user2].sort().join('_');
}

// ==================== API АДМИНИСТРАТОРА ====================
app.post(ADMIN_SECRET_PATH + '/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Неверный пароль' });
    }
});

app.get(ADMIN_SECRET_PATH + '/users', (req, res) => {
    try {
        const profiles = readJSON(PROFILES_FILE);
        const result = profiles.map(profile => ({
            login: profile.login,
            name: profile.name,
            friendsCount: profile.friends.length
        }));
        res.json({ success: true, users: result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post(ADMIN_SECRET_PATH + '/delete-user', (req, res) => {
    const { login } = req.body;
    
    let users = readJSON(USERS_FILE);
    users = users.filter(u => u.login !== login);
    writeJSON(USERS_FILE, users);
    
    let profiles = readJSON(PROFILES_FILE);
    profiles = profiles.filter(p => p.login !== login);
    writeJSON(PROFILES_FILE, profiles);
    
    let requests = readJSON(REQUESTS_FILE);
    requests = requests.filter(r => r.from !== login && r.to !== login);
    writeJSON(REQUESTS_FILE, requests);
    
    let messages = readJSON(MESSAGES_FILE);
    messages = messages.map(dialog => {
        dialog.messages = dialog.messages.filter(msg => msg.from !== login);
        return dialog;
    }).filter(dialog => dialog.messages.length > 0);
    writeJSON(MESSAGES_FILE, messages);
    
    res.json({ success: true });
});

app.post(ADMIN_SECRET_PATH + '/delete-user-messages', (req, res) => {
    const { login } = req.body;
    
    let messages = readJSON(MESSAGES_FILE);
    messages = messages.map(dialog => {
        dialog.messages = dialog.messages.filter(msg => msg.from !== login);
        return dialog;
    }).filter(dialog => dialog.messages.length > 0);
    writeJSON(MESSAGES_FILE, messages);
    
    res.json({ success: true });
});

// ==================== API РЕГИСТРАЦИИ И ЛОГИНА ====================
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
    profiles.push({ login, name, friends: [], avatar: '👤' });
    writeJSON(PROFILES_FILE, profiles);
    
    res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.login === login);
    
    if (!user) {
        return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
        return res.json({ success: false, error: 'Неверный пароль' });
    }
    
    res.json({ success: true, login });
});

// ==================== API ДРУЗЕЙ ====================
app.post('/api/search-user', (req, res) => {
    const { login, currentUser } = req.body;
    const profiles = readJSON(PROFILES_FILE);
    const user = profiles.find(p => p.login === login);
    
    if (!user) {
        return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    if (user.login === currentUser) {
        return res.json({ success: false, error: 'Это вы' });
    }
    
    const currentProfile = profiles.find(p => p.login === currentUser);
    if (currentProfile.friends.includes(login)) {
        return res.json({ success: false, error: 'Уже в друзьях' });
    }
    
    res.json({ success: true, name: user.name, login: user.login });
});

app.post('/api/send-request', (req, res) => {
    const { from, to } = req.body;
    const requests = readJSON(REQUESTS_FILE);
    
    const existing = requests.find(r => (r.from === from && r.to === to) || (r.from === to && r.to === from));
    if (existing) {
        return res.json({ success: false, error: 'Заявка уже отправлена' });
    }
    
    requests.push({ from, to, status: 'pending' });
    writeJSON(REQUESTS_FILE, requests);
    
    const userSockets = global.userSockets || {};
    if (userSockets[to]) {
        io.to(userSockets[to]).emit('friend request', { from });
    }
    
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
    const requests = readJSON(REQUESTS_FILE);
    const profiles = readJSON(PROFILES_FILE);
    
    const requestIndex = requests.findIndex(r => r.from === friendLogin && r.to === login);
    if (requestIndex !== -1) requests[requestIndex].status = 'accepted';
    writeJSON(REQUESTS_FILE, requests);
    
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
        return { login: friendLogin, name: friend ? friend.name : friendLogin, avatar: friend ? friend.avatar : '👤' };
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
            io.to(recipientSocketId).emit('private message', { from, text, time, dialogId });
        }
        
        socket.emit('message sent', { to, text, time });
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
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Админ-панель</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: 'Segoe UI', sans-serif;
                    background: #0a0a0a;
                    color: white;
                    padding: 20px;
                }
                .container { max-width: 1200px; margin: 0 auto; }
                .login-card, .panel-card {
                    background: #1a1a1a;
                    border-radius: 20px;
                    padding: 30px;
                    margin-top: 50px;
                }
                h1 { margin-bottom: 20px; color: #a855f7; }
                input, button {
                    padding: 12px 20px;
                    border-radius: 10px;
                    border: none;
                    font-size: 16px;
                }
                input { background: #333; color: white; width: 250px; margin-right: 10px; }
                button { background: #a855f7; color: white; cursor: pointer; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
                .delete-btn { background: #e53e3e; padding: 6px 12px; font-size: 14px; margin: 0 5px; }
                .clear-btn { background: #f59e0b; }
                .error { color: #e53e3e; margin-top: 10px; }
                .success { color: #4ade80; margin-top: 10px; }
            </style>
        </head>
        <body>
            <div class="container" id="app">
                <div id="loginPanel" class="login-card">
                    <h1>🔐 Админ-панель</h1>
                    <p>Введите мастер-пароль для входа</p>
                    <input type="password" id="adminPassword" placeholder="Пароль">
                    <button onclick="login()">Войти</button>
                    <div id="loginError" class="error"></div>
                </div>
            </div>
            <script>
                async function login() {
                    const password = document.getElementById('adminPassword').value;
                    const res = await fetch('/admin-panel-2024/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password })
                    });
                    const data = await res.json();
                    if (data.success) {
                        loadAdminPanel();
                    } else {
                        document.getElementById('loginError').textContent = data.error;
                    }
                }

                async function loadAdminPanel() {
                    const res = await fetch('/admin-panel-2024/users');
                    const data = await res.json();
                    
                    let html = \`
                        <div class="panel-card">
                            <h1>👑 Админ-панель</h1>
                            <p>Всего пользователей: \${data.users.length}</p>
                             <table>
                                <thead>
                                    <tr><th>Логин</th><th>Имя</th><th>Друзей</th><th>Действия</th></tr>
                                </thead>
                                <tbody>
                    \`;
                    
                    data.users.forEach(user => {
                        html += \`
                            <tr>
                                <td>\${user.login}</td>
                                <td>\${user.name}</td>
                                <td>\${user.friendsCount}</td>
                                <td>
                                    <button class="delete-btn" onclick="deleteUser('\${user.login}')">🗑️ Удалить пользователя</button>
                                    <button class="delete-btn clear-btn" onclick="deleteUserMessages('\${user.login}')">📝 Удалить сообщения</button>
                                </td>
                            </tr>
                        \`;
                    });
                    
                    html += \`</tbody></table></div>\`;
                    document.getElementById('app').innerHTML = html;
                }

                async function deleteUser(login) {
                    if (confirm(\`Удалить пользователя "\${login}"? Все его сообщения и друзья будут удалены.\`)) {
                        const res = await fetch('/admin-panel-2024/delete-user', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ login })
                        });
                        const data = await res.json();
                        if (data.success) {
                            loadAdminPanel();
                        }
                    }
                }

                async function deleteUserMessages(login) {
                    if (confirm(\`Удалить все сообщения пользователя "\${login}"?\`)) {
                        const res = await fetch('/admin-panel-2024/delete-user-messages', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ login })
                        });
                        const data = await res.json();
                        if (data.success) {
                            alert('Сообщения удалены');
                        }
                    }
                }
            </script>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Мессенджер запущен на порту ${PORT}`);
    console.log(`🔐 Админ-панель доступна по пути ${ADMIN_SECRET_PATH}`);
    console.log(`🔑 Мастер-пароль: ${ADMIN_PASSWORD}`);
});