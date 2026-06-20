#!/bin/bash
set -e
if [ $# -lt 2 ]; then
    echo "Usage: $0 <user@host> <deploy-dir> [ssh-port]"
    exit 1
fi
DEST=$1
DEPLOY_DIR=$2
SSH_PORT=${3:-22}
echo "Deploying to $DEST:$DEPLOY_DIR"
if [ ! -f "index.js" ] || [ ! -d "frontend/dist" ]; then
    echo "Building frontend..."
    (cd frontend \&\& npm ci --silent \&\& npm run build)
fi
DEPLOY_TMP=$(mktemp -d)
mkdir -p "$DEPLOY_TMP/poopreminder/frontend/dist"
cp index.js "$DEPLOY_TMP/poopreminder/"
cp -r src/ "$DEPLOY_TMP/poopreminder/src/"
cp package.json "$DEPLOY_TMP/poopreminder/"
cp package-lock.json "$DEPLOY_TMP/poopreminder/"
cp -r frontend/dist/* "$DEPLOY_TMP/poopreminder/frontend/dist/"
printf '%s
' '#!/bin/bash' 'cd "$(dirname "$0")"' 'if [ ! -d "node_modules" ]; then npm ci --silent; fi' 'PORT=${PORT:-3000} npm start' > "$DEPLOY_TMP/poopreminder/start.sh"
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
echo "Package: $ARCHIVE ($(du -sh "$ARCHIVE" | cut -f1))"
echo "Uploading..."
scp -P $SSH_PORT "$ARCHIVE" "$DEST:/tmp/"
echo "Running remote deployment..."
ssh -p $SSH_PORT "$DEST" /bin/bash << 'REMOTEEOF'
set -e
BACKUP_DIR="/opt/poopreminder_backup_$(date +%Y%m%d_%H%M%S)"
if [ -d /opt/poopreminder ]; then
    echo "Backing up..."
    cp -r /opt/poopreminder "$BACKUP_DIR"
    [ -f /opt/poopreminder/poopreminder.db ] \&\& cp /opt/poopreminder/poopreminder.db /tmp/poopreminder.db.bak
fi
echo "Extracting..."
rm -rf /opt/poopreminder
mkdir -p /opt/poopreminder
tar xzf /tmp/poopreminder-deploy-*.tar.gz -C /opt/poopreminder --strip-components=1
[ -f /tmp/poopreminder.db.bak ] \&\& mv /tmp/poopreminder.db.bak /opt/poopreminder/poopreminder.db
echo "Installing deps..."
npm ci --silent 2>/dev/null || npm install --silent
echo "Restarting service..."
sudo cp /opt/poopreminder/poopreminder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart poopreminder
sleep 2
if systemctl is-active --quiet poopreminder; then
    echo "SUCCESS: Service is running"
else
    echo "FAILED. Logs:"
    sudo journalctl -u poopreminder --no-pager -n 15
fi
REMOTEEOF
rm -rf "$DEPLOY_TMP" "$ARCHIVE"
echo "Done"
