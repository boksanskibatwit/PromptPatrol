#!/usr/bin/env bash
#
# Builds backend/lambda.zip for AWS Lambda (Python 3.13, x86_64).
#
# Why this isn't just "zip the venv": some dependencies (e.g. pydantic-core)
# ship compiled binaries, and Lambda runs Linux while you're on macOS. We fetch
# the Linux wheels explicitly with pip's --platform flag, so no Docker is needed.
#
# Usage:  cd backend && ./build_lambda.sh
#
set -euo pipefail
cd "$(dirname "$0")"

BUILD_DIR="build"
ZIP="lambda.zip"

echo "==> Cleaning previous build"
rm -rf "$BUILD_DIR" "$ZIP"
mkdir -p "$BUILD_DIR"

echo "==> Installing Linux dependencies (cp313 / manylinux2014_x86_64)"
pip install \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.13 \
  --only-binary=:all: \
  --target "$BUILD_DIR" \
  -r requirements.txt

echo "==> Adding application code"
cp -r app "$BUILD_DIR/"

echo "==> Zipping"
( cd "$BUILD_DIR" && zip -qr "../$ZIP" . -x '*.pyc' -x '*__pycache__*' )

echo "==> Done: $(du -h "$ZIP" | cut -f1)  ->  backend/$ZIP"
echo "    Lambda handler is: app.main.handler"
