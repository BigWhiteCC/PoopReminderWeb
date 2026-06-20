#!/bin/bash
# PoopReminder Web 部署脚本
# 用法: ./deploy.sh <user@server> [部署目录]

set -e

REMOTE_HOST="$1"
DEPLOY_DIR="${2:-/opt/poopreminder}"

if [ -z "$REMOTE_HOST" ]; then
    echo "❌ 用法: ./deploy.sh <user@server> [部署目录]"
    echo "示例: ./deploy.sh root@192.168.1.100 /opt/poopreminder"
    exit 1
fi

echo "🚀 开始部署到 $REMOTE_HOST:$DEPLOY_DIR"
echo ""

# 构建前端
echo "📦 构建前端..."
cd frontend
npm ci --silent
npm run build
cd ..
echo "✅ 前端构建完成"

# 准备部署包
echo "📁 准备部署包..."
DEPLOY_TMP=$(mktemp -d)
mkdir -p "$DEPLOY_TMP/poopreminder/frontend/dist"

cp index.js "$DEPLOY_TMP/poopreminder/"
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
export NODE_ENV=production
export PORT=${PORT:-3000}
exec node index.js
EOF
chmod +x "$DEPLOY_TMP/poopreminder/start.sh"

# 创建 systemd service 文件
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

# 创建 README
cat > "$DEPLOY_TMP/poopreminder/README_DEPLOY.txt" << 'EOF'
========== PoopReminder 部署说明 ==========

项目已部署到此目录。

⚠️  首次部署必读：
1) 请编辑 poopreminder.service 中的 JWT_SECRET，替换为安全的随机字符串：
     openssl rand -hex 48
   然后复制 service 文件：
     sudo cp poopreminder.service /etc/systemd/system/
     sudo systemctl daemon-reload

2) 如果直接用 npm start 运行，需在启动前设置环境变量：
     export NODE_ENV=production
     export JWT_SECRET=你的随机密钥

3) 生产环境下 NODE_ENV=production 时不会自动创建测试账号。

启动方式：
  1) 首次运行需要安装依赖: npm ci
  2) 启动应用: npm start
     默认监听端口: 3000

使用 systemd 管理（推荐）：
  sudo cp poopreminder.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable poopreminder
  sudo systemctl start poopreminder

查看日志:
  sudo journalctl -u poopreminder -f

直接运行：
  NODE_ENV=production JWT_SECRET=你的随机密钥 PORT=3000 node index.js

文件说明：
  index.js           - 后端主程序
  package.json       - 依赖配置
  frontend/dist/     - 前端构建产物
  poopreminder.db    - SQLite 数据库（首次运行自动创建）
EOF

cd "$DEPLOY_TMP"
tar czf "$OLDPWD/poopreminder-deploy.tar.gz" poopreminder
cd "$OLDPWD"
rm -rf "$DEPLOY_TMP"

echo "✅ 部署包已生成: poopreminder-deploy.tar.gz"
echo ""

# 上传到服务器
echo "📤 上传到服务器 $REMOTE_HOST:$DEPLOY_DIR ..."
scp poopreminder-deploy.tar.gz "$REMOTE_HOST:/tmp/"

# 在服务器上解压和安装
echo "🔧 在服务器上部署..."
ssh "$REMOTE_HOST" bash << 'REMOTE_SCRIPT'
    set -e
    DEPLOY_DIR="${DEPLOY_DIR:-/opt/poopreminder}"

    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        echo "❌ 服务器未安装 Node.js"
        echo "请先安装 Node.js (>= 18):"
        echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
        echo "  apt-get install -y nodejs"
        exit 1
    fi
    echo "✅ Node.js 版本: $(node --version)"

    # 备份旧版本（如果存在）
    if [ -d "$DEPLOY_DIR" ]; then
        BACKUP_DIR="${DEPLOY_DIR}_backup_$(date +%Y%m%d_%H%M%S)"
        echo "💾 备份旧版本到 $BACKUP_DIR"
        sudo mv "$DEPLOY_DIR" "$BACKUP_DIR"
        # 保留数据库
        if [ -f "$BACKUP_DIR/poopreminder.db" ]; then
            echo "✅ 保留数据库文件"
        fi
    fi

    # 创建部署目录
    sudo mkdir -p "$DEPLOY_DIR"
    sudo chown $(whoami):$(whoami) "$DEPLOY_DIR"

    # 解压
    cd "$DEPLOY_DIR"
    tar xzf /tmp/poopreminder-deploy.tar.gz --strip-components=1

    # 恢复数据库（如果有备份）
    if [ -f "${BACKUP_DIR:-}/poopreminder.db" ]; then
        cp "${BACKUP_DIR}/poopreminder.db" "$DEPLOY_DIR/poopreminder.db"
        echo "✅ 数据库已恢复"
    fi

    # 安装依赖
    echo "📦 安装后端依赖..."
    npm ci --silent

    # 设置权限
    chmod +x start.sh

    # 重启服务
    echo "🔄 重启应用..."
    sudo cp -f "$DEPLOY_DIR/poopreminder.service" /etc/systemd/system/ 2>/dev/null || true
    sudo systemctl daemon-reload
    sudo systemctl restart poopreminder
    sleep 2
    if sudo systemctl is-active --quiet poopreminder; then
        echo "✅ 服务已启动"
        sudo systemctl status poopreminder --no-pager | head -5
    else
        echo "❌ 服务启动失败，查看日志:"
        sudo journalctl -u poopreminder -n 10 --no-pager
    fi
REMOTE_SCRIPT

# 清理临时文件
rm -f poopreminder-deploy.tar.gz

echo ""
echo "🎉 部署完成！"
