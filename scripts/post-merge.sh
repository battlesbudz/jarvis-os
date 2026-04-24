#!/bin/bash
set -e

npm install --legacy-peer-deps
npx playwright install chromium
