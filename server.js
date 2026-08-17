const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic admin auth (HTTP Basic). Change credentials via env ADMIN_USER and ADMIN_PASS
const ADMIN_USER = process.env.ADMIN_USER || 'nava';
const ADMIN_PASS = process.env.ADMIN_PASS || 'navathreads123';
function checkBasicAuth(req){
    const auth = req.headers.authorization;
    if(!auth || !auth.startsWith('Basic ')) return false;
    const b64 = auth.split(' ')[1];
    const pair = Buffer.from(b64, 'base64').toString();
    const sep = pair.indexOf(':');
    if(sep === -1) return false;
    const user = pair.slice(0, sep);
    const pass = pair.slice(sep + 1);
    return user === ADMIN_USER && pass === ADMIN_PASS;
}
function requireAdmin(req, res, next){
    if(checkBasicAuth(req)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
}

// Protect direct access to admin page before static serving
app.use((req, res, next) => {
    if (req.path === '/admin' || req.path === '/admin.html') return requireAdmin(req, res, next);
    next();
});

// Serve static files (HTML, CSS, images) from the root directory
app.use(express.static(path.join(__dirname)));

// Admin route (protected)
app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Health check route
app.get('/health', (req, res) => {
    console.log('Registering /health route');
    res.status(200).json({ status: 'OK', message: 'Server is healthy' });
});

// Root route to serve index.html explicitly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// JSON database file paths
const DB_FILE = path.join(__dirname, 'products.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// Helper function to read products
function getProducts() {
    if (!fs.existsSync(DB_FILE)) {
        return [];
    }
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

// Helper function to save products
function saveProducts(products) {
    fs.writeFileSync(DB_FILE, JSON.stringify(products, null, 2), 'utf8');
}

function getUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        return [];
    }
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// 1. GET all products
app.get('/api/products', (req, res) => {
    const products = getProducts();
    res.json(products);
});

// 2. POST add a new product (with optional image upload handling)
app.post('/api/products/upload', (req, res) => {
    const products = getProducts();
    const images = Array.isArray(req.body.images)
        ? req.body.images
        : req.body.images
            ? String(req.body.images).split(',').map(i => i.trim()).filter(Boolean)
            : [];

    const newProduct = {
        id: Date.now(),
        name: req.body.name,
        category: req.body.category,
        price: Number(req.body.price),
        stockCount: Number(req.body.stockCount),
        images
    };

    products.push(newProduct);
    saveProducts(products);

    res.status(201).json({ message: "Product added successfully!", product: newProduct });
});

app.post('/api/update-stock', (req, res) => {
    const products = getProducts();
    const productId = Number(req.body.id);
    const delta = Number(req.body.quantityChange) || 0;
    const index = products.findIndex(p => p.id === productId);
    if (index === -1) return res.status(404).json({ message: "Product not found." });
    products[index].stockCount = Math.max(0, products[index].stockCount + delta);
    saveProducts(products);
    res.json({ message: "Stock updated.", product: products[index] });
});

app.post('/api/purchase', (req, res) => {
    const { productId, phone, quantity } = req.body;
    const users = getUsers();
    const products = getProducts();
    const user = users.find(u => u.phone === String(phone));
    if (!user) return res.status(404).json({ message: "User not found. Please register first." });
    const index = products.findIndex(p => p.id === Number(productId));
    if (index === -1) return res.status(404).json({ message: "Product not found." });
    const qty = Number(quantity) || 1;
    if (products[index].stockCount < qty) return res.status(400).json({ message: "Not enough stock." });
    products[index].stockCount -= qty;
    saveProducts(products);
    user.purchases = user.purchases || [];
    user.purchases.push({ productId: products[index].id, quantity: qty, date: new Date().toISOString() });
    saveUsers(users);
    res.json({ message: "Purchase complete.", product: products[index], user });
});

app.post('/api/users/register', (req, res) => {
    const users = getUsers();
    const { name, phone, pincode, address } = req.body;
    if (!name || !phone || !pincode || !address) {
        return res.status(400).json({ message: "Name, phone, pincode, and address are required." });
    }
    if (!/^[0-9]{10}$/.test(String(phone))) {
        return res.status(400).json({ message: "Phone number must be exactly 10 digits." });
    }
    if (!/^[0-9]{6}$/.test(String(pincode))) {
        return res.status(400).json({ message: "Pincode must be exactly 6 digits." });
    }
    const existing = users.find(u => u.phone === String(phone));
    if (existing) {
        return res.status(409).json({ message: "Phone number already registered." });
    }
    const newUser = {
        id: Date.now(),
        name: String(name),
        phone: String(phone),
        pincode: String(pincode),
        address: String(address),
        purchases: []
    };
    users.push(newUser);
    saveUsers(users);
    res.status(201).json({ message: "User registered.", user: newUser });
});

app.post('/api/users/login', (req, res) => {
    const users = getUsers();
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ message: "Phone number is required." });
    }
    const user = users.find(u => u.phone === String(phone));
    if (!user) {
        return res.status(404).json({ message: "User not found." });
    }
    res.json({ message: "Login successful.", user });
});

// 3. PUT update an existing product
app.put('/api/products/update', (req, res) => {
    const products = getProducts();
    const productId = Number(req.body.id);
    
    const index = products.findIndex(p => p.id === productId);
    if (index === -1) {
        return res.status(404).json({ message: "Product not found." });
    }

    products[index].name = req.body.name || products[index].name;
    products[index].category = req.body.category || products[index].category;
    products[index].price = req.body.price ? Number(req.body.price) : products[index].price;
    products[index].stockCount = req.body.stockCount ? Number(req.body.stockCount) : products[index].stockCount;

    saveProducts(products);
    res.json({ message: "Product updated successfully!", product: products[index] });
});

// 4. DELETE a product
app.delete('/api/products/:id', (req, res) => {
    let products = getProducts();
    const productId = Number(req.params.id);
    
    const filteredProducts = products.filter(p => p.id !== productId);
    
    if (filteredProducts.length === products.length) {
        return res.status(404).json({ message: "Product not found." });
    }

    saveProducts(filteredProducts);
    res.json({ message: "Product deleted successfully!" });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running live at http://127.0.0.1:${PORT}`);
});