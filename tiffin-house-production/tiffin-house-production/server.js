// server/index.prod.ts
import express from "express";
import cors from "cors";
import path2 from "path";
import { fileURLToPath } from "url";
import bcrypt2 from "bcryptjs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// server/db.ts
import { Pool } from "pg";
var pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});
var db_default = pool;

// server/routes/auth.ts
import { Router } from "express";
import bcrypt from "bcryptjs";

// server/middleware/auth.ts
import jwt from "jsonwebtoken";
var JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "tiffin-house-secret-2024";
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

// server/routes/auth.ts
var router = Router();
router.post("/register", async (req, res) => {
  try {
    const { name, phone, password, email } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: "Name, phone and password required" });
    if (!/^\d{10}$/.test(phone)) return res.status(400).json({ error: "Phone must be 10 digits" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const existing = await db_default.query("SELECT id FROM users WHERE phone=$1", [phone]);
    if (existing.rows.length) return res.status(409).json({ error: "Phone already registered" });
    const hash = await bcrypt.hash(password, 10);
    const result = await db_default.query(
      "INSERT INTO users (name, phone, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, phone, role",
      [name.trim(), phone, email || null, hash, "customer"]
    );
    const user = result.rows[0];
    const token = signToken({ id: user.id, phone: user.phone, role: user.role, name: user.name });
    res.json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: "Phone and password required" });
    const result = await db_default.query("SELECT * FROM users WHERE phone=$1", [phone]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    const token = signToken({ id: user.id, phone: user.phone, role: user.role, name: user.name });
    res.json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/me", authenticate, async (req, res) => {
  res.json({ user: req.user });
});
var auth_default = router;

