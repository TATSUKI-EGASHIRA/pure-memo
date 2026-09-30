#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")/../app"
npm run desktop:built
