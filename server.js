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

const ADMIN_PASSWORD = 'dartik24891074';
const ADMIN_PATH = '/admin-panel-2024';

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function read(file) {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file));
}

function write(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function dialogId(a, b) {
    return [a, b].sort().join('_');
}

// ==================== API РЕГИСТРАЦИИ ====================
app.post('/api/register', async (req, res) => {
    const { login, password, name } = req.body;
    if (!login || !password || !name) {
        return res.json({ success: false, error: 'Заполните все поля' });
    }
    const users = read(USERS_FILE);
    if (users.find(u => u.login === login)) {
        return res.json({ success: false, error: 'Пользователь уже существует' });
    }
    const hash = await bcrypt.hash(password, 10);
    users.push({ login, passwordHash: hash });
    write(USERS_FILE, users);
    
    const profiles = read(PROFILES_FILE);
    profiles.push({ login, name, friends: [] });
    write(PROFILES_FILE, profiles);
    
    res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    const users = read(USERS_FILE);
    const user = users.find(u => u.login === login);
    if (!user) return res.json({ success: false, error: 'Неверный логин' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.json({ success: false, error: 'Неверный пароль' });
    res.json({ success: true, login });
});

// ==================== API ДРУЗЕЙ ====================
app.post('/api/search-user', (req, res) => {
    const { login, currentUser } = req.body;
    const profiles = read(PROFILES_FILE);
    const user = profiles.find(p => p.login === login);
    if (!user) return res.json({ success: false, error: 'Пользователь не найден' });
    if (user.login === currentUser) return res.json({ success: false, error: 'Это вы' });
    const me = profiles.find(p => p.login === currentUser);
    if (me.friends.includes(login)) return res.json({ success: false, error: 'Уже в друзьях' });
    res.json({ success: true, name: user.name, login: user.login });
});

app.post('/api/send-request', (req, res) => {
    const { from, to } = req.body;
    const requests = read(REQUESTS_FILE);
    if (requests.find(r => r.from === from && r.to === to)) {
        return res.json({ success: false, error: 'Заявка уже отправлена' });
    }
    requests.push({ from, to, status: 'pending' });
    write(REQUESTS_FILE, requests);
    res.json({ success: true });
});

app.post('/api/get-requests', (req, res) => {
    const { login } = req.body;
    const requests = read(REQUESTS_FILE);
    const profiles = read(PROFILES_FILE);
    const incoming = requests.filter(r => r.to === login && r.status === 'pending');
    const result = incoming.map(r => {
        const p = profiles.find(pr => pr.login === r.from);
        return { from: r.from, name: p ? p.name : r.from };
    });
    res.json({ success: true, requests: result });
});

app.post('/api/accept-request', (req, res) => {
    const { login, friendLogin } = req.body;
    let requests = read(REQUESTS_FILE);
    requests = requests.filter(r => !(r.from === friendLogin && r.to === login));
    write(REQUESTS_FILE, requests);
    const profiles = read(PROFILES_FILE);
    const me = profiles.find(p => p.login === login);
    const friend = profiles.find(p => p.login === friendLogin);
    if (!me.friends.includes(friendLogin)) me.friends.push(friendLogin);
    if (!friend.friends.includes(login)) friend.friends.push(login);
    write(PROFILES_FILE, profiles);
    res.json({ success: true });
});

app.post('/api/get-friends', (req, res) => {
    const { login } = req.body;
    const profiles = read(PROFILES_FILE);
    const me = profiles.find(p => p.login === login);
    const friends = me.friends.map(f => {
        const fr = profiles.find(p => p.login === f);
        return { login: f, name: fr ? fr.name : f };
    });
    res.json({ success: true, friends });
});

// ==================== СООБЩЕНИЯ ====================
app.post('/api/get-messages', (req, res) => {
    const { user1, user2 } = req.body;
    const id = dialogId(user1, user2);
    const messages = read(MESSAGES_FILE);
    const dialog = messages.find(m => m.id === id);
    res.json({ success: true, messages: dialog ? dialog.messages : [] });
});

// ==================== SOCKET ====================
global.userSockets = {};

io.on('connection', (socket) => {
    console.log('✅ Клиент подключился');
    socket.on('user online', (login) => {
        global.userSockets[login] = socket.id;
        socket.login = login;
        console.log(`📡 ${login} онлайн`);
    });
    socket.on('private message', (data) => {
        const { from, to, text, time } = data;
        const id = dialogId(from, to);
        const messages = read(MESSAGES_FILE);
        let dialog = messages.find(m => m.id === id);
        if (!dialog) {
            dialog = { id, messages: [] };
            messages.push(dialog);
        }
        dialog.messages.push({ from, text, time });
        write(MESSAGES_FILE, messages);
        const toId = global.userSockets[to];
        if (toId) {
            io.to(toId).emit('private message', { from, text, time });
        }
    });
    socket.on('disconnect', () => {
        if (socket.login) {
            delete global.userSockets[socket.login];
            console.log(`📴 ${socket.login} отключился`);
        }
    });
});

// ==================== АДМИН-ПАНЕЛЬ (ПОЛНАЯ) ====================
app.get(ADMIN_PATH, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Админ-панель</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: 'Segoe UI', sans-serif;
                    background: #0a0a0a;
                    color: white;
                    padding: 30px;
                }
                .container { max-width: 1200px; margin: 0 auto; }
                .card {
                    background: #1a1a1a;
                    border-radius: 20px;
                    padding: 30px;
                    margin-bottom: 20px;
                }
                h1 { color: #a855f7; margin-bottom: 20px; }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                th, td {
                    padding: 12px;
                    text-align: left;
                    border-bottom: 1px solid #333;
                }
                button {
                    background: #e53e3e;
                    color: white;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    margin-right: 8px;
                }
                .clear-btn { background: #f59e0b; }
                .back-btn {
                    background: #a855f7;
                    text-decoration: none;
                    padding: 8px 16px;
                    border-radius: 8px;
                    color: white;
                    display: inline-block;
                    margin-bottom: 20px;
                }
                .error { color: #e53e3e; margin-top: 10px; }
                .success { color: #4ade80; }
            </style>
        </head>
        <body>
            <div class="container" id="app">
                <div id="loginPanel" class="card">
                    <h1>🔐 Админ-панель</h1>
                    <p>Введите мастер-пароль</p>
                    <input type="password" id="pwd" placeholder="Пароль" style="padding:8px; width:200px; margin-right:10px;">
                    <button onclick="login()">Войти</button>
                    <div id="error" class="error"></div>
                </div>
            </div>
            <script>
                async function login() {
                    const password = document.getElementById('pwd').value;
                    const res = await fetch('${ADMIN_PATH}/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password })
                    });
                    const data = await res.json();
                    if (data.success) {
                        loadAdminPanel();
                    } else {
                        document.getElementById('error').innerText = 'Неверный пароль';
                    }
                }

                async function loadAdminPanel() {
                    const res = await fetch('${ADMIN_PATH}/users');
                    const data = await res.json();
                    let html = \`
                        <div class="card">
                            <a href="/" class="back-btn">← Вернуться в чат</a>
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
                                    <button onclick="deleteUser('\${user.login}')">🗑️ Удалить пользователя</button>
                                    <button class="clear-btn" onclick="deleteUserMessages('\${user.login}')">📝 Удалить сообщения</button>
                                </td>
                            </tr>
                        \`;
                    });
                    html += \`</tbody></table></div>\`;
                    document.getElementById('app').innerHTML = html;
                }

                async function deleteUser(login) {
                    if(confirm(\`Удалить пользователя "\${login}"? ВСЕ данные будут удалены.\`)) {
                        const res = await fetch('${ADMIN_PATH}/delete-user', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ login })
                        });
                        const data = await res.json();
                        if(data.success) loadAdminPanel();
                    }
                }

                async function deleteUserMessages(login) {
                    if(confirm(\`Удалить ВСЕ сообщения пользователя "\${login}"?\`)) {
                        const res = await fetch('${ADMIN_PATH}/delete-user-messages', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ login })
                        });
                        const data = await res.json();
                        if(data.success) alert('Сообщения удалены');
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// ==================== API АДМИНА ====================
app.post(ADMIN_PATH + '/login', (req, res) => {
    res.json({ success: req.body.password === ADMIN_PASSWORD });
});

app.get(ADMIN_PATH + '/users', (req, res) => {
    const profiles = read(PROFILES_FILE);
    const users = profiles.map(p => ({
        login: p.login,
        name: p.name,
        friendsCount: p.friends.length
    }));
    res.json({ success: true, users });
});

app.post(ADMIN_PATH + '/delete-user', (req, res) => {
    const { login } = req.body;
    let users = read(USERS_FILE);
    users = users.filter(u => u.login !== login);
    write(USERS_FILE, users);
    
    let profiles = read(PROFILES_FILE);
    profiles = profiles.filter(p => p.login !== login);
    write(PROFILES_FILE, profiles);
    
    let requests = read(REQUESTS_FILE);
    requests = requests.filter(r => r.from !== login && r.to !== login);
    write(REQUESTS_FILE, requests);
    
    let messages = read(MESSAGES_FILE);
    messages = messages.map(d => {
        d.messages = d.messages.filter(m => m.from !== login);
        return d;
    }).filter(d => d.messages.length > 0);
    write(MESSAGES_FILE, messages);
    
    res.json({ success: true });
});

app.post(ADMIN_PATH + '/delete-user-messages', (req, res) => {
    const { login } = req.body;
    let messages = read(MESSAGES_FILE);
    messages = messages.map(d => {
        d.messages = d.messages.filter(m => m.from !== login);
        return d;
    }).filter(d => d.messages.length > 0);
    write(MESSAGES_FILE, messages);
    res.json({ success: true });
});

// ==================== ЗАПУСК ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🔐 Админ-панель: http://localhost:${PORT}${ADMIN_PATH}`);
});