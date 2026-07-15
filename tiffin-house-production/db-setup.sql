-- ═══════════════════════════════════════════════════════════════════════════
--  Tiffin House — Full Database Setup
--  Run once on your PostgreSQL database before starting the app.
--  psql "postgresql://USER:PASS@HOST:5432/DB_NAME" -f db-setup.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  phone         VARCHAR(20)  UNIQUE NOT NULL,
  email         VARCHAR(150),
  password_hash TEXT         NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'customer',
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Menu items
CREATE TABLE IF NOT EXISTS menu_items (
  id            VARCHAR(100) PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  description   TEXT,
  price         NUMERIC(10,2) NOT NULL,
  image_url     TEXT,
  badge         VARCHAR(50),
  category      VARCHAR(50)  NOT NULL DEFAULT 'breakfast',
  available     BOOLEAN      NOT NULL DEFAULT true,
  sort_order    INT          NOT NULL DEFAULT 0,
  discount      NUMERIC(10,2)         DEFAULT 0,
  ingredients   TEXT,
  is_veg        BOOLEAN               DEFAULT true,
  ratings_avg   NUMERIC(3,1)          DEFAULT 4.8,
  ratings_count INT                   DEFAULT 150,
  created_at    TIMESTAMP             DEFAULT NOW()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id               SERIAL PRIMARY KEY,
  user_id          INT          REFERENCES users(id),
  status           VARCHAR(30)  NOT NULL DEFAULT 'placed',
  payment_status   VARCHAR(30)  NOT NULL DEFAULT 'pending'
                   CONSTRAINT orders_payment_status_check
                     CHECK (payment_status IN ('pending','utr_submitted','paid','failed','refunded')),
  total_amount     NUMERIC(10,2) NOT NULL,
  delivery_address TEXT,
  notes            TEXT,
  utr_number       VARCHAR(50),
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Order items (line items per order)
CREATE TABLE IF NOT EXISTS order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INT          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id     VARCHAR(100) NOT NULL,
  item_name   VARCHAR(150) NOT NULL,
  item_price  NUMERIC(10,2) NOT NULL,
  quantity    INT          NOT NULL DEFAULT 1
);

-- Coupons
CREATE TABLE IF NOT EXISTS coupons (
  id             SERIAL PRIMARY KEY,
  code           VARCHAR(50)  UNIQUE NOT NULL,
  discount_type  VARCHAR(20)  NOT NULL DEFAULT 'percentage',
  discount_value NUMERIC(10,2) NOT NULL,
  min_order      NUMERIC(10,2)         DEFAULT 0,
  max_uses       INT,
  used_count     INT                   DEFAULT 0,
  active         BOOLEAN               DEFAULT true,
  expires_at     TIMESTAMP,
  created_at     TIMESTAMP             DEFAULT NOW()
);

-- Site configuration (editable via Admin → Settings)
CREATE TABLE IF NOT EXISTS site_config (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMP    DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_user_id        ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id  ON order_items(order_id);

-- ── Default menu (4 South Indian dishes) ─────────────────────────────────────
INSERT INTO menu_items (id, name, description, price, image_url, badge, category, sort_order, is_veg, ingredients, ratings_avg, ratings_count)
VALUES
  ('idli',        'Idli',        'Soft steamed rice cakes served with sambar and coconut chutney.', 40,
   'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=600&q=80',
   'Classic', 'breakfast', 1, true, 'Rice batter, black lentils, salt', 4.9, 320),
  ('medu-vada',   'Medu Vada',   'Crispy golden lentil doughnuts served with sambar and chutney.',  50,
   'https://images.unsplash.com/photo-1630383249896-424e482df921?w=600&q=80',
   'Best Seller', 'breakfast', 2, true, 'Urad dal, ginger, green chilli, curry leaves', 4.8, 280),
  ('dosa',        'Dosa',        'Thin crispy fermented rice crepe served with sambar and chutney.', 60,
   'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?w=600&q=80',
   NULL, 'breakfast', 3, true, 'Rice batter, sesame oil, salt', 4.7, 410),
  ('masala-dosa', 'Masala Dosa', 'Crispy dosa filled with spiced potato masala, served with sambar.', 70,
   'https://images.unsplash.com/photo-1699791856025-8c69e99dfb7e?w=600&q=80',
   'Chef''s Pick', 'breakfast', 4, true, 'Rice batter, potato, onion, mustard seeds, turmeric', 4.9, 510)
ON CONFLICT (id) DO NOTHING;

-- ── Default site configuration ────────────────────────────────────────────────
INSERT INTO site_config (key, value) VALUES
  ('restaurant_name',    'Tiffin House'),
  ('restaurant_phone',   '+91 98765 43210'),
  ('restaurant_address', '42 Gandhi Nagar, Coimbatore 641001'),
  ('restaurant_hours',   'Mon–Sun: 7:00 AM – 11:00 AM'),
  ('restaurant_about',   'Fresh South Indian Breakfast, Every Morning. No compromises on taste, quality, or hygiene.'),
  ('hero_title',         'Fresh South Indian Breakfast'),
  ('hero_subtitle',      'Delivered Hot'),
  ('hero_tagline',       'Pre-order your breakfast in just 30 seconds. Authentic taste, premium quality, zero wait time.'),
  ('whatsapp_number',    '919876543210'),
  ('instagram_url',      'https://instagram.com/tiffinhouse'),
  ('upi_id',             'nakkaomshankar@axl')
ON CONFLICT (key) DO NOTHING;

-- Done!
SELECT 'Database setup complete ✅' AS status;
