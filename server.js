const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { query, initDatabase } = require('./database');

const app = express();

const PORT = 3000;
const SECRET_KEY = 'lulu_secret_key_2026';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

initDatabase();

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Не авторизовано' });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Недійсний токен' });
    }

    req.user = user;
    next();
  });
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостатньо прав' });
    }

    next();
  };
}

function storeCondition(req, alias = '') {
  const prefix = alias ? `${alias}.` : '';

  if (req.user.role === 'system_admin') {
    return {
      sql: '1=1',
      params: []
    };
  }

  return {
    sql: `${prefix}store_id = $1`,
    params: [req.user.store_id]
  };
}

// ========== LOGIN ==========

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await query(
      `SELECT 
        u.*,
        s.name AS store_name
       FROM users u
       LEFT JOIN stores s ON u.store_id = s.id
       WHERE u.username = $1`,
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Невірний логін або пароль' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Невірний логін або пароль' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        store_id: user.store_id,
        username: user.username,
        role: user.role,
        full_name: user.full_name,
        store_name: user.store_name
      },
      SECRET_KEY,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        store_id: user.store_id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        store_name: user.store_name
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== STORES ==========

app.get(
  '/api/stores',
  authenticateToken,
  requireRole(['system_admin']),
  async (req, res) => {
    try {
      const result = await query('SELECT * FROM stores ORDER BY id DESC');
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.post(
  '/api/stores',
  authenticateToken,
  requireRole(['system_admin']),
  async (req, res) => {
    const { name, email_domain, subscription_status } = req.body;

    try {
      const result = await query(
        `INSERT INTO stores (name, email_domain, subscription_status)
         VALUES ($1,$2,$3)
         RETURNING *`,
        [name, email_domain, subscription_status || 'active']
      );

      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ========== USERS ==========

app.get(
  '/api/users',
  authenticateToken,
  requireRole(['system_admin', 'manager']),
  async (req, res) => {
    try {
      let result;

      if (req.user.role === 'system_admin') {
        result = await query(`
          SELECT 
            u.id, 
            u.username, 
            u.full_name, 
            u.email, 
            u.role, 
            u.store_id, 
            s.name AS store_name
          FROM users u
          LEFT JOIN stores s ON u.store_id = s.id
          ORDER BY u.id DESC
        `);
      } else {
        result = await query(
          `
          SELECT 
            u.id, 
            u.username, 
            u.full_name, 
            u.email, 
            u.role, 
            u.store_id, 
            s.name AS store_name
          FROM users u
          LEFT JOIN stores s ON u.store_id = s.id
          WHERE u.store_id = $1 AND u.role != 'system_admin'
          ORDER BY u.id DESC
          `,
          [req.user.store_id]
        );
      }

      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.post(
  '/api/users',
  authenticateToken,
  requireRole(['system_admin', 'manager']),
  async (req, res) => {
    const { store_id, username, password, full_name, email, role } = req.body;

    try {
      let finalStoreId = store_id;

      if (req.user.role === 'manager') {
        finalStoreId = req.user.store_id;

        if (role === 'system_admin' || role === 'manager') {
          return res.status(403).json({
            error: 'Менеджер може створювати лише касира або працівника складу'
          });
        }
      }

      if (req.user.role === 'system_admin' && role !== 'system_admin' && !finalStoreId) {
        return res.status(400).json({
          error: 'Для працівника магазину потрібно вибрати магазин'
        });
      }

      const hashedPassword = bcrypt.hashSync(password, 10);

      const result = await query(
        `INSERT INTO users (store_id, username, password, full_name, email, role)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, store_id, username, full_name, email, role`,
        [
          role === 'system_admin' ? null : finalStoreId,
          username,
          hashedPassword,
          full_name,
          email,
          role
        ]
      );

      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ========== CATEGORIES ==========

app.get('/api/categories', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT * FROM categories ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== SUPPLIERS ==========

app.get('/api/suppliers', authenticateToken, async (req, res) => {
  try {
    const condition = storeCondition(req);

    const result = await query(
      `SELECT * FROM suppliers WHERE ${condition.sql} ORDER BY id DESC`,
      condition.params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(
  '/api/suppliers',
  authenticateToken,
  requireRole(['manager', 'warehouse']),
  async (req, res) => {
    const { name, contact_person, phone, email, address } = req.body;

    try {
      const result = await query(
        `INSERT INTO suppliers (store_id, name, contact_person, phone, email, address)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [req.user.store_id, name, contact_person, phone, email, address]
      );

      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ========== PRODUCTS ==========

app.get('/api/products', authenticateToken, async (req, res) => {
  try {
    const condition = storeCondition(req, 'p');

    const result = await query(
      `
      SELECT 
        p.*,
        c.name AS category_name,
        s.name AS supplier_name,
        st.name AS store_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN stores st ON p.store_id = st.id
      WHERE ${condition.sql}
      ORDER BY p.id DESC
      `,
      condition.params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(
  '/api/products',
  authenticateToken,
  requireRole(['manager', 'warehouse']),
  async (req, res) => {
    const {
      name,
      barcode,
      category_id,
      supplier_id,
      price,
      cost_price,
      quantity,
      min_quantity
    } = req.body;

    try {
      const result = await query(
        `
        INSERT INTO products
        (store_id, name, barcode, category_id, supplier_id, price, cost_price, quantity, min_quantity)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *
        `,
        [
          req.user.store_id,
          name,
          barcode,
          category_id,
          supplier_id,
          price,
          cost_price || 0,
          quantity || 0,
          min_quantity || 5
        ]
      );

      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.delete(
  '/api/products/:id',
  authenticateToken,
  requireRole(['manager']),
  async (req, res) => {
    try {
      await query(
        'DELETE FROM products WHERE id = $1 AND store_id = $2',
        [req.params.id, req.user.store_id]
      );

      res.json({ message: 'Товар видалено' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ========== SALES ==========

app.post(
  '/api/sales',
  authenticateToken,
  requireRole(['manager', 'cashier']),
  async (req, res) => {
    const { items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Кошик порожній' });
    }

    try {
      await query('BEGIN');

      let total = 0;

      for (const item of items) {
        const productResult = await query(
          'SELECT * FROM products WHERE id = $1 AND store_id = $2',
          [item.product_id, req.user.store_id]
        );

        const product = productResult.rows[0];

        if (!product) {
          throw new Error('Товар не знайдено');
        }

        if (product.quantity < item.quantity) {
          throw new Error(`Недостатньо товару "${product.name}"`);
        }

        total += Number(product.price) * item.quantity;
      }

      const receiptNumber = 'CH' + Date.now();

      const saleResult = await query(
        `INSERT INTO sales (store_id, receipt_number, user_id, total_amount)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [req.user.store_id, receiptNumber, req.user.id, total]
      );

      const sale = saleResult.rows[0];

      for (const item of items) {
        const productResult = await query(
          'SELECT * FROM products WHERE id = $1 AND store_id = $2',
          [item.product_id, req.user.store_id]
        );

        const product = productResult.rows[0];

        await query(
          `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price_at_sale)
           VALUES ($1,$2,$3,$4,$5)`,
          [sale.id, product.id, product.name, item.quantity, product.price]
        );

        await query(
          'UPDATE products SET quantity = quantity - $1 WHERE id = $2',
          [item.quantity, product.id]
        );
      }

      await query('COMMIT');

      res.json({
        message: 'Продаж оформлено',
        receipt: receiptNumber
      });
    } catch (err) {
      await query('ROLLBACK');
      res.status(500).json({ error: err.message });
    }
  }
);

app.get('/api/sales', authenticateToken, async (req, res) => {
  try {
    const condition = storeCondition(req, 's');

    const result = await query(
      `
      SELECT
        s.*,
        u.full_name AS cashier_name,
        st.name AS store_name
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN stores st ON s.store_id = st.id
      WHERE ${condition.sql}
      ORDER BY s.sale_date DESC
      `,
      condition.params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== DELIVERIES ==========

app.post(
  '/api/deliveries',
  authenticateToken,
  requireRole(['manager', 'warehouse']),
  async (req, res) => {
    const { supplier_id, product_id, quantity } = req.body;

    try {
      await query('BEGIN');

      const productResult = await query(
        'SELECT * FROM products WHERE id = $1 AND store_id = $2',
        [product_id, req.user.store_id]
      );

      const product = productResult.rows[0];

      if (!product) {
        throw new Error('Товар не знайдено');
      }

      const deliveryResult = await query(
        `INSERT INTO deliveries (store_id, supplier_id, user_id)
         VALUES ($1,$2,$3)
         RETURNING *`,
        [req.user.store_id, supplier_id, req.user.id]
      );

      const delivery = deliveryResult.rows[0];

      await query(
        `INSERT INTO delivery_items (delivery_id, product_id, product_name, quantity, purchase_price)
         VALUES ($1,$2,$3,$4,$5)`,
        [delivery.id, product.id, product.name, quantity, product.cost_price]
      );

      await query(
        'UPDATE products SET quantity = quantity + $1 WHERE id = $2',
        [quantity, product.id]
      );

      await query('COMMIT');

      res.json({ message: 'Поставка додана' });
    } catch (err) {
      await query('ROLLBACK');
      res.status(500).json({ error: err.message });
    }
  }
);

// ========== STATS ==========

app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const condition = storeCondition(req, 'p');
    const salesCondition = storeCondition(req, 's');

    const productCount = await query(
      `SELECT COUNT(*) FROM products p WHERE ${condition.sql}`,
      condition.params
    );

    const lowStockCount = await query(
      `SELECT COUNT(*) FROM products p WHERE ${condition.sql} AND p.quantity <= p.min_quantity`,
      condition.params
    );

    const totalSales = await query(
      `SELECT COALESCE(SUM(s.total_amount),0) AS total FROM sales s WHERE ${salesCondition.sql}`,
      salesCondition.params
    );

    const recentSales = await query(
      `
      SELECT
        s.receipt_number,
        s.total_amount,
        s.sale_date,
        u.full_name AS cashier,
        st.name AS store_name
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN stores st ON s.store_id = st.id
      WHERE ${salesCondition.sql}
      ORDER BY s.sale_date DESC
      LIMIT 5
      `,
      salesCondition.params
    );

    const lowProducts = await query(
      `
      SELECT p.*, st.name AS store_name
      FROM products p
      LEFT JOIN stores st ON p.store_id = st.id
      WHERE ${condition.sql} AND p.quantity <= p.min_quantity
      LIMIT 5
      `,
      condition.params
    );

    res.json({
      productCount: Number(productCount.rows[0].count),
      lowStockCount: Number(lowStockCount.rows[0].count),
      totalSales: Number(totalSales.rows[0].total),
      recentSales: recentSales.rows,
      lowProducts: lowProducts.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== REDIRECT TO LOGIN ==========

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// ========== START SERVER ==========

app.listen(PORT, () => {
  console.log(`✅ Сервер працює: http://localhost:${PORT}`);
});