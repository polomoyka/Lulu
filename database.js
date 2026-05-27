const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'shop_system',
  password: process.env.PGPASSWORD || 'postgres',
  port: Number(process.env.PGPORT || 5432),
});

const query = (text, params) => pool.query(text, params);

async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email_domain TEXT,
      subscription_status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK(role IN ('system_admin', 'manager', 'cashier', 'warehouse')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      barcode TEXT,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      price NUMERIC(10,2) NOT NULL CHECK(price > 0),
      cost_price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK(cost_price >= 0),
      quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      min_quantity INTEGER NOT NULL DEFAULT 5 CHECK(min_quantity >= 0)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
      receipt_number TEXT UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      total_amount NUMERIC(10,2) NOT NULL CHECK(total_amount >= 0),
      sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      price_at_sale NUMERIC(10,2) NOT NULL CHECK(price_at_sale > 0)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS deliveries (
      id SERIAL PRIMARY KEY,
      store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      delivery_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'completed'
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS delivery_items (
      id SERIAL PRIMARY KEY,
      delivery_id INTEGER REFERENCES deliveries(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      purchase_price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK(purchase_price >= 0)
    )
  `);

  const usersCount = await query('SELECT COUNT(*) FROM users');

  if (Number(usersCount.rows[0].count) === 0) {
    await seedDatabase();
  }

  console.log('✅ PostgreSQL база готова');
}

async function seedDatabase() {
  const storeResult = await query(
    `INSERT INTO stores (name, email_domain, subscription_status)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ['Lviv Mini Market', 'lvivmarket.ua', 'active']
  );

  const storeId = storeResult.rows[0].id;

  const systemAdminPass = bcrypt.hashSync('admin123', 10);
  const managerPass = bcrypt.hashSync('manager123', 10);
  const cashierPass = bcrypt.hashSync('cashier123', 10);
  const warehousePass = bcrypt.hashSync('warehouse123', 10);

  await query(
    `INSERT INTO users (store_id, username, password, full_name, email, role)
     VALUES 
     ($1,$2,$3,$4,$5,$6),
     ($7,$8,$9,$10,$11,$12),
     ($13,$14,$15,$16,$17,$18),
     ($19,$20,$21,$22,$23,$24)`,
    [
      null, 'admin', systemAdminPass, 'Системний адміністратор Lulu', 'admin@lulu.cloud', 'system_admin',
      storeId, 'manager', managerPass, 'Менеджер магазину', 'manager@lvivmarket.ua', 'manager',
      storeId, 'cashier', cashierPass, 'Касир Оксана', 'cashier@lvivmarket.ua', 'cashier',
      storeId, 'warehouse', warehousePass, 'Менеджер складу Андрій', 'warehouse@lvivmarket.ua', 'warehouse'
    ]
  );

  const categoryNames = ['Напої', 'Снеки', 'Молочні продукти', 'Бакалія', 'Кондитерські'];

  for (const name of categoryNames) {
    await query(
      'INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
      [name]
    );
  }

  const supplier1 = await query(
    `INSERT INTO suppliers (store_id, name, contact_person, phone, email, address)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [storeId, 'ТОВ "Продукти Плюс"', 'Іваненко І.І.', '+380501234567', 'info@produkti.ua', 'м. Львів']
  );

  const supplier2 = await query(
    `INSERT INTO suppliers (store_id, name, contact_person, phone, email, address)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [storeId, 'Фірма "Свіжість"', 'Петренко П.П.', '+380672345678', 'firma@svizhist.ua', 'м. Львів']
  );

  const categories = await query('SELECT id, name FROM categories');
  const categoryId = Object.fromEntries(categories.rows.map(c => [c.name, c.id]));

  const products = [
    ['Кава "Львівська" 200г', '482000001001', 'Напої', supplier1.rows[0].id, 85, 55, 50, 10],
    ['Чіпси "Lays" 150г', '482000001002', 'Снеки', supplier1.rows[0].id, 45, 28, 30, 10],
    ['Молоко "Галичина" 1л', '482000001003', 'Молочні продукти', supplier2.rows[0].id, 38, 24, 8, 10],
    ['Сир "Гауда" 200г', '482000001004', 'Молочні продукти', supplier2.rows[0].id, 89, 60, 4, 5],
    ['Печиво "Oreo"', '482000001005', 'Кондитерські', supplier1.rows[0].id, 55, 35, 40, 10],
    ['Оливкова олія 500мл', '482000001006', 'Бакалія', supplier2.rows[0].id, 120, 85, 2, 5]
  ];

  for (const p of products) {
    await query(
      `INSERT INTO products 
       (store_id, name, barcode, category_id, supplier_id, price, cost_price, quantity, min_quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [storeId, p[0], p[1], categoryId[p[2]], p[3], p[4], p[5], p[6], p[7]]
    );
  }

  console.log('🌱 Тестові SaaS-дані додано');
}

module.exports = { query, initDatabase };