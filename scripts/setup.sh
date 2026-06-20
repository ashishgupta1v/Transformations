#!/bin/bash
# scripts/setup.sh
# Complete Oracle Cloud VM setup for Jagannatha Pipeline
# Run: bash scripts/setup.sh

set -e
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  🛸 JAGANNATHA PIPELINE — ORACLE CLOUD SETUP ║"
echo "║  Digital Builders — ashishgupta.dev          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── DETECT OS ──────────────────────────────────────
if [ -f /etc/oracle-release ]; then
  OS="oracle"
  PKG="dnf"
elif [ -f /etc/debian_version ]; then
  OS="ubuntu"
  PKG="apt-get"
else
  echo "⚠️  Unknown OS — defaulting to apt-get"
  OS="ubuntu"
  PKG="apt-get"
fi
echo "✅ Detected OS: $OS"

# ── SYSTEM UPDATE ──────────────────────────────────
echo ""
echo "📦 Updating system packages..."
sudo $PKG update -y
sudo $PKG upgrade -y

# ── INSTALL CORE DEPENDENCIES ──────────────────────
echo ""
echo "🔧 Installing core dependencies..."

if [ "$OS" = "oracle" ]; then
  sudo dnf install -y git curl wget unzip tar \
    gcc gcc-c++ make python3 python3-pip \
    openssl openssl-devel

  # FFmpeg from RPM Fusion
  sudo dnf install -y epel-release
  sudo dnf config-manager --set-enabled ol8_codeready_builder
  sudo dnf install -y ffmpeg ffmpeg-devel
else
  sudo apt-get install -y git curl wget unzip tar \
    build-essential python3 python3-pip \
    openssl libssl-dev ffmpeg
fi

echo "✅ Core dependencies installed"
ffmpeg -version | head -1

# ── NODE.JS 20 ─────────────────────────────────────
echo ""
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null || \
  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo $PKG install -y nodejs
echo "✅ Node.js $(node --version) installed"

# ── DOCKER ─────────────────────────────────────────
echo ""
echo "🐳 Installing Docker..."
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo systemctl start docker
sudo systemctl enable docker
echo "✅ Docker $(docker --version) installed"

# ── DOCKER COMPOSE ─────────────────────────────────
echo ""
echo "🐳 Installing Docker Compose..."
sudo curl -L \
  "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
echo "✅ Docker Compose installed"

# ── PROJECT DIRECTORIES ────────────────────────────
echo ""
echo "📁 Creating project directories..."
mkdir -p /home/$USER/jagannatha-pipeline
mkdir -p /home/$USER/jagannatha-pipeline/temp
mkdir -p /home/$USER/jagannatha-pipeline/output
mkdir -p /home/$USER/jagannatha-pipeline/logs
mkdir -p /home/$USER/jagannatha-pipeline/assets

# Set permissions
chmod -R 755 /home/$USER/jagannatha-pipeline
echo "✅ Directories created"

# ── PYTHON PACKAGES ────────────────────────────────
echo ""
echo "🐍 Installing Python packages..."
pip3 install --upgrade pip
pip3 install \
  requests \
  moviepy \
  opencv-python-headless \
  Pillow \
  numpy \
  boto3 \
  oci \
  google-api-python-client \
  google-auth-httplib2 \
  google-auth-oauthlib \
  pydub \
  librosa \
  soundfile
echo "✅ Python packages installed"

# ── NODE PACKAGES ──────────────────────────────────
echo ""
echo "📦 Installing Node packages..."
cd /home/$USER/jagannatha-pipeline
npm install
echo "✅ Node packages installed"

# ── n8n DOCKER SETUP ───────────────────────────────
echo ""
echo "⚙️  Setting up n8n with Docker..."
cat > /home/$USER/jagannatha-pipeline/docker-compose.yml << 'DOCKEREOF'
version: '3.8'
services:
  n8n:
    image: n8nio/n8n:latest
    restart: always
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_BASIC_AUTH_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_BASIC_AUTH_PASSWORD}
      - N8N_HOST=${N8N_HOST}
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - WEBHOOK_URL=${N8N_WEBHOOK_URL}
      - GENERIC_TIMEZONE=Asia/Kolkata
      - TZ=Asia/Kolkata
      - N8N_LOG_LEVEL=info
    volumes:
      - n8n_data:/home/node/.n8n
      - /home/opc/jagannatha-pipeline:/workspace
    env_file:
      - .env

  redis:
    image: redis:alpine
    restart: always
    volumes:
      - redis_data:/data

volumes:
  n8n_data:
  redis_data:
DOCKEREOF

echo "✅ docker-compose.yml created"

# ── ENV FILE ───────────────────────────────────────
echo ""
echo "⚙️  Setting up environment..."
if [ ! -f /home/$USER/jagannatha-pipeline/.env ]; then
  cp /home/$USER/jagannatha-pipeline/.env.example \
     /home/$USER/jagannatha-pipeline/.env
  echo "⚠️  .env created from template"
  echo "⚠️  PLEASE FILL IN YOUR API KEYS in .env"
else
  echo "✅ .env already exists"
fi

# ── ORACLE FIREWALL RULES ──────────────────────────
echo ""
echo "🔥 Configuring firewall..."
sudo firewall-cmd --permanent --add-port=5678/tcp 2>/dev/null || \
  sudo ufw allow 5678/tcp 2>/dev/null || true
sudo firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || \
  sudo ufw allow 3000/tcp 2>/dev/null || true
sudo firewall-cmd --reload 2>/dev/null || \
  sudo ufw reload 2>/dev/null || true
echo "✅ Firewall ports 5678 and 3000 opened"

# ── START SERVICES ─────────────────────────────────
echo ""
echo "🚀 Starting n8n..."
cd /home/$USER/jagannatha-pipeline
docker-compose up -d
sleep 5
echo "✅ n8n started"

# ── GIT INIT ───────────────────────────────────────
echo ""
echo "🐙 Initializing Git repository..."
cd /home/$USER/jagannatha-pipeline
git init
git add -A
git commit -m "feat: initial Jagannatha SciFi Pipeline setup 🛸🙏"
echo "✅ Git repository initialized"

# ── SUMMARY ────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║         ✅ SETUP COMPLETE! 🎉               ║"
echo "╠══════════════════════════════════════════════╣"
echo "║                                              ║"
echo "║  n8n Dashboard:                              ║"
echo "║  http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_VM_IP'):5678  ║"
echo "║                                              ║"
echo "║  NEXT STEPS:                                 ║"
echo "║  1. Fill in .env with your API keys          ║"
echo "║  2. Import n8n workflow JSON                 ║"
echo "║  3. Upload jagannath_base.png to assets/     ║"
echo "║  4. Run: npm run test-apis                   ║"
echo "║  5. Run: npm run generate                    ║"
echo "║                                              ║"
echo "║  JAI JAGANNATH! 🙏🪔🛸                      ║"
echo "╚══════════════════════════════════════════════╝"
