#!/bin/sh
# Builds and uploads to a server over SSH. Settings come from the environment or a git-ignored deploy.local.
set -e
cd "$(dirname "$0")"
[ -f deploy.local ] && . ./deploy.local
HOST=${DEPLOY_HOST:?Set DEPLOY_HOST to an SSH host}
URL=${DEPLOY_URL:?Set DEPLOY_URL to the app address}
WEB_DIR=${DEPLOY_WEB_DIR:-/var/www/clean-notes}
SYNC_DIR=${DEPLOY_SYNC_DIR:-/opt/clean-notes-sync}
npm run build
rsync -az --delete dist/ "$HOST:$WEB_DIR/"
rsync -az server/sync.mjs "$HOST:$SYNC_DIR/"
ssh "$HOST" 'systemctl restart clean-notes-sync 2>/dev/null || true'
echo "Deployed to $URL"
