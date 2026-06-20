'use strict';

require('dotenv').config();

// -------- 安全配置（必须从环境变量读取，否则启动失败） --------
if (!process.env.JWT_SECRET || !process.env.JWT_SECRET.trim()) {
    console.error('[FATAL] 环境变量 JWT_SECRET 未设置。生产环境必须配置安全的签名密钥！');
    console.error('生成命令: openssl rand -hex 48');
    process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET.trim();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// 环境判断：必须显式设置 NODE_ENV=production 才视为生产环境
const IS_PROD = process.env.NODE_ENV === 'production';
const IS_DEV = !IS_PROD;

console.log(`[Config] NODE_ENV=${process.env.NODE_ENV || '(未设置, 使用开发模式)'} JWT_EXPIRES_IN=${JWT_EXPIRES_IN}`);

// -------- 布里斯托大便类型常量 --------
const POOP_TYPES = [
    { id: 1, name: '第1型', emoji: '🫘', description: '一颗颗硬球（很难排出）', category: '便秘' },
    { id: 2, name: '第2型', emoji: '🌰', description: '表面凹凸的香肠状', category: '轻微便秘' },
    { id: 3, name: '第3型', emoji: '🌭', description: '表面有裂痕的香肠状', category: '正常' },
    { id: 4, name: '第4型', emoji: '🍌', description: '表面光滑柔软的香肠状', category: '理想' },
    { id: 5, name: '第5型', emoji: '🟢', description: '断边光滑的柔软块状', category: '缺乏纤维' },
    { id: 6, name: '第6型', emoji: '🍦', description: '粗边蓬松的糊状，不成形', category: '轻度腹泻' },
    { id: 7, name: '第7型', emoji: '💧', description: '水状，无固体成分', category: '腹泻' }
];

module.exports = {
    JWT_SECRET,
    JWT_EXPIRES_IN,
    IS_PROD,
    IS_DEV,
    POOP_TYPES
};
