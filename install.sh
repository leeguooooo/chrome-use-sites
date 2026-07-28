#!/bin/sh
# Install chrome-use site adapters into ~/.chrome-use/sites/.
#
#   curl -fsSL https://raw.githubusercontent.com/leeguooooo/chrome-use-sites/main/install.sh | sh
#
# Installs every adapter pack in this repo (currently: sggit and twitter). Custom adapters
# under ~/.chrome-use/sites/ survive `chrome-use site update` (it merges the
# community pack, it does not wipe the dir), so these stay put.
set -eu

REPO="leeguooooo/chrome-use-sites"
BRANCH="${CHROME_USE_SITES_REF:-main}"
BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
DEST_ROOT="${CHROME_USE_HOME:-$HOME/.chrome-use}/sites"

# packName:file file ...
PACKS="sggit/pr-create.js sggit/pr-list.js sggit/pr-merge.js twitter/search.js twitter/thread.js"

echo "Installing chrome-use site adapters -> ${DEST_ROOT}"
for rel in $PACKS; do
  dir="${DEST_ROOT}/$(dirname "$rel")"
  mkdir -p "$dir"
  printf '  → %s\n' "$rel"
  curl -fsSL "${BASE}/${rel}" -o "${DEST_ROOT}/${rel}"
done

echo "✓ done"
echo
echo "Verify:  chrome-use site list | grep -E '^(sggit|twitter)/'"
echo "Try:     chrome-use site twitter/search \"chrome-use\""
echo
echo "Note: adapters run in YOUR logged-in browser tab, so you must be"
echo "signed in to the target site first (and on VPN/WARP if it is internal)."
