#!/bin/bash
# Quick check that critical API routes survived the build
HUB_ROOT="${1:-/home/trevor/trevor-dashboard}"
BUILD_DIR="$HUB_ROOT/.next"

if [ ! -d "$BUILD_DIR" ]; then
    echo "ERROR: No .next build directory found at $BUILD_DIR"
    exit 1
fi

ROUTES=("signals" "status" "live" "trades" "portfolio" "brain")
MISSING=0

for route in "${ROUTES[@]}"; do
    if find "$BUILD_DIR/server" -path "*api/${route}*" -type f 2>/dev/null | grep -q .; then
        echo "  OK: /api/${route}"
    else
        echo "  MISSING: /api/${route} not found in build output"
        MISSING=$((MISSING + 1))
    fi
done

if [ $MISSING -gt 0 ]; then
    echo "WARNING: $MISSING API routes missing from build!"
    exit 1
else
    echo "All critical API routes present in build."
fi
