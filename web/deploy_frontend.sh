#!/usr/bin/env bash
#
# Build and deploy the frontend to S3 + CloudFront (Phase 3).
#
# Rebuilds the production bundle, syncs it to the frontend bucket (--delete
# removes stale asset hashes), and invalidates the CloudFront cache so visitors
# get the new version right away instead of a cached old one.
#
# Requires the AWS CLI configured with credentials that can write the bucket and
# create CloudFront invalidations (your admin profile — same one used to deploy
# the backend).
#
# Usage:  cd web && ./deploy_frontend.sh
#
set -euo pipefail
cd "$(dirname "$0")"

BUCKET="promptpatrol-frontend"
DISTRIBUTION_ID="E3L5CANT2P5KQ5"
SITE_URL="https://dv0rezuo5ctw7.cloudfront.net"

echo "==> Building production bundle"
npm run build

echo "==> Syncing dist/ to s3://$BUCKET"
aws s3 sync dist/ "s3://$BUCKET" --delete

echo "==> Invalidating CloudFront cache ($DISTRIBUTION_ID)"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" --paths "/*" >/dev/null

echo "==> Done. Live at $SITE_URL (cache invalidation takes ~1 min)"
