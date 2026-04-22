// Регистрация PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(() => console.log('Service Worker registered'))
    .catch((err) => console.log('SW error:', err));
}
const loginPanel = document.getElementById('loginPanel');
const registerPanel = document.getElementById('registerPanel');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');

// Показать регистрацию
document.getElementById('showRegister').addEventListener('click', (e) => {
    e.preventDefault();
    loginPanel.style.display = 'none';
    registerPanel.style.display = 'block';
});

// Показать вход
document.getElementById('showLogin').addEventListener('click', (e) => {
    e.preventDefault();
    registerPanel.style.display = 'none';
    loginPanel.style.display = 'block';
});

// ЛОГИН
document.getElementById('loginBtn').addEventListener('click', async () => {
    const login = document.getElementById('loginLogin').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    
    loginError.textContent = '';
    
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
    });
    
    const data = await res.json();
    
    if (data.success) {
        localStorage.setItem('currentUser', login);
        window.location.href = '/chat.html';
    } else {
        loginError.textContent = data.error;
    }
});

// РЕГИСТРАЦИЯ
document.getElementById('registerBtn').addEventListener('click', async () => {
    const login = document.getElementById('regLogin').value.trim();
    const name = document.getElementById('regName').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    
    registerError.textContent = '';
    
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password, name })
    });
    
    const data = await res.json();
    
    if (data.success) {
        alert('Регистрация успешна! Теперь войдите');
        registerPanel.style.display = 'none';
        loginPanel.style.display = 'block';
        document.getElementById('loginLogin').value = login;
    } else {
        registerError.textContent = data.error;
    }
});