#!/bin/sh
set -eu

echo "Starting container"
docker start lumix

echo "Waiting server to be ready"
sleep 3

echo "Running tests"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
env $(cat "$REPO_ROOT/.hurl/hurl.env" | xargs) hurl --test --color "$REPO_ROOT/.hurl/lumix/"*.hurl

echo "Stopping container"
docker stop lumix