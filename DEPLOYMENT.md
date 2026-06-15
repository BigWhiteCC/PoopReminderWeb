# PoopReminderWeb 部署指南

## 项目概述
这是一个前后端一体化部署的 Web 应用，Express 后端同时提供 API 和静态文件服务。

## 部署步骤

### 1. 服务器准备

确保服务器已安装：
- Node.js ≥ 18.0.0
- Git

### 2. 克隆项目

```bash
git clone https://github.com/BigWhiteCC/PoopReminderWeb.git
cd PoopReminderWeb
```

### 3. 安装依赖

```bash
npm install
cd frontend && npm install && npm run build && cd ..
```

### 4. 设置环境变量（可选）

创建 `.env` 文件：

```bash
touch .env
```

编辑 `.env` 文件：

```env
PORT=3000
JWT_SECRET=your-secret-key-here-make-it-long-and-secure
```

### 5. 启动服务

#### 开发模式（不推荐生产环境）：
```bash
node index.js
```

#### 生产环境（推荐使用 PM2）：

安装 PM2：
```bash
npm install -g pm2
```

启动服务：
```bash
pm2 start index.js --name poop-reminder
```

查看状态：
```bash
pm2 status
pm2 logs poop-reminder
```

设置开机自启：
```bash
pm2 startup
pm2 save
```

### 6. 配置反向代理（Nginx）

创建 Nginx 配置文件：

```bash
sudo nano /etc/nginx/sites-available/poop-reminder
```

配置内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/poop-reminder /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 7. 配置 HTTPS（使用 Certbot）

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 项目结构

```
PoopReminderWeb/
├── index.js          # Express 后端入口
├── package.json      # 后端依赖
├── .env             # 环境变量（可选）
├── frontend/        # Vue 前端项目
│   ├── dist/        # 构建产物（npm run build 生成）
│   └── ...          # 其他前端文件
└── DEPLOYMENT.md    # 本部署指南
```

## 访问应用

部署完成后，访问 `http://your-domain.com` 或 `http://server-ip:3000` 即可使用应用。

## 注意事项

1. **安全**：生产环境务必设置强 JWT_SECRET
2. **端口**：确保防火墙开放 3000 端口或使用 Nginx 反向代理
3. **备份**：定期备份数据（当前为内存存储，重启后数据会丢失）
4. **日志**：使用 PM2 管理进程时，定期清理日志文件
