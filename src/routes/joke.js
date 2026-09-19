const express = require('express');
const router = express.Router();

// 后端笑话代理：聚合多个免费中文笑话 API，服务端请求无 CORS 限制
const JOKE_SOURCES = [
  // 1. xygeng 一言/语录（服务器可达，返回 JSON）
  async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const res = await fetch('https://api.xygeng.cn/one', {
        signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!res.ok) throw new Error('xygeng http ' + res.status);
      const json = await res.json();
      const text = json?.data?.content;
      if (!text || typeof text !== 'string') throw new Error('xygeng empty');
      return text.trim().replace(/<[^>]+>/g, '');
    } finally { clearTimeout(timer); }
  },
  // 2. 小歪 API
  async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const res = await fetch('https://api.ixiaowai.cn/twts.php', {
        signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!res.ok) throw new Error('ixiaowai http ' + res.status);
      const text = await res.text();
      const clean = (text || '').replace(/<[^>]+>/g, '').trim();
      if (!clean || clean.length < 4) throw new Error('ixiaowai empty');
      return clean;
    } finally { clearTimeout(timer); }
  },
  // 3. 韩小韩土味笑话
  async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const res = await fetch('https://api.vvhan.com/api/text/joke?type=text', {
        signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!res.ok) throw new Error('vvhan http ' + res.status);
      const text = await res.text();
      const clean = (text || '').replace(/<[^>]+>/g, '').trim();
      if (!clean || clean.length < 4) throw new Error('vvhan empty');
      return clean;
    } finally { clearTimeout(timer); }
  },
  // 4. 一言 Hitokoto（稳定兜底）
  async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const res = await fetch('https://v1.hitokoto.cn/?c=a&c=d&c=i&c=k&encode=text', {
        signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!res.ok) throw new Error('hitokoto http ' + res.status);
      const text = await res.text();
      const clean = (text || '').trim();
      if (!clean || clean.length < 4) throw new Error('hitokoto empty');
      return clean;
    } finally { clearTimeout(timer); }
  },
  // 5. 一言 Hitokoto 小说类（另一分类参数，增加多样性）
  async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const cats = ['b', 'h', 'i', 'k'];
      const c = cats[Math.floor(Math.random() * cats.length)];
      const res = await fetch('https://v1.hitokoto.cn/?c=' + c + '&encode=text', {
        signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!res.ok) throw new Error('hitokoto2 http ' + res.status);
      const text = await res.text();
      const clean = (text || '').trim();
      if (!clean || clean.length < 4) throw new Error('hitokoto2 empty');
      return clean;
    } finally { clearTimeout(timer); }
  }
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

router.get('/', async (req, res) => {
  const sources = shuffle(JOKE_SOURCES);
  const errors = [];
  for (const fn of sources) {
    try {
      const text = await fn();
      if (text && text.length >= 4 && text.length <= 500) {
        return res.json({ ok: true, joke: text, source: 'remote' });
      }
    } catch (err) {
      errors.push(err.message);
    }
  }
  return res.json({ ok: false, joke: null, source: 'local', errors });
});

module.exports = router;
