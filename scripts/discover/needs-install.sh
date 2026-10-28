#!/usr/bin/env bash
# Exit 0 when <dir>/node_modules must be (re)installed, 1 when it is usable.
#
# A lockfile-newer-than-marker test alone misses a half-finished install: on 2026-10-21
# an interrupted `npm ci` left node_modules with only its 92-byte .package-lock.json, the
# marker was newer than the lockfile, nothing reinstalled, and every daily run died on
# ERR_MODULE_NOT_FOUND 'js-yaml' for a week (SC-8049). `npm ls` checks the packages are there.
cd "${1:-.}"
[ -d node_modules ] || exit 0
[ package-lock.json -nt node_modules/.package-lock.json ] && exit 0
npm ls --depth=0 >/dev/null 2>&1 && exit 1
exit 0
