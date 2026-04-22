document.getElementById('showRegister')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('loginPanel').style.display = 'none';
    document.getElementById('registerPanel').style.display = 'block';
});

document.getElementById('showLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('registerPanel').style.display = 'none';
    document.getElementById('loginPanel').style.display = 'block';
});

document.getElementById('registerBtn')?.addEventListener('click', async () => {
    const login = document.getElementById('regLogin').value.trim();
    const name = document.getElementById('regName').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    const res = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password, name })
    });
    const data = await res.json();
    if (data.success) {
        alert('Регистрация успешна! Теперь войдите');
        document.getElementById('registerPanel').style.display = 'none';
        document.getElementById('loginPanel').style.display = 'block';
    } else alert('Ошибка: ' + data.error);
});

document.getElementById('loginBtn')?.addEventListener('click', async () => {
    const login = document.getElementById('loginLogin').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password })
    });
    const data = await res.json();
    if (data.success) {
        localStorage.setItem('currentUser', login);
        window.location.href = '/chat.html';
    } else alert('Ошибка: ' + data.error);
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.log);
}