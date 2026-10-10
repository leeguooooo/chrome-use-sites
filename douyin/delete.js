// Ported from jackwener/OpenCLI v1.8.8, clis/douyin/delete.js
// (https://github.com/jackwener/opencli), Copyright 2025 jackwener,
// licensed under the Apache License 2.0
// (http://www.apache.org/licenses/LICENSE-2.0); full text in douyin/LICENSE-OpenCLI.
// Modified by chrome-use (leeguooooo/chrome-use#508, #525): rewritten as a
// chrome-use site adapter that runs in the logged-in creator.douyin.com tab;
// work_list is parsed so 64-bit ids (item_id is a bare JSON number past 2^53)
// stay exact strings; the work card is found by its title (or id) instead of
// by position, scrolling to load more cards; work_list is paged to find older
// works; the never-reached fallback to the old delete endpoint is dropped.
/* @meta
{
  "name": "douyin/delete",
  "description": "Delete one of the signed-in account's own Douyin works from 作品管理 (creator.douyin.com), the way a person does it: find the work's card by its title, click 删除作品, confirm, then check work_list until the work is gone. Ids are kept as exact strings (19-digit ids do not round). Run with --until-done: the first run opens 作品管理 and the rerun deletes",
  "domain": "creator.douyin.com",
  "timeout": 120,
  "retryStatuses": ["navigating"],
  "args": {
    "aweme_id": {"required": true, "description": "The work's id (aweme_id or item_id, digits only), e.g. from douyin-creator/works"}
  },
  "capabilities": ["network", "dom"],
  "readOnly": false,
  "example": "chrome-use site douyin/delete 7694857245896576275 --until-done"
}
*/

