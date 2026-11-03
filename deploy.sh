#!/bin/sh
# Builds and uploads to the Hetzner box. Uses the `tkdraw` host from ~/.ssh/config.
set -e
cd "$(dirname "$0")"
npm run build
rsync -az --delete dist/ tkdraw:/var/www/clean-notes/
rsync -az server/sync.mjs tkdraw:/opt/clean-notes-sync/
ssh tkdraw 'systemctl restart clean-notes-sync 2>/dev/null || true'
echo "Deployed to https://notes.2-31-56-203.sslip.io"
