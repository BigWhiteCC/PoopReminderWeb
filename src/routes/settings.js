'use strict';

const express = require('express');
const { getDb } = require('../database');
const { authenticateToken, handleError } = require('../middleware');

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
    const db = getDb();
    try {
        const row = db.prepare('SELECT reminder_hour, reminder_minute FROM user_settings WHERE user_id = ?').get(req.user.userId);
        res.json({
            hour: row ? row.reminder_hour : 8,
            minute: row ? row.reminder_minute : 0
        });
    } catch (err) {
        const e = handleError(err, 'getSettings');
        res.status(e.status).json({ error: e.message });
    }
});

router.post('/', authenticateToken, (req, res) => {
    const db = getDb();
    const hour = parseInt(req.body.hour);
    const minute = parseInt(req.body.minute);

    if (isNaN(hour) || hour < 0 || hour > 23) {
        return res.status(400).json({ error: '小时必须是 0-23 之间的整数' });
    }
    if (isNaN(minute) || minute < 0 || minute > 59) {
        return res.status(400).json({ error: '分钟必须是 0-59 之间的整数' });
    }

    try {
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO user_settings (user_id, reminder_hour, reminder_minute, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                reminder_hour = excluded.reminder_hour,
                reminder_minute = excluded.reminder_minute,
                updated_at = excluded.updated_at
        `).run(req.user.userId, hour, minute, now);
        res.json({ success: true, reminderTime: { hour, minute } });
    } catch (err) {
        const e = handleError(err, 'saveSettings');
        res.status(e.status).json({ error: e.message });
    }
});

module.exports = router;
