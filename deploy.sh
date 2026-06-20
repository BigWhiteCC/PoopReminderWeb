#!/bin/bash
set -e

if [ $# -lt 2 ]; then
    echo "用法: $0 <user@host> <部署目录> [SSH端口]"
    exit 1
fi

DEST=$1
DEPLOY_DIR=$2
SSH_PORT=${3:-22}

echo "🚀 开始部署到 $DEST:$DEPLOY_DIR"

# 检查本地文件
if [ ! -f "index.js" ] || [ ! -d "frontend/dist" ]; then
    echo "📦 构建前端..."
    cd frontend && npm ci --silent && npm run build && cd ..
fi

echo "📁 准备部署包..."
DEPLOY_TMP=$(mktemp -d)
mkdir -p "$DEPLOY_TMP/poopreminder/frontend/dist"

cp index.js "$DEPLOY_TMP/poopreminder/"
cp -r src/ "$DEPLOY_TMP/poopreminder/src/"
cp package.json "$DEPLOY_TMP/poopreminder/"
cp package-lock.json "$DEPLOY_TMP/poopreminder/"
cp -r frontend/dist/* "$DEPLOY_TMP/poopreminder/frontend/dist/"

# 创建启动脚本
cat > "$DEPLOY_TMP/poopreminder/start.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
    echo "📦 首次启动，安装依赖..."
    npm ci --silent
fi
PORT=${PORT:-3000} npm start
EOF
chmod +x "$DEPLOY_TMP/poopreminder/start.sh"

# 创建 systemd 服务文件
cat > "$DEPLOY_TMP/poopreminder/poopreminder.service" << 'EOF'
[Unit]
Description=PoopReminder Web Application
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/poopreminder
Environment=NODE_ENV=production
Environment=PORT=3000
# JWT 签名密钥（必须配置，生产环境请替换为随机长字符串）
# 生成命令: openssl rand -hex 48
Environment=JWT_SECRET=please_replace_this_with_a_secure_random_string
ExecStart=/usr/bin/node /opt/poopreminder/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 创建 tar 包
ARCHIVE="/tmp/poopreminder-deploy-$(date +%Y%m%d_%H%M%S).tar.gz"
tar czf "$ARCHIVE" -C "$DEPLOY_TMP" poopreminder
echo "📦 部署包: $ARCHIVE ($(du -sh "$ARCHIVE" | cut -f1))"

# 上传到服务器
echo "📤 上传到服务器..."
scp -P $SSH_PORT "$ARCHIVE" "$DEST:/tmp/"

# 远程部署
echo "🖥️  执行远程部署..."
ssh -p $SSH_PORT "$DEST" bash << 'REMOTE'
    BACKUP_DIR="/opt/poopreminder_backup_$(date +%Y%m%d_%H%M%S)"
    if [ -d /opt/poopreminder ]; then
        echo "📦 备份旧部署到 $BACKUP_DIR..."
        cp -r /opt/poopreminder "$BACKUP_DIR"
        # 保留数据库
        if [ -f /opt/poopreminder/poopreminder.db ]; then
            cp /opt/poopreminder/poopreminder.db /tmp/poopreminder.db.bak
        fi
    fi

    echo "📂 解压新部署..."
    rm -rf /opt/poopreminder
    mkdir -p /opt/poopreminder
    tar xzf /tmp/poopreminder-deploy-*.tar.gz -C /opt/poopreminder

    # 恢复数据库
    if [ -f /tmp/poopreminder.db.bak ]; then
        mv /tmp/poopreminder.db.bak /opt/poopreminder/poopreminder.db
        echo "✅ 数据库已恢复"
    fi

    echo "📦 安装依赖..."
    npm ci --silent 2>/dev/null || npm install --silent

    echo "🔄 重启服务..."
    sudo cp /opt/poopreminder/poopreminder.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl restart poopreminder

    sleep 2
    if systemctl is-active --quiet poopreminder; then
        echo "✅ 部署成功！服务已启动"
    else
        echo "❌ 服务启动失败，查看日志:"
        sudo journalctl -u poopreminder --no-pager -n 20
    fi
REMOTE

# 清理
rm -rf "$DEPLOY_TMP"
rm -f "$ARCHIVE"
echo "🏁 部署完成"
