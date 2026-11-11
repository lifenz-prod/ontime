#!/bin/sh
# Builds the native helpers the macOS desktop app ships with (see ltc-capture/main.swift).
# Produces one universal binary, so the same file serves the x64 and arm64 builds.
# Elsewhere it does nothing: those builds read timecode through the browser reader.
set -e

if [ "$(uname)" != "Darwin" ]; then
  echo "native: not macOS, skipping"
  exit 0
fi

cd "$(dirname "$0")"
mkdir -p bin build

for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos11" -o "build/ltc-capture-$arch" ltc-capture/main.swift
done
lipo -create -output bin/ltc-capture build/ltc-capture-arm64 build/ltc-capture-x86_64
rm -rf build

echo "native: built bin/ltc-capture ($(lipo -archs bin/ltc-capture))"
