#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== pr-reviewer deploy ==="

# 1. Check prerequisites
if ! command -v node &>/dev/null; then
  echo "Error: node is not installed"
  exit 1
fi

if ! command -v pm2 &>/dev/null; then
  echo "Error: pm2 is not installed. Install with: npm install -g pm2"
  exit 1
fi

if ! command -v cloudflared &>/dev/null; then
  echo "Warning: cloudflared is not installed. Tunnel manager will fail."
  echo "  Install with: brew install cloudflare/cloudflare/cloudflared"
fi

if [ ! -f .env ]; then
  echo "Error: .env file not found. Copy .env.example and fill in values:"
  echo "  cp .env.example .env"
  exit 1
fi

# 2. Install dependencies
echo ""
echo "→ Installing dependencies..."
npm install --production=false

# 3. Build TypeScript
echo ""
echo "→ Building TypeScript..."
npm run build

# 4. Create logs directory
mkdir -p logs

# 5. Start or restart PM2 processes
echo ""
echo "→ Starting PM2 processes..."
if pm2 describe pr-reviewer &>/dev/null; then
  echo "  Processes already running, restarting..."
  pm2 restart pm2.config.js
else
  pm2 start pm2.config.js
fi

# 6. Save PM2 process list (for auto-restart after reboot)
echo ""
echo "→ Saving PM2 process list..."
pm2 save

# 7. Set up PM2 startup on boot
echo ""
echo "→ Setting up auto-start on reboot..."
echo "  Run the following command if you haven't already:"
echo ""
echo "    pm2 startup"
echo ""
echo "  Then copy and run the command it outputs (requires sudo)."

# 8. Verify
echo ""
echo "=== Deploy complete ==="
echo ""
echo "Check status:"
echo "  pm2 status"
echo ""
echo "View logs:"
echo "  pm2 logs pr-reviewer"
echo "  pm2 logs pr-reviewer-tunnel"
echo ""
echo "Find the tunnel URL in the tunnel logs:"
echo "  pm2 logs pr-reviewer-tunnel --lines 50 | grep trycloudflare.com"
echo ""
echo "Once the tunnel is up, verify the health check:"
echo "  curl https://<tunnel-url>/health"
