const express = require('express');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Подключение к MySQL
const pool = mysql.createPool(process.env.MYSQL_URL);

// Создание таблиц
async function initDB() {
    try {
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS users (
                login VARCHAR(50) PRIMARY KEY,
                password_hash VARCHAR(255) NOT NULL
            )
        `);
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS profiles (
                login VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                friends TEXT DEFAULT '[]'
            )
        `);
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                dialog_id VARCHAR(100) NOT NULL,
                from_login VARCHAR(50) NOT NULL,
                text TEXT NOT NULL,
                time VARCHAR(20) NOT NULL
            )
        `);
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS friend_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                from_login VARCHAR(50) NOT NULL,
                to_login VARCHAR(50) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending'
            )
        `);
        console.log('✅ Таблицы созданы');
    } catch (err) {
        console.error('❌ Ошибка БД:', err.message);
    }
}
initDB();

const ADMIN_PASSWORD = 'dartik24891074';
const ADMIN_PATH = '/admin-panel-2024';

// ==================== API РЕГИСТРАЦИИ ====================
app.post('/api/register', async (req, res) => {
    const { login, password, name } = req.body;
    if (!login || !password || !name) {
        return res.json({ success: false, error: 'Заполните все поля' });
    }
    try {
        const [existing] = await pool.execute('SELECT * FROM users WHERE login = ?', [login]);
        if (existing.length > 0) {
            return res.json({ success: false, error: 'Пользователь уже существует' });
        }
        const hash = await bcrypt.hash(password, 10);
        await pool.execute('INSERT INTO users (login, password_hash) VALUES (?, ?)', [login, hash]);
        await pool.execute('INSERT INTO profiles (login, name) VALUES (?, ?)', [login, name]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ==================== API ЛОГИНА ====================
app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE login = ?', [login]);
        if (rows.length === 0) {
            return res.json({ success: false, error: 'Неверный логин' });
        }
        const valid = await bcrypt.compare(password, rows[0].password_hash);
        if (!valid) {
            return res.json({ success: false, error: 'Неверный пароль' });
        }
        res.json({ success: true, login });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ==================== API ДРУЗЕЙ ====================
app.post('/api/search-user', async (req, res) => {
    const { login, currentUser } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM profiles WHERE login = ?', [login]);
        if (rows.length === 0) {
            return res.json({ success: false, error: 'Пользователь не найден' });
        }
        if (login === currentUser) {
            return res.json({ success: false, error: 'Это вы' });
        }
        const [meRows] = await pool.execute('SELECT friends FROM profiles WHERE login = ?', [currentUser]);
        let friends = [];
        if (meRows.length > 0 && meRows[0].friends) {
            friends = JSON.parse(meRows[0].friends);
        }
        if (friends.includes(login)) {
            return res.json({ success: false, error: 'Уже в друзьях' });
        }
        res.json({ success: true, name: rows[0].name, login });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/send-request', async (req, res) => {
    const { from, to } = req.body;
    try {
        const [existing] = await pool.execute(
            'SELECT * FROM friend_requests WHERE from_login = ? AND to_login = ?',
            [from, to]
        );
        if (existing.length > 0) {
            return res.json({ success: false, error: 'Заявка уже отправлена' });
        }
        await pool.execute('INSERT INTO friend_requests (from_login, to_login) VALUES (?, ?)', [from, to]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/get-requests', async (req, res) => {
    const { login } = req.body;
    try {
        const [rows] = await pool.execute(
            'SELECT from_login FROM friend_requests WHERE to_login = ? AND status = ?',
            [login, 'pending']
        );
        const requests = [];
        for (const row of rows) {
            const [profile] = await pool.execute('SELECT name FROM profiles WHERE login = ?', [row.from_login]);
            requests.push({ from: row.from_login, name: profile[0]?.name || row.from_login });
        }
        res.json({ success: true, requests });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/accept-request', async (req, res) => {
    const { login, friendLogin } = req.body;
    try {
        await pool.execute('DELETE FROM friend_requests WHERE from_login = ? AND to_login = ?', [friendLogin, login]);
        
        const [meRows] = await pool.execute('SELECT friends FROM profiles WHERE login = ?', [login]);
        let myFriends = meRows[0]?.friends ? JSON.parse(meRows[0].friends) : [];
        if (!myFriends.includes(friendLogin)) myFriends.push(friendLogin);
        await pool.execute('UPDATE profiles SET friends = ? WHERE login = ?', [JSON.stringify(myFriends), login]);
        
        const [friendRows] = await pool.execute('SELECT friends FROM profiles WHERE login = ?', [friendLogin]);
        let friendFriends = friendRows[0]?.friends ? JSON.parse(friendRows[0].friends) : [];
        if (!friendFriends.includes(login)) friendFriends.push(login);
        await pool.execute('UPDATE profiles SET friends = ? WHERE login = ?', [JSON.stringify(friendFriends), friendLogin]);
        
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

app.post('/api/get-friends', async (req, res) => {
    const { login } = req.body;
    try {
        const [rows] = await pool.execute('SELECT friends FROM profiles WHERE login = ?', [login]);
        let friendsList = rows[0]?.friends ? JSON.parse(rows[0].friends) : [];
        const friends = [];
        for (const f of friendsList) {
            const [profile] = await pool.execute('SELECT name FROM profiles WHERE login = ?', [f]);
            friends.push({ login: f, name: profile[0]?.name || f });
        }
        res.json({ success: true, friends });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ==================== API СООБЩЕНИЙ ====================
app.post('/api/get-messages', async (req, res) => {
    const { user1, user2 } = req.body;
    const dialogId = [user1, user2].sort().join('_');
    try {
        const [rows] = await pool.execute(
            'SELECT from_login, text, time FROM messages WHERE dialog_id = ? ORDER BY id',
            [dialogId]
        );
        const messages = rows.map(row => ({
            from: row.from_login,
            text: row.text,
            time: row.time
        }));
        res.json({ success: true, messages });
    } catch (err) {
        res.json({ success: false, error: 'Ошибка сервера' });
    }
});

// ==================== АДМИН-ПАНЕЛЬ ====================
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
            let html = '<h2>Пользователи</h2></table><tr><th>Логин</th><th>Имя</th><th>Друзей</th><th>Действия</th></tr>';
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
    try {
        const [rows] = await pool.execute('SELECT login, name, friends FROM profiles');
        const users = rows.map(row => ({
            login: row.login,
            name: row.name,
            friendsCount: row.friends ? JSON.parse(row.friends).length : 0
        }));
        res.json({ success: true, users });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post(ADMIN_PATH + '/delete-user', async (req, res) => {
    const { login } = req.body;
    try {
        await pool.execute('DELETE FROM users WHERE login = ?', [login]);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ==================== SOCKET.IO ====================
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
        try {
            await pool.execute(
                'INSERT INTO messages (dialog_id, from_login, text, time) VALUES (?, ?, ?, ?)',
                [dialogId, from, text, time]
            );
            const toId = global.userSockets[to];
            if (toId) {
                io.to(toId).emit('private message', { from, text, time });
            }
        } catch (err) {
            console.error('Ошибка сохранения сообщения:', err);
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