async function(args) {
  args = args || {}
  const W = window
  const D = document
  const MANAGE_PATH = '/creator-micro/content/manage'
  const MANAGE_URL = 'https://creator.douyin.com' + MANAGE_PATH
  const WORK_LIST = '/janus/douyin/creator/pc/work_list?status=0&count=20&scene=star_atlas&device_platform=android&aid=1128&max_cursor='
  const MAX_PAGES = 10
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const textOf = (node) => ((node && (node.innerText || node.textContent)) || '').trim()
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
  const idOf = (value) => (value == null ? '' : String(value))

  const targetId = String(args.aweme_id == null ? '' : args.aweme_id).trim()
  if (!targetId) return { error: 'Missing argument: aweme_id', hint: 'Pass the work id, e.g. chrome-use site douyin/delete 7694857245896576275 --until-done' }
  if (!/^\d+$/.test(targetId)) return { error: 'aweme_id must be a numeric id, got ' + JSON.stringify(targetId), hint: 'List ids with chrome-use site douyin-creator/works' }

  // Douyin sends 64-bit ids as bare JSON numbers, which JSON.parse rounds
  // (7694857245896576275 -> 7694857245896576000). Quote every integer that is
  // not a safe JS integer before parsing, so ids come back as exact strings.
  function quoteUnsafeIntegers(text) {
    const src = String(text)
    let out = ''
    let i = 0
    let last = 0
    while (i < src.length) {
      const c = src[i]
      if (c === '"') {
        i += 1
        while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1
        i += 1
        continue
      }
      if (c === '-' || (c >= '0' && c <= '9')) {
        const start = i
        i += 1
        while (i < src.length && /[0-9.eE+-]/.test(src[i])) i += 1
        const token = src.slice(start, i)
        if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) {
          out += src.slice(last, start) + '"' + token + '"'
          last = i
        }
        continue
      }
      i += 1
    }
    return out + src.slice(last)
  }
  const parseJsonKeepingBigInts = (text) => JSON.parse(quoteUnsafeIntegers(text))

  // The card UI lives on 作品管理. Open it and come back: the navigation ends
  // this run, and --until-done reruns the command there.
  if (String(W.location.pathname || '').indexOf(MANAGE_PATH) !== 0) {
    setTimeout(() => W.location.assign(MANAGE_URL), 800)
    return { status: 'navigating', url: MANAGE_URL, retryAfterMs: 4000, hint: 'Opening 作品管理; run the same command again there, or pass --until-done' }
  }

  // The target in work_list, paged newest first. `index` counts works across
  // pages, which is where its card sits in the 全部作品 list.
  async function loadTarget() {
    let cursor = '0'
    let seen = 0
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let payload
      try {
        const res = await fetch(WORK_LIST + encodeURIComponent(cursor), { credentials: 'include' })
        if (!res.ok) return { ok: false, reason: 'work_list_http_' + res.status }
        payload = parseJsonKeepingBigInts(await res.text())
      } catch (e) {
        return { ok: false, reason: 'work_list_failed', message: String((e && e.message) || e) }
      }
      if (payload.status_code != null && payload.status_code !== 0) {
        return { ok: false, reason: 'work_list_status', status_code: payload.status_code, status_msg: payload.status_msg }
      }
      const list = Array.isArray(payload.aweme_list) ? payload.aweme_list : []
      const matches = list
        .map((entry, i) => ({ entry, index: seen + i }))
        .filter(({ entry }) => idOf(entry.aweme_id) === targetId || idOf(entry.item_id) === targetId)
      if (matches.length > 1) return { ok: false, reason: 'target_not_unique', count: matches.length }
      if (matches.length === 1) {
        const { entry, index } = matches[0]
        const item = { aweme_id: idOf(entry.aweme_id), item_id: idOf(entry.item_id) }
        const title = normalize(entry.desc || entry.caption || entry.title || entry.item_title || '')
        // What a work card shows: its title, or the first line of its text.
        const key = normalize(entry.item_title || String(entry.desc || entry.caption || entry.title || '').split('\n')[0]).slice(0, 12)
        return { ok: true, item, index, listCount: seen + list.length, title, key }
      }
      seen += list.length
      const next = payload.max_cursor == null ? '' : String(payload.max_cursor)
      if (!payload.has_more || !next || next === cursor) break
      cursor = next
    }
    return { ok: false, reason: 'not_found', count: seen }
  }

  function visibleWorkCards() {
    const candidates = Array.from(D.querySelectorAll('[class*="video-card"]')).filter((element) => {
      const text = normalize(textOf(element))
      return text.includes('删除作品') && text.includes('继续编辑')
    })
    return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && other.contains(candidate)))
  }

  // The card for the target. With a title: the only card showing it; among
  // several, the one whose markup carries the id, else the one at the
  // work_list index. Without a title: the only card whose markup carries the
  // id, else the index once every listed work is rendered.
  function findCard(cards, target) {
    const ids = [target.item.aweme_id, target.item.item_id].filter(Boolean)
    const carriesId = (card) => ids.some((id) => String(card.outerHTML || '').includes(id))
    const atIndex = cards[target.index] || null
    if (target.key) {
      const byTitle = cards.filter((card) => normalize(textOf(card)).includes(target.key))
      if (byTitle.length === 1) return byTitle[0]
      const byId = byTitle.filter(carriesId)
      if (byId.length === 1) return byId[0]
      return byTitle.includes(atIndex) ? atIndex : null
    }
    const byId = cards.filter(carriesId)
    if (byId.length === 1) return byId[0]
    return cards.length >= target.listCount ? atIndex : null
  }

  const target = await loadTarget()
  if (!target.ok) {
    const fail = Object.assign({ error: target.reason, aweme_id: targetId }, target)
    delete fail.ok
    if (target.reason === 'not_found') fail.hint = 'No work with this id in the account\'s work list (already deleted, or not this account\'s); nothing was clicked. List ids with chrome-use site douyin-creator/works'
    else fail.hint = 'Nothing was deleted. Open https://creator.douyin.com and sign in, then retry'
    return fail
  }

  // The page renders its cards after load.
  for (let wait = 0; wait < 20 && visibleWorkCards().length === 0; wait += 1) await sleep(500)

  const allTab = Array.from(D.querySelectorAll('button,[role="button"],span,div'))
    .find((element) => /^全部作品$/.test(normalize(textOf(element))))
  if (allTab) allTab.click()
  await sleep(1000)

  const ids = { aweme_id: target.item.aweme_id, item_id: target.item.item_id }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cards = visibleWorkCards()
    const card = findCard(cards, target)
    if (card) {
      const deleteButton = Array.from(card.querySelectorAll('button,[role="button"],span,div'))
        .find((element) => /^删除作品$/.test(normalize(textOf(element))))
      if (!deleteButton) return Object.assign({ error: 'delete_button_not_found', index: target.index, cardCount: cards.length, hint: 'Nothing was deleted' }, ids)
      deleteButton.click()
      await sleep(800)
      const confirmButton = Array.from(D.querySelectorAll('button,[role="button"]'))
        .find((element) => ['确定', '确认', '删除'].includes(normalize(textOf(element))))
      if (!confirmButton) return Object.assign({ error: 'confirm_button_not_found', hint: 'The delete dialog did not show a confirm button; nothing was confirmed' }, ids)
      confirmButton.click()
      for (let wait = 0; wait < 20; wait += 1) {
        await sleep(500)
        const after = await loadTarget()
        if (!after.ok && after.reason === 'not_found') {
          return Object.assign({ ok: true, status: 'deleted', title: target.title }, ids)
        }
      }
      return Object.assign({ error: 'delete_not_confirmed', hint: 'Confirm was clicked but the work is still in work_list; check 作品管理 before retrying' }, ids)
    }
    // Cards load as the list scrolls; bring the last one into view.
    const lastCard = cards[cards.length - 1]
    if (lastCard && lastCard.scrollIntoView) lastCard.scrollIntoView({ block: 'end' })
    await sleep(500)
  }
  return Object.assign({
    error: 'card_not_found',
    index: target.index,
    listCount: target.listCount,
    cardCount: visibleWorkCards().length,
    hint: 'No card on 作品管理 shows this work\'s title; nothing was clicked',
  }, ids)
}
