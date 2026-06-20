#!/bin/bash
set -e
DEST="$1"
DEPLOY_DIR="$2"
SSH_PORT="${3:-22}"
echo "Deploying to $DEST:$DEPLOY_DIR"

if [ ! -f "index.js" ] || [ ! -d "frontend/dist" ]; then
    echo "Building frontend..."
    (cd frontend && npm ci --silent && npm run build)
fi

DEPLOY_TMP=$(mktemp -d)
mkdir -p "$DEPLOY_TMP/poopreminder/frontend/dist"
cp index.js "$DEPLOY_TMP/poopreminder/"
cp -r src/ "$DEPLOY_TMP/poopreminder/src/"
cp package.json "$DEPLOY_TMP/poopreminder/"
cp package-lock.json "$DEPLOY_TMP/poopreminder/"
cp -r frontend/dist/* "$DEPLOY_TMP/poopreminder/frontend/dist/"

cat > "$DEPLOY_TMP/poopreminder/start.sh" << 'SHEOF'
#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then npm ci --silent; fi
PORT=${PORT:-3000} npm start
SHEOF
chmod +x "$DEPLOY_TMP/poopreminder/start.sh"

cat > "$DEPLOY_TMP/poopreminder/poopreminder.service" << 'SVCEOF'
[Unit]
Description=PoopReminder Web Application
After=network.target
[Service]
Type=simple
WorkingDirectory=/opt/poopreminder
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=JWT_SECRET=please_replace_this_with_a_secure_random_string
ExecStart=/usr/bin/node /opt/poopreminder/index.js
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
SVCEOF

ARCHIVE="/tmp/poopreminder-deploy-$(date +%Y%m%d_%H%M%S).tar.gz"
tar czf "$ARCHIVE" -C "$DEPLOY_TMP" poopreminder
echo "Package: $ARCHIVE"
scp -P "$SSH_PORT" "$ARCHIVE" "$DEST:/tmp/"

ssh -p "$SSH_PORT" "$DEST" /bin/bash -s << 'REMOTEEOF'
set -e
BACKUP_DIR="/opt/poopreminder_backup_$(date +%Y%m%d_%H%M%S)"
if [ -d /opt/poopreminder ]; then
    cp -r /opt/poopreminder "$BACKUP_DIR"
    DB="/opt/poopreminder/poopreminder.db"
    if [ -f "$DB" ]; then
        cp "$DB" /tmp/poopreminder.db.bak
    fi
fi
rm -rf /opt/poopreminder
mkdir -p /opt/poopreminder
ARCHIVE=$(ls -t /tmp/poopreminder-deploy-*.tar.gz 2>/dev/null | head -1) && tar xzf "$ARCHIVE" -C /opt/poopreminder --strip-components=1
if [ -f /tmp/poopreminder.db.bak ]; then
    mv /tmp/poopreminder.db.bak /opt/poopreminder/poopreminder.db
fi
npm ci --silent 2>/dev/null || npm install --silent
sudo cp /opt/poopreminder/poopreminder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart poopreminder
sleep 2
if systemctl is-active --quiet poopreminder; then
    echo "SUCCESS: Service running"
else
    echo "FAILED"
    sudo journalctl -u poopreminder --no-pager -n 15
fi
REMOTEEOF
rm -rf "$DEPLOY_TMP" "$ARCHIVE"
echo "Done"
