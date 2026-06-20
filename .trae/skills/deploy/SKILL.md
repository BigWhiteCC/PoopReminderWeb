---
name: "deploy"
description: "Deploy PoopReminderWeb to remote server. Invoke when user wants to deploy, release, or publish the application to a server."
---

# Deploy PoopReminderWeb

Deploy this Node.js + Vue project to a remote server via SSH/SCP.

## Prerequisites

- Server must have Node.js >= 18.0.0 installed
- SSH key-based authentication preferred (password auth uses expect scripts)
- `deploy.sh` script in project root handles the full deployment flow

## Server Info

| Alias | Host | User | Key |
|-------|------|------|-----|
| poop-prod | 39.97.255.11 | root | ~/.ssh/id_ed25519 |

SSH config 已配置在 `~/.ssh/config`，可直接使用别名连接。

## Usage

### Quick deployment (recommended)

```bash
./deploy.sh poop-prod /opt/poopreminder
```

### Basic deployment

```bash
./deploy.sh <user@server> [部署目录]
```

### What the deployment does

1. **Build frontend**: Runs `npm ci && npm run build` in `frontend/` directory
2. **Create deployment package**: Bundles `index.js`, `package.json`, `frontend/dist/`, `start.sh`, and systemd service file
3. **Upload via SCP**: Copies `poopreminder-deploy.tar.gz` to server `/tmp/`
4. **Remote setup via SSH**:
   - Checks Node.js version
   - Backs up existing deployment (keeps database)
   - Extracts files to target directory
   - Runs `npm ci` to install dependencies
   - Sets executable permissions

## Post-Deployment

After deployment, on the server run:

```bash
# Option 1: Direct start
cd /opt/poopreminder && npm start

# Option 2: systemd (recommended for production)
sudo cp /opt/poopreminder/poopreminder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable poopreminder
sudo systemctl start poopreminder
```

## Troubleshooting

- **SSH connection failed**: Check SSH key permissions (`chmod 600 ~/.ssh/id_rsa`) or verify server fingerprint
- **Node.js not found**: Server needs Node.js >= 18, install via: `curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs`
- **Port 3000 in use**: Set `PORT=3001` in environment or check for conflicting processes

## Related Files

- `deploy.sh` - Main deployment script
- `DEPLOYMENT.md` - Detailed deployment documentation
- `frontend/vite.config.js` - Frontend build configuration
