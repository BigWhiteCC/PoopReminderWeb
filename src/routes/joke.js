const express = require('express');
const router = express.Router();

// 后端笑话代理：聚合多个免费中文笑话 API，服务端请求无 CORS 限制
const JOKE_SOURCES = [
  // 1. apiopen 随机笑话
  async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const res = await fetch('https://api.apiopen.top/api/getJoke?size=1&type=text', {
        signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!res.ok) throw new Error('apiopen http ' + res.status);
      const json = await res.json();
      const text = json?.result?.[0]?.text || json?.result?.[0]?.content;
      if (!text || typeof text !== 'string') throw new Error('apiopen empty');
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
  // 5. 段子网随机抓取
  async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const page = Math.floor(Math.random() * 164) + 1;
      const res = await fetch('https://duanziwang.com/page/' + page + '/', {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (!res.ok) throw new Error('duanziwang http ' + res.status);
      const html = await res.text();
      const matches = html.match(/<article[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
      if (!matches || !matches[1]) throw new Error('duanziwang no match');
      const text = matches[1].replace(/<[^>]+>/g, '').trim();
      if (!text || text.length < 10) throw new Error('duanziwang too short');
      return text;
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