// server/routes/menu.ts
import { Router as Router2 } from "express";
var router2 = Router2();
router2.get("/", async (_req, res) => {
  const result = await db_default.query(
    "SELECT * FROM menu_items WHERE available=true ORDER BY sort_order"
  );
  res.json(result.rows);
});
router2.patch("/:id/availability", authenticate, adminOnly, async (req, res) => {
  const { available } = req.body;
  const result = await db_default.query(
    "UPDATE menu_items SET available=$1 WHERE id=$2 RETURNING *",
    [available, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Item not found" });
  res.json(result.rows[0]);
});
var menu_default = router2;

// server/routes/orders.ts
import { Router as Router3 } from "express";
var router3 = Router3();
router3.post("/", authenticate, async (req, res) => {
  const client = await db_default.connect();
  try {
    const { items, delivery_address, notes } = req.body;
    if (!items?.length) return res.status(400).json({ error: "Cart is empty" });
    const ids = items.map((i) => i.id);
    const menuResult = await client.query(
      "SELECT * FROM menu_items WHERE id = ANY($1::text[]) AND available=true",
      [ids]
    );
    const menuMap = {};
    menuResult.rows.forEach((r) => menuMap[r.id] = r);
    let total = 0;
    const validatedItems = items.map((i) => {
      const mi = menuMap[i.id];
      if (!mi) throw new Error(`Item ${i.id} not available`);
      const subtotal = parseFloat(mi.price) * i.quantity;
      total += subtotal;
      return { ...i, name: mi.name, price: parseFloat(mi.price), subtotal };
    });
    await client.query("BEGIN");
    const orderRes = await client.query(
      `INSERT INTO orders (user_id, customer_name, customer_phone, delivery_address, total_amount, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, req.user.name, req.user.phone, delivery_address || null, total, notes || null]
    );
    const order = orderRes.rows[0];
    for (const item of validatedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, menu_item_id, item_name, item_price, quantity, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [order.id, item.id, item.name, item.price, item.quantity, item.subtotal]
      );
    }
    await client.query("COMMIT");
    const fullOrder = await getOrderWithItems(client, order.id);
    res.status(201).json(fullOrder);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
router3.get("/my", authenticate, async (req, res) => {
  const orders = await db_default.query(
    `SELECT o.*, json_agg(oi.*) as items FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC`,
    [req.user.id]
  );
  res.json(orders.rows);
});
router3.get("/:id/status", async (req, res) => {
  const result = await db_default.query(
    `SELECT o.id, o.status, o.payment_status, o.estimated_minutes, o.created_at, o.updated_at,
            o.customer_name, o.total_amount,
            json_agg(json_build_object('name', oi.item_name, 'quantity', oi.quantity, 'price', oi.item_price)) as items
     FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id=$1 GROUP BY o.id`,
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Order not found" });
  res.json(result.rows[0]);
});
async function getOrderWithItems(client, orderId) {
  const result = await client.query(
    `SELECT o.*, json_agg(oi.*) as items FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id=$1 GROUP BY o.id`,
    [orderId]
  );
  return result.rows[0];
}
var orders_default = router3;

// server/routes/payment.ts
import { Router as Router4 } from "express";
var router4 = Router4();
var UPI_ID = "nakkaomshankar@axl";
var UPI_NAME = "Tiffin House";
router4.post("/create-order", authenticate, async (req, res) => {
  try {
    const { order_id } = req.body;
    const orderRes = await db_default.query(
      "SELECT * FROM orders WHERE id=$1 AND user_id=$2",
      [order_id, req.user.id]
    );
    if (!orderRes.rows.length) return res.status(404).json({ error: "Order not found" });
    const order = orderRes.rows[0];
    res.json({
      upi_id: UPI_ID,
      upi_name: UPI_NAME,
      amount: parseFloat(order.total_amount),
      order_id: order.id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router4.post("/submit-utr", authenticate, async (req, res) => {
  try {
    const { order_id, utr_number } = req.body;
    if (!utr_number || String(utr_number).trim().length < 10) {
      return res.status(400).json({ error: "Invalid UTR number \u2014 must be at least 10 characters" });
    }
    const clean = String(utr_number).trim().toUpperCase();
    const orderRes = await db_default.query(
      "SELECT * FROM orders WHERE id=$1 AND user_id=$2",
      [order_id, req.user.id]
    );
    if (!orderRes.rows.length) return res.status(404).json({ error: "Order not found" });
    await db_default.query(
      `UPDATE orders
       SET utr_number=$1, payment_status='utr_submitted', status='confirmed', updated_at=NOW()
       WHERE id=$2 AND user_id=$3`,
      [clean, order_id, req.user.id]
    );
    res.json({ ok: true, utr_number: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
var payment_default = router4;

// server/routes/admin.ts
import { Router as Router5 } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
var router5 = Router5();
router5.use(authenticate, adminOnly);
var uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
var storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `food_${Date.now()}${ext}`);
  }
});
var upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  // 5MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});
router5.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});
router5.get("/stats", async (_req, res) => {
  const [orders, revenue, customers, active, todayOrders, topItems] = await Promise.all([
    db_default.query("SELECT COUNT(*) FROM orders"),
    db_default.query("SELECT COALESCE(SUM(total_amount),0) as total FROM orders WHERE payment_status IN ('paid','utr_submitted')"),
    db_default.query("SELECT COUNT(*) FROM users WHERE role=$1", ["customer"]),
    db_default.query("SELECT COUNT(*) FROM orders WHERE status NOT IN ('delivered','cancelled')"),
    db_default.query("SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE"),
    db_default.query(`SELECT oi.item_name, SUM(oi.quantity) as qty
      FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.created_at >= NOW() - INTERVAL '7 days'
      GROUP BY oi.item_name ORDER BY qty DESC LIMIT 5`)
  ]);
  res.json({
    total_orders: parseInt(orders.rows[0].count),
    revenue: parseFloat(revenue.rows[0].total),
    total_customers: parseInt(customers.rows[0].count),
    pending_orders: parseInt(active.rows[0].count),
    today_orders: parseInt(todayOrders.rows[0].count),
    top_items: topItems.rows
  });
});
router5.get("/reports/sales", async (req, res) => {
  const days = parseInt(req.query.days || "7");
  const result = await db_default.query(`
    SELECT
      created_at::date AS date,
      COUNT(*) AS orders,
      COALESCE(SUM(total_amount),0) AS revenue
    FROM orders
    WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY created_at::date
    ORDER BY date ASC
  `, [days]);
  res.json(result.rows);
});
router5.get("/orders", async (req, res) => {
  const { status, payment_status, search } = req.query;
  const params = [];
  const where = [];
  if (status) {
    params.push(status);
    where.push(`o.status=$${params.length}`);
  }
  if (payment_status) {
    params.push(payment_status);
    where.push(`o.payment_status=$${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(u.name ILIKE $${params.length} OR u.phone ILIKE $${params.length} OR CAST(o.id AS TEXT) = $${params.length})`);
  }
  const q = `
    SELECT
      o.*,
      u.name AS customer_name,
      u.phone AS customer_phone,
      u.email AS customer_email,
      json_agg(
        json_build_object('name', oi.item_name, 'quantity', oi.quantity, 'price', oi.item_price)
        ORDER BY oi.id
      ) FILTER (WHERE oi.id IS NOT NULL) AS items
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    GROUP BY o.id, u.name, u.phone, u.email
    ORDER BY o.created_at DESC
  `;
  const result = await db_default.query(q, params);
  res.json(result.rows);
});
router5.patch("/orders/:id/status", async (req, res) => {
  const { status } = req.body;
  const valid = ["placed", "confirmed", "preparing", "ready", "delivered", "cancelled"];
  if (!valid.includes(status)) return res.status(400).json({ error: "Invalid status" });
  const result = await db_default.query(
    "UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
    [status, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Order not found" });
  res.json(result.rows[0]);
});
router5.patch("/orders/:id/confirm-payment", async (req, res) => {
  const result = await db_default.query(
    "UPDATE orders SET payment_status='paid', updated_at=NOW() WHERE id=$1 RETURNING *",
    [req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Order not found" });
  res.json(result.rows[0]);
});
router5.get("/customers", async (_req, res) => {
  const result = await db_default.query(`
    SELECT
      u.id, u.name, u.phone, u.email, u.created_at,
      COUNT(o.id) AS order_count,
      COALESCE(SUM(o.total_amount), 0) AS total_spent
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    WHERE u.role = 'customer'
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  res.json(result.rows);
});
router5.get("/menu", async (_req, res) => {
  const result = await db_default.query("SELECT * FROM menu_items ORDER BY sort_order");
  res.json(result.rows);
});
router5.post("/menu", async (req, res) => {
  const { id, name, description, price, image_url, badge, category, ingredients, is_veg, discount, available } = req.body;
  if (!id || !name || !price) return res.status(400).json({ error: "id, name, price are required" });
  const maxOrder = await db_default.query("SELECT COALESCE(MAX(sort_order),0) AS m FROM menu_items");
  const sortOrder = parseInt(maxOrder.rows[0].m) + 1;
  const result = await db_default.query(`
    INSERT INTO menu_items (id, name, description, price, image_url, badge, category, ingredients, is_veg, discount, available, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `, [
    id,
    name,
    description || "",
    price,
    image_url || "",
    badge || null,
    category || "breakfast",
    ingredients || null,
    is_veg !== false,
    discount || 0,
    available !== false,
    sortOrder
  ]);
  res.status(201).json(result.rows[0]);
});
router5.patch("/menu/:id", async (req, res) => {
  const { name, description, price, image_url, badge, category, ingredients, is_veg, discount, available } = req.body;
  const result = await db_default.query(`
    UPDATE menu_items SET
      name = COALESCE($1, name),
      description = COALESCE($2, description),
      price = COALESCE($3, price),
      image_url = COALESCE($4, image_url),
      badge = $5,
      category = COALESCE($6, category),
      ingredients = COALESCE($7, ingredients),
      is_veg = COALESCE($8, is_veg),
      discount = COALESCE($9, discount),
      available = COALESCE($10, available)
    WHERE id=$11 RETURNING *
  `, [name, description, price, image_url, badge, category, ingredients, is_veg, discount, available, req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: "Item not found" });
  res.json(result.rows[0]);
});
router5.delete("/menu/:id", async (req, res) => {
  await db_default.query("UPDATE menu_items SET available=false WHERE id=$1", [req.params.id]);
  await db_default.query("DELETE FROM menu_items WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});
router5.get("/coupons", async (_req, res) => {
  const result = await db_default.query("SELECT * FROM coupons ORDER BY created_at DESC");
  res.json(result.rows);
});
router5.post("/coupons", async (req, res) => {
  const { code, discount_type, discount_value, min_order, max_uses, expires_at } = req.body;
  if (!code || !discount_value) return res.status(400).json({ error: "code and discount_value are required" });
  const result = await db_default.query(`
    INSERT INTO coupons (code, discount_type, discount_value, min_order, max_uses, expires_at)
    VALUES (UPPER($1),$2,$3,$4,$5,$6) RETURNING *
  `, [code, discount_type || "percentage", discount_value, min_order || 0, max_uses || null, expires_at || null]);
  res.status(201).json(result.rows[0]);
});
router5.patch("/coupons/:id", async (req, res) => {
  const { active } = req.body;
  const result = await db_default.query(
    "UPDATE coupons SET active=$1 WHERE id=$2 RETURNING *",
    [active, req.params.id]
  );
  res.json(result.rows[0]);
});
router5.delete("/coupons/:id", async (req, res) => {
  await db_default.query("DELETE FROM coupons WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});
router5.get("/config", async (_req, res) => {
  const result = await db_default.query("SELECT key, value FROM site_config ORDER BY key");
  const config = {};
  result.rows.forEach((r) => {
    config[r.key] = r.value;
  });
  res.json(config);
});
router5.patch("/config", async (req, res) => {
  const updates = req.body;
  for (const [key, value] of Object.entries(updates)) {
    await db_default.query(
      "INSERT INTO site_config(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()",
      [key, value]
    );
  }
  res.json({ ok: true });
});
var admin_default = router5;

// server/index.prod.ts
var __dirname2 = path2.dirname(fileURLToPath(import.meta.url));
var app = express();
var PORT = parseInt(process.env.PORT || "3001");
app.use(helmet({
  contentSecurityPolicy: false,
  // disabled so the SPA's inline scripts work
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
var limiter = rateLimit({ windowMs: 15 * 60 * 1e3, max: 500, standardHeaders: true, legacyHeaders: false });
app.use(limiter);
app.use("/uploads", express.static(path2.join(__dirname2, "..", "uploads")));
app.use("/api/auth", auth_default);
app.use("/api/menu", menu_default);
app.use("/api/orders", orders_default);
app.use("/api/payment", payment_default);
app.use("/api/admin", admin_default);
app.get("/api/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
var publicDir = path2.join(__dirname2, "..", "public");
app.use(express.static(publicDir));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return;
  res.sendFile(path2.join(publicDir, "index.html"));
});
async function seedAdmin() {
  try {
    const adminPhone = process.env.ADMIN_PHONE || "0000000000";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123";
    const existing = await db_default.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
    if (!existing.rows.length) {
      const hash = await bcrypt2.hash(adminPassword, 10);
      await db_default.query(
        "INSERT INTO users (name, phone, password_hash, role) VALUES ('Admin', $1, $2, 'admin')",
        [adminPhone, hash]
      );
      console.log(`\u2705 Admin seeded \u2014 phone: ${adminPhone}`);
    }
  } catch (err) {
    console.error("Admin seed error:", err);
  }
}
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`\u{1F680} Tiffin House running on port ${PORT}`);
  await seedAdmin();
});
