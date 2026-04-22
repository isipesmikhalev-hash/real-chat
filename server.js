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

// ==================== РАБОТА С ФАЙЛАМИ ====================
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');

// Создаём папку data, если её нет
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Инициализация файлов
function initFile(file, defaultData) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
}

initFile(USERS_FILE, []);      // { login, passwordHash }
initFile(PROFILES_FILE, []);   // { login, name, friends, avatar }
initFile(MESSAGES_FILE, []);   // { dialogId, messages: [{from, text, time}] }
initFile(REQUESTS_FILE, []);   // { from, to, status }

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function readJSON(file) {
    return JSON.parse(fs.readFileSync(file));
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Получить ID диалога между двумя пользователями
function getDialogId(user1, user2) {
    return [user1, user2].sort().join('_');
}

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
    
    // Проверяем, нет ли уже заявки
    const existing = requests.find(r => (r.from === from && r.to === to) || (r.from === to && r.to === from));
    if (existing) {
        return res.json({ success: false, error: 'Заявка уже отправлена' });
    }
    
    requests.push({ from, to, status: 'pending' });
    writeJSON(REQUESTS_FILE, requests);
    
    // Уведомляем получателя через socket
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
    
    // Обновляем статус заявки
    const requestIndex = requests.findIndex(r => r.from === friendLogin && r.to === login);
    if (requestIndex !== -1) requests[requestIndex].status = 'accepted';
    writeJSON(REQUESTS_FILE, requests);
    
    // Добавляем в друзья обоим
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
        
        // Сохраняем сообщение
        const messages = readJSON(MESSAGES_FILE);
        let dialog = messages.find(m => m.dialogId === dialogId);
        if (!dialog) {
            dialog = { dialogId, messages: [] };
            messages.push(dialog);
        }
        dialog.messages.push({ from, text, time });
        writeJSON(MESSAGES_FILE, messages);
        
        // Отправляем получателю, если он онлайн
        const recipientSocketId = global.userSockets[to];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('private message', { from, text, time, dialogId });
        }
        
        // Отправляем отправителю подтверждение
        socket.emit('message sent', { to, text, time });
    });
    
    socket.on('disconnect', () => {
        if (socket.login) {
            delete global.userSockets[socket.login];
            console.log(`${socket.login} отключился`);
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`✅ Мессенджер запущен на http://localhost:${PORT}`);
});