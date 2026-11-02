#!/bin/sh
# Builds and uploads to the Hetzner box. Uses the `tkdraw` host from ~/.ssh/config.
set -e
cd "$(dirname "$0")"
npm run build
rsync -az --delete dist/ tkdraw:/var/www/clean-notes/
echo "Deployed to https://notes.2-31-56-203.sslip.io"
