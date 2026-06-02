#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

detached=""
build="--build"
for arg in "$@"; do
  case "$arg" in
    -d|--detached)
      detached="-d"
      ;;
    --skip-build)
      build=""
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: scripts/docker-start.sh [--detached] [--skip-build]" >&2
      exit 2
      ;;
  esac
done

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Fill local secrets there if needed."
fi

docker compose config --quiet --no-env-resolution

set -- up
if [ -n "$build" ]; then
  set -- "$@" "$build"
fi
if [ -n "$detached" ]; then
  set -- "$@" "$detached"
fi

docker compose "$@"
