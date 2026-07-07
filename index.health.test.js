const request = require('supertest');
const express = require('express');
const Database = require('better-sqlite3');

describe('健康检查端点', () => {
    let app;
    let testDb;

    beforeEach(() => {
        app = express();
        testDb = new Database(':memory:');
        testDb.exec('CREATE TABLE IF NOT EXISTS health_check (id INTEGER PRIMARY KEY)');
    });

    afterEach(() => {
        testDb.close();
    });

    test('健康检查成功应返回 200', async () => {
        let db = testDb;
        app.get('/health', (req, res) => {
            try {
                db.prepare('SELECT 1').get();
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

        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.db).toBe('connected');
        expect(res.body.timestamp).toBeDefined();
        expect(res.body.uptime).toBeDefined();
    });

    test('数据库断开应返回 503', async () => {
        let db = null;
        app.get('/health', (req, res) => {
            try {
                db.prepare('SELECT 1').get();
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

        const res = await request(app).get('/health');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('error');
        expect(res.body.db).toBe('disconnected');
    });

    test('健康检查应包含时间戳和运行时间', async () => {
        let db = testDb;
        app.get('/health', (req, res) => {
            try {
                db.prepare('SELECT 1').get();
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

        const res = await request(app).get('/health');
        expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(typeof res.body.uptime).toBe('number');
        expect(res.body.uptime).toBeGreaterThan(0);
    });
});