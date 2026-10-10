#!/usr/bin/env bash
set -e

echo "======================================================"
echo "  🚀 Setting up & Starting SentinelX Risk Engine"
echo "======================================================"

# 1. Check for Bun
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed."
    echo "👉 Please install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi
echo "✓ Bun runtime detected ($(bun --version))"

# 2. Setup environment variables
if [ ! -f "apps/dashboard/.env" ]; then
    echo "⚙️ Creating apps/dashboard/.env from .env.example..."
    cp apps/dashboard/.env.example apps/dashboard/.env
else
    echo "✓ apps/dashboard/.env already exists"
fi

# 3. Install dependencies
echo "📦 Installing workspace dependencies..."
bun install

# 4. Build workspace packages
echo "🔨 Building monorepo packages..."
bun run build

# 5. Start API & Dashboard
echo "======================================================"
echo "  🟢 Starting SentinelX Services:"
echo "     - Risk API:  http://localhost:3000"
echo "     - Dashboard: http://localhost:5173"
echo "======================================================"
echo "Press Ctrl+C to stop all services."

# Trap SIGINT/SIGTERM to kill background children cleanly
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT SIGINT SIGTERM

bun run dev
