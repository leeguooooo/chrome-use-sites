#!/bin/sh
# Install chrome-use site adapters into ~/.chrome-use/sites/.
#
#   curl -fsSL https://raw.githubusercontent.com/leeguooooo/chrome-use-sites/main/install.sh | sh
#
# Installs every adapter pack in this repo (currently: sggit, twitter, chatgpt,
# xiaohongshu-creator, douyin-creator, youtube-studio, bilibili-creator, and article-publish for juejin, csdn,
# segmentfault and zhihu). Custom adapters
# under ~/.chrome-use/sites/ survive `chrome-use site update` (it merges the
# community pack, it does not wipe the dir), so these stay put.
set -eu

REPO="leeguooooo/chrome-use-sites"
BRANCH="${CHROME_USE_SITES_REF:-main}"
BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
DEST_ROOT="${CHROME_USE_HOME:-$HOME/.chrome-use}/sites"

# packName:file file ...
PACKS="sggit/pr-create.js sggit/pr-list.js sggit/pr-merge.js twitter/search.js twitter/thread.js twitter/post.js
chatgpt/_helper.js chatgpt/me.js chatgpt/conversations.js chatgpt/projects.js
chatgpt/models.js chatgpt/conversation.js chatgpt/open-project.js chatgpt/images.js
xiaohongshu-creator/_helper.js xiaohongshu-creator/me.js xiaohongshu-creator/notes.js
xiaohongshu-creator/note-stats.js
juejin/article-publish.js csdn/article-publish.js segmentfault/article-publish.js
zhihu/article-publish.js
douyin-creator/video-publish.js
youtube-studio/video-upload.js
bilibili-creator/video-publish.js
si12333/pension-payments.js
appstoreconnect/apps.js appstoreconnect/app-create.js appstoreconnect/builds.js"

# Files a pack needs that live in another repo. The twitter adapters call
# findGraphQLQueryId / findTransactionIdGenerator, which are defined in the
# community pack's twitter/_helper.js (epiral/bb-sites), not here. That repo
# carries no license, so it is fetched from its source rather than copied in,
# and pinned to a commit so an upstream rename cannot break these adapters.
# Format: <dest path>=<url>
EXTERNAL="twitter/_helper.js=https://raw.githubusercontent.com/epiral/bb-sites/f0cdfbf17e0fc8d86e2b1d9a8561e14b01faa013/twitter/_helper.js"

echo "Installing chrome-use site adapters -> ${DEST_ROOT}"
for rel in $PACKS; do
  dir="${DEST_ROOT}/$(dirname "$rel")"
  mkdir -p "$dir"
  printf '  → %s\n' "$rel"
  curl -fsSL "${BASE}/${rel}" -o "${DEST_ROOT}/${rel}"
done
for entry in $EXTERNAL; do
  rel="${entry%%=*}"
  url="${entry#*=}"
  mkdir -p "${DEST_ROOT}/$(dirname "$rel")"
  printf '  → %s (from %s)\n' "$rel" "${url#https://raw.githubusercontent.com/}"
  curl -fsSL "$url" -o "${DEST_ROOT}/${rel}"
done

echo "✓ done"
echo
echo "Verify:  chrome-use site list | grep -E '^(sggit|twitter|chatgpt|xiaohongshu-creator|douyin-creator|youtube-studio|bilibili-creator|juejin|csdn|segmentfault|zhihu|si12333|appstoreconnect)/'"
echo "Try:     chrome-use site twitter/search \"chrome-use\""
echo
echo "Note: adapters run in YOUR logged-in browser tab, so you must be"
echo "signed in to the target site first (and on VPN/WARP if it is internal)."
