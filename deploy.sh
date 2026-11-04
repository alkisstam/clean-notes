#!/bin/sh
# Builds and uploads to a server over SSH. Override any of these from the environment.
set -e
cd "$(dirname "$0")"
HOST=${DEPLOY_HOST:-tkdraw}
WEB_DIR=${DEPLOY_WEB_DIR:-/var/www/clean-notes}
SYNC_DIR=${DEPLOY_SYNC_DIR:-/opt/clean-notes-sync}
URL=${DEPLOY_URL:-https://notes.2-31-56-203.sslip.io}
npm run build
rsync -az --delete dist/ "$HOST:$WEB_DIR/"
rsync -az server/sync.mjs "$HOST:$SYNC_DIR/"
ssh "$HOST" 'systemctl restart clean-notes-sync 2>/dev/null || true'
echo "Deployed to $URL"
