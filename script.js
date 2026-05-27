const API_URL = '/api';

function getToken() {
  return localStorage.getItem('token');
}

function getUser() {
  return JSON.parse(localStorage.getItem('loggedUser') || '{}');
}

function checkAuth(allowedRoles = []) {
  const token = getToken();
  const user = getUser();

  if (!token || !user.username) {
    window.location.href = 'login.html';
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    alert('Недостатньо прав для доступу до цієї сторінки');
    window.location.href = 'dashboard.html';
    return null;
  }

  return user;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('loggedUser');
  window.location.href = 'login.html';
}

function updateUserInfo() {
  const user = getUser();
  const userNameSpan = document.getElementById('userName');

  if (userNameSpan) {
    userNameSpan.innerText = user.store_name
      ? `${user.full_name} · ${user.store_name}`
      : user.full_name || user.username;
  }
}

function renderNav(activePage) {
  const user = getUser();

  const navItems = {
    system_admin: [
      ['dashboard', 'dashboard.html', '📊 Головна'],
      ['stores', 'stores.html', '🏪 Магазини'],
      ['users', 'users.html', '👥 Користувачі']
    ],
    manager: [
      ['dashboard', 'dashboard.html', '📊 Головна'],
      ['products', 'products.html', '📦 Товари'],
      ['sales', 'sales.html', '💰 Продажі'],
      ['stock', 'stock.html', '📥 Склад'],
      ['suppliers', 'suppliers.html', '🚚 Постачальники'],
      ['users', 'users.html', '👥 Працівники'],
      ['reports', 'reports.html', '📈 Звіти']
    ],
    cashier: [
      ['dashboard', 'dashboard.html', '📊 Головна'],
      ['products', 'products.html', '📦 Товари'],
      ['sales', 'sales.html', '💰 Продажі']
    ],
    warehouse: [
      ['dashboard', 'dashboard.html', '📊 Головна'],
      ['products', 'products.html', '📦 Товари'],
      ['stock', 'stock.html', '📥 Склад'],
      ['suppliers', 'suppliers.html', '🚚 Постачальники'],
      ['reports', 'reports.html', '📈 Звіти']
    ]
  };

  const nav = document.getElementById('navMenu');
  const menu = navItems[user.role] || [];

  if (nav) {
    nav.innerHTML = menu
      .map(([key, href, text]) => {
        return `<a href="${href}" class="${key === activePage ? 'active' : ''}">${text}</a>`;
      })
      .join('');
  }
}

async function apiRequest(endpoint, options = {}) {
  const token = getToken();

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Помилка запиту');
  }

  return data;
}

function getProductStatus(product) {
  if (Number(product.quantity) <= 0) return 'out';
  if (Number(product.quantity) <= Number(product.min_quantity)) return 'low';
  return 'normal';
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('uk-UA');
}

function roleName(role) {
  const roles = {
    system_admin: 'Системний адміністратор',
    manager: 'Менеджер магазину',
    cashier: 'Касир',
    warehouse: 'Працівник складу'
  };

  return roles[role] || role;
}