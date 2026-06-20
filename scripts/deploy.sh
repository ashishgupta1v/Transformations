#!/usr/bin/env bash
# scripts/deploy.sh
# Manual deploy helper — mirrors the .github/workflows/deploy.yml "deploy" job
# so you can push a release to the Oracle VM without waiting on CI.
#
# Usage:
#   bash scripts/deploy.sh                 # pull + npm ci + restart n8n
#   bash scripts/deploy.sh --run-pipeline  # ...then trigger a pipeline run
#   bash scripts/deploy.sh --import-n8n    # ...then import the n8n workflow JSON
#
# Reads connection details from .env (falls back to sane defaults):
#   ORACLE_VM_IP        - VM public IP or hostname (falls back to N8N_HOST)
#   ORACLE_VM_USER       - SSH user (default: opc, Oracle Linux default)
#   ORACLE_SSH_KEY_PATH  - path to private key (default: ~/.ssh/id_rsa)
#   PROJECT_DIR          - remote project path (default: /home/opc/jagannatha-pipeline)

set -e

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

VM_IP="${ORACLE_VM_IP:-${N8N_HOST:-}}"
VM_USER="${ORACLE_VM_USER:-opc}"
SSH_KEY="${ORACLE_SSH_KEY_PATH:-$HOME/.ssh/id_rsa}"
PROJECT_DIR="${PROJECT_DIR:-/home/opc/jagannatha-pipeline}"

RUN_PIPELINE=false
IMPORT_N8N=false
for arg in "$@"; do
  case "$arg" in
    --run-pipeline) RUN_PIPELINE=true ;;
    --import-n8n) IMPORT_N8N=true ;;
    *) echo "Unknown flag: $arg" && exit 1 ;;
  esac
done

if [ -z "$VM_IP" ]; then
  echo "❌ ORACLE_VM_IP (or N8N_HOST) is not set in .env — cannot deploy." >&2
  exit 1
fi

echo "🛸 Deploying Jagannatha SciFi Pipeline to ${VM_USER}@${VM_IP}"
echo "📁 Remote project dir: ${PROJECT_DIR}"

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "${VM_USER}@${VM_IP}" "cd '${PROJECT_DIR}' && bash -s" <<ENDSSH
  set -e
  echo "🚀 Starting deployment..."

  git pull origin main
  npm ci --production
  docker-compose restart n8n

  echo "✅ Deployment complete!"
  echo "📅 Deployed at: \$(date '+%Y-%m-%d %H:%M:%S IST')"

  echo "📊 Service status:"
  docker-compose ps
  echo "Node version: \$(node --version)"
ENDSSH

if [ "$IMPORT_N8N" = true ]; then
  echo "⚙️  Importing n8n workflow..."
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "${VM_USER}@${VM_IP}" \
    "cd '${PROJECT_DIR}' && docker exec n8n n8n import:workflow --input=/workspace/n8n/workflows/main-pipeline.workflow.json"
  echo "✅ n8n workflow imported"
fi

if [ "$RUN_PIPELINE" = true ]; then
  echo "🎬 Triggering video pipeline..."
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "${VM_USER}@${VM_IP}" \
    "cd '${PROJECT_DIR}' && nohup node src/index.js generate > logs/pipeline-\$(date +%Y%m%d-%H%M%S).log 2>&1 & echo 'Pipeline started (PID: '\$!')'"
fi

echo "🙏 JAI JAGANNATH! Deploy finished."
