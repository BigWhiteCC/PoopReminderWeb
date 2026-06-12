const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();
const port = 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'poop-reminder-secret-key';

app.use(cors());
app.use(express.json());

function extractDeviceInfo(req) {
    const userAgent = req.headers['user-agent'] || '';
    let deviceType = '未知设备';
    let browser = '未知浏览器';
    let os = '未知系统';
    let model = '';

    if (/Tablet|iPad/i.test(userAgent)) {
        deviceType = '平板';
    } else if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) {
        deviceType = '移动设备';
    } else {
        deviceType = '桌面电脑';
    }

    if (/Chrome/i.test(userAgent) && !/Edg/i.test(userAgent)) {
        browser = 'Chrome';
    } else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) {
        browser = 'Safari';
    } else if (/Firefox/i.test(userAgent)) {
        browser = 'Firefox';
    } else if (/Edg/i.test(userAgent)) {
        browser = 'Edge';
    } else if (/MSIE|Trident/i.test(userAgent)) {
        browser = 'IE';
    }

    if (/Android/i.test(userAgent)) {
        os = 'Android';
    } else if (/iPhone|iPad|iPod/i.test(userAgent)) {
        os = 'iOS';
    } else if (/Windows NT 10/i.test(userAgent)) {
        os = 'Windows 10/11';
    } else if (/Windows/i.test(userAgent)) {
        os = 'Windows';
    } else if (/Mac OS X/i.test(userAgent)) {
        os = 'macOS';
    } else if (/Linux/i.test(userAgent)) {
        os = 'Linux';
    }

    if (/iPhone/i.test(userAgent)) {
        model = 'iPhone';
    } else if (/iPad/i.test(userAgent)) {
        model = 'iPad';
    } else if (/iPod/i.test(userAgent)) {
        model = 'iPod';
    } else if (/Android/i.test(userAgent)) {
        let extracted = '';
        const parenMatch = userAgent.match(/\(([^)]*)\)/g);
        if (parenMatch) {
            for (let i = 0; i < parenMatch.length; i++) {
                const inside = parenMatch[i];
                if (/Android/i.test(inside)) {
                    const parts = inside.replace(/[()]/g, '').split(/;\s*/);
                    for (let j = 0; j < parts.length; j++) {
                        const part = parts[j].trim();
                        if (part && !/^Android/i.test(part) && !/Linux/i.test(part) && !/^wv/i.test(part) && part.length > 2 && part.length < 40) {
                            if (!/^\d[\d._-]*$/.test(part) && !/^[a-z0-9]+$/i.test(part)) {
                                extracted = part;
                                break;
                            }
                        }
                    }
                    break;
                }
            }
        }
        if (extracted) {
            model = extracted;
        } else {
            const brandMatch = userAgent.match(/Pixel\s*\d*[a-z]*/i) || userAgent.match(/SM-[A-Z0-9]+/i) || userAgent.match(/Mi\s+\d+[a-z]*/i) || userAgent.match(/Redmi\s+\w*/i) || userAgent.match(/Huawei\s*\w*/i) || userAgent.match(/Nexus\s+\d*/i) || userAgent.match(/OnePlus\s*\d*[a-z]*/i);
            if (brandMatch) {
                model = brandMatch[0];
            }
        }
    } else if (/Macintosh/i.test(userAgent)) {
        model = 'Mac';
    } else if (/Windows/i.test(userAgent)) {
        model = 'Windows PC';
    }

    return {
        type: deviceType,
        browser: browser,
        os: os,
        model: model,
        ip: (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '').toString(),
        userAgent: userAgent
    };
}

// 模拟数据存储
let users = [];
let records = [];
let reminderTime = { hour: 8, minute: 0 };

// 认证中间件
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// 计算连续打卡天数
function calculateStreak(userId) {
    const userRecords = records.filter(r => r.userId === userId);
    if (userRecords.length === 0) return 0;

    const sortedRecords = userRecords.sort((a, b) => b.date - a.date);
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < sortedRecords.length; i++) {
        const recordDate = new Date(sortedRecords[i].date);
        recordDate.setHours(0, 0, 0, 0);
        const expectedDate = new Date(today);
        expectedDate.setDate(today.getDate() - streak);

        if (recordDate.getTime() === expectedDate.getTime()) {
            streak++;
        } else {
            break;
        }
    }

    return streak;
}

// 获取用户的记录
function getUserRecords(userId) {
    return records.filter(r => r.userId === userId).sort((a, b) => b.date - a.date);
}

// ========== 认证 API 路由 ==========

// 注册
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
    }

    if (users.find(u => u.email === email)) {
        return res.status(400).json({ error: '该邮箱已被注册' });
    }

    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: '该用户名已被使用' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
        id: Date.now(),
        username,
        email,
        password: hashedPassword,
        createdAt: new Date()
    };
    users.push(user);

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
        success: true,
        token,
        user: { id: user.id, username: user.username, email: user.email }
    });
});

// 登录
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: '邮箱和密码不能为空' });
    }

    const user = users.find(u => u.email === email);
    if (!user) {
        return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
        return res.status(401).json({ error: '邮箱或密码错误' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
        success: true,
        token,
        user: { id: user.id, username: user.username, email: user.email }
    });
});

// 获取当前用户信息
app.get('/api/user', authenticateToken, (req, res) => {
    const user = users.find(u => u.id === req.user.userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }
    res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt
    });
});

// ========== 业务 API 路由 ==========

// 首页数据
app.get('/api/home', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    res.json({
        streak: calculateStreak(userId),
        records: getUserRecords(userId).slice(0, 5)
    });
});

// 历史记录
app.get('/api/history', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    res.json({
        records: getUserRecords(userId)
    });
});

// 记录拉屎
app.post('/api/record', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const record = {
        id: Date.now(),
        userId,
        date: new Date(),
        notes: req.body.notes || '',
        device: extractDeviceInfo(req)
    };
    records.push(record);
    res.json({ success: true, record });
});

// 删除记录
app.delete('/api/delete/:id', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const id = parseInt(req.params.id);
    const recordIndex = records.findIndex(r => r.id === id && r.userId === userId);
    if (recordIndex === -1) {
        return res.status(404).json({ error: '记录不存在' });
    }
    records.splice(recordIndex, 1);
    res.json({ success: true });
});

// 获取设置
app.get('/api/settings', authenticateToken, (req, res) => {
    res.json(reminderTime);
});

// 保存设置
app.post('/api/settings', authenticateToken, (req, res) => {
    reminderTime = {
        hour: parseInt(req.body.hour),
        minute: parseInt(req.body.minute)
    };
    res.json({ success: true, reminderTime });
});

app.listen(port, () => {
    console.log(`💩 Poop Reminder API listening at http://localhost:${port}`);
    console.log(`📱 Vue Frontend running at http://localhost:5173`);
});