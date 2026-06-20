'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// -------- 加载配置与初始化 --------
const { IS_DEV } = require('./src/config');
const { initializeDatabase, seedDevData, closeDb } = require('./src/database');
const { securityHeaders, setupRateLimiters } = require('./src/middleware');

initializeDatabase();
if (IS_DEV) seedDevData();

const app = express();
const port = process.env.PORT || 3000;

// -------- 安全与解析 --------
securityHeaders(app);
if (IS_DEV) app.use(cors());
app.use(express.json({ limit: '100kb' }));
const { authLimiter, generalLimiter } = setupRateLimiters();
app.use(generalLimiter);

// -------- 健康检查（公开） --------
app.get('/health', (req, res) => {
    try {
        const { getDb } = require('./src/database');
        getDb().prepare('SELECT 1').get();
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            db: 'connected'
        });
    } catch (err) {
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            db: 'disconnected'
        });
    }
});

// -------- 路由注册 --------
app.use('/api', require('./src/routes/auth'));
app.use('/api/record', require('./src/routes/records'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/admin', require('./src/routes/admin'));

// -------- 静态资源与 SPA fallback --------
const DIST_DIR = path.join(__dirname, 'frontend/dist');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');

const ASSET_MIME = {
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.json': 'application/json; charset=utf-8'
};

app.use('/assets', (req, res) => {
    const relPath = req.path.substring(1);
    const filePath = path.join(ASSETS_DIR, relPath);
    const ext = path.extname(filePath).toLowerCase();
    fs.stat(filePath, (err, stat) => {
        if (err || !stat || !stat.isFile()) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(404).send('Not found: ' + req.originalUrl);
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (ASSET_MIME[ext]) res.setHeader('Content-Type', ASSET_MIME[ext]);
        res.sendFile(filePath);
    });
});

app.use(express.static(DIST_DIR, {
    setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
        }
    }
}));

app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();
    const ext = path.extname(req.path).toLowerCase();
    if (ext !== '' && ext !== '.html') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(404).send('Not found: ' + req.path);
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// -------- 优雅关闭 --------
function gracefulShutdown(signal) {
    console.log(`\n[${signal}] 收到信号，正在关闭...`);
    try {
        closeDb();
        console.log('[Shutdown] 数据库已关闭');
        process.exit(0);
    } catch (e) {
        console.error('[Shutdown] 关闭失败:', e.message);
        process.exit(1);
    }
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// -------- 启动 --------
try {
    app.listen(port, () => {
        console.log(`💩 Poop Reminder API listening at http://localhost:${port}`);
        console.log(`📱 Vue Frontend running at http://localhost:${port}`);
        console.log(`🗄️  SQLite database: poopreminder.db`);
    }).on('error', (err) => {
        console.error('❌ Failed to start server:', err.message);
        process.exit(1);
    });
} catch (err) {
    console.error('❌ Failed to start server (sync):', err.message);
    process.exit(1);
}
