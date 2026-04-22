const express = require('express');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Подключение к БД
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Создание таблиц
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                login TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS profiles (
                login TEXT PRIMARY KEY REFERENCES users(login) ON DELETE CASCADE,
                name TEXT NOT NULL,
                friends TEXT[] DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                dialog_id TEXT NOT NULL,
                from_login TEXT NOT NULL,
                text TEXT NOT NULL,
                time TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS friend_requests (
                id SERIAL PRIMARY KEY,
                from_login TEXT NOT NULL,
                to_login TEXT NOT NULL,
                status TEXT DEFAULT 'pending'
            );
        `);
        console.log('✅ Таблицы созданы');
    } catch (err) {
        console.error('❌ Ошибка БД:', err.message);
    }
}
initDB();

const ADMIN_PASSWORD = 'dartik24891074';
const ADMIN_PATH = '/admin-panel-2024';

// Регистрация
app.post('/api/register', async (req, res) => {
    const { login, password, name } = req.body;
    if (!login || !password || !name) {
        return res.json({ success: false, error: 'Заполните все поля' });
    }
    const existing = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
    if (existing.rows.length > 0) {
        return res.json({ success: false, error: 'Пользователь уже существует' });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (login, password_hash) VALUES ($1, $2)', [login, hash]);
    await pool.query('INSERT INTO profiles (login, name) VALUES ($1, $2)', [login, name]);
    res.json({ success: true });
});

// Логин
app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
    if (result.rows.length === 0) {
        return res.json({ success: false, error: 'Неверный логин' });
    }
    const valid = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!valid) {
        return res.json({ success: false, error: 'Неверный пароль' });
    }
    res.json({ success: true, login });
});

// Поиск пользователя
app.post('/api/search-user', async (req, res) => {
    const { login, currentUser } = req.body;
    const result = await pool.query('SELECT * FROM profiles WHERE login = $1', [login]);
    if (result.rows.length === 0) {
        return res.json({ success: false, error: 'Пользователь не найден' });
    }
    if (login === currentUser) {
        return res.json({ success: false, error: 'Это вы' });
    }
    const me = await pool.query('SELECT friends FROM profiles WHERE login = $1', [currentUser]);
    const friends = me.rows[0]?.friends || [];
    if (friends.includes(login)) {
        return res.json({ success: false, error: 'Уже в друзьях' });
    }
    res.json({ success: true, name: result.rows[0].name, login });
});

// Отправить заявку
app.post('/api/send-request', async (req, res) => {
    const { from, to } = req.body;
    const existing = await pool.query(
        'SELECT * FROM friend_requests WHERE from_login = $1 AND to_login = $2',
        [from, to]
    );
    if (existing.rows.length > 0) {
        return res.json({ success: false, error: 'Заявка уже отправлена' });
    }
    await pool.query('INSERT INTO friend_requests (from_login, to_login) VALUES ($1, $2)', [from, to]);
    res.json({ success: true });
});

// Получить заявки
app.post('/api/get-requests', async (req, res) => {
    const { login } = req.body;
    const result = await pool.query(
        'SELECT from_login FROM friend_requests WHERE to_login = $1 AND status = $2',
        [login, 'pending']
    );
    const requests = [];
    for (const row of result.rows) {
        const profile = await pool.query('SELECT name FROM profiles WHERE login = $1', [row.from_login]);
        requests.push({ from: row.from_login, name: profile.rows[0]?.name || row.from_login });
    }
    res.json({ success: true, requests });
});

// Принять заявку
app.post('/api/accept-request', async (req, res) => {
    const { login, friendLogin } = req.body;
    await pool.query('DELETE FROM friend_requests WHERE from_login = $1 AND to_login = $2', [friendLogin, login]);
    await pool.query('UPDATE profiles SET friends = array_append(friends, $1) WHERE login = $2', [friendLogin, login]);
    await pool.query('UPDATE profiles SET friends = array_append(friends, $1) WHERE login = $2', [login, friendLogin]);
    res.json({ success: true });
});

// Получить друзей
app.post('/api/get-friends', async (req, res) => {
    const { login } = req.body;
    const result = await pool.query('SELECT friends FROM profiles WHERE login = $1', [login]);
    const friendsList = result.rows[0]?.friends || [];
    const friends = [];
    for (const f of friendsList) {
        const profile = await pool.query('SELECT name FROM profiles WHERE login = $1', [f]);
        friends.push({ login: f, name: profile.rows[0]?.name || f });
    }
    res.json({ success: true, friends });
});

// Получить сообщения
app.post('/api/get-messages', async (req, res) => {
    const { user1, user2 } = req.body;
    const dialogId = [user1, user2].sort().join('_');
    const result = await pool.query(
        'SELECT from_login, text, time FROM messages WHERE dialog_id = $1 ORDER BY id',
        [dialogId]
    );
    const messages = result.rows.map(row => ({
        from: row.from_login,
        text: row.text,
        time: row.time
    }));
    res.json({ success: true, messages });
});

// Админ-панель
app.get(ADMIN_PATH, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><title>Админ-панель</title>
        <style>
            body { background: #0a0a0a; color: white; font-family: Arial; padding: 20px; }
            .card { background: #1a1a1a; border-radius: 20px; padding: 20px; max-width: 1000px; margin: 0 auto; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 10px; text-align: left; border-bottom: 1px solid #333; }
            button { background: #e53e3e; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer; }
            .back-btn { background: #a855f7; text-decoration: none; padding: 8px 16px; border-radius: 8px; color: white; display: inline-block; margin-bottom: 20px; }
        </style>
        </head>
        <body>
        <div class="card">
        <a href="/" class="back-btn">← Вернуться в чат</a>
        <h1>🔐 Админ-панель</h1>
        <input type="password" id="pwd" placeholder="Пароль">
        <button onclick="login()">Войти</button>
        <div id="panel"></div>
        </div>
        <script>
        async function login() {
            const pwd = document.getElementById('pwd').value;
            const res = await fetch('/admin-panel-2024/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pwd })
            });
            const data = await res.json();
            if (data.success) loadPanel();
            else alert('Неверный пароль');
        }
        async function loadPanel() {
            const res = await fetch('/admin-panel-2024/users');
            const data = await res.json();
            let html = '<h2>Пользователи</h2><table><tr><th>Логин</th><th>Имя</th><th>Друзей</th><th>Действия</th></tr>';
            data.users.forEach(user => {
                html += '<tr><td>' + user.login + '</td><td>' + user.name + '</td><td>' + (user.friendsCount || 0) + '</td><td><button onclick="deleteUser(\'' + user.login + '\')">Удалить</button></td></tr>';
            });
            html += '</table>';
            document.getElementById('panel').innerHTML = html;
        }
        async function deleteUser(login) {
            if(confirm('Удалить ' + login + '?')) {
                await fetch('/admin-panel-2024/delete-user', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login })
                });
                loadPanel();
            }
        }
        </script>
        </body>
        </html>
    `);
});

app.post(ADMIN_PATH + '/login', (req, res) => {
    res.json({ success: req.body.password === ADMIN_PASSWORD });
});

app.get(ADMIN_PATH + '/users', async (req, res) => {
    const result = await pool.query('SELECT login, name, array_length(friends, 1) as friendsCount FROM profiles');
    res.json({ success: true, users: result.rows });
});

app.post(ADMIN_PATH + '/delete-user', async (req, res) => {
    const { login } = req.body;
    await pool.query('DELETE FROM users WHERE login = $1', [login]);
    res.json({ success: true });
});

// Socket.io
global.userSockets = {};

io.on('connection', (socket) => {
    console.log('✅ Клиент подключился');
    socket.on('user online', (login) => {
        global.userSockets[login] = socket.id;
        socket.login = login;
        console.log(`📡 ${login} онлайн`);
    });
    socket.on('private message', async (data) => {
        const { from, to, text, time } = data;
        const dialogId = [from, to].sort().join('_');
        await pool.query(
            'INSERT INTO messages (dialog_id, from_login, text, time) VALUES ($1, $2, $3, $4)',
            [dialogId, from, text, time]
        );
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🔐 Админ-панель: /${ADMIN_PATH}`);
});