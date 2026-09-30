// A small DOM for the douyin-creator tests: parses the captured fixtures and
// implements just the element, selector and event surface the adapter uses.
// Not an adapter (chrome-use only loads .js files), and not a general DOM.

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'col', 'area', 'wbr'])
const decode = (s) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&')

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type
    this.bubbles = !!init.bubbles
    this.cancelable = !!init.cancelable
    this.defaultPrevented = false
    this.propagationStopped = false
    Object.assign(this, init)
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true }
  stopPropagation() { this.propagationStopped = true }
}
export class FakeMouseEvent extends FakeEvent {}
export class FakeKeyboardEvent extends FakeEvent {}
export class FakeInputEvent extends FakeEvent {}

class Node {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = [] }
  get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null }
  get firstChild() { return this.childNodes[0] || null }
  get textContent() { return this.childNodes.map((c) => c.textContent).join('') }
  remove() {
    if (!this.parentNode) return
    const kids = this.parentNode.childNodes
    kids.splice(kids.indexOf(this), 1)
    this.parentNode = null
  }
}

class Text extends Node {
  constructor(doc, data) { super(doc); this.data = data }
  get textContent() { return this.data }
  get length() { return this.data.length }
  cloneNode() { return new Text(this.ownerDocument, this.data) }
}

class Comment extends Node {
  get textContent() { return '' }
  cloneNode() { return new Comment(this.ownerDocument) }
}

export class Element extends Node {
  constructor(doc, tag, attrs = {}) {
    super(doc)
    this.tagName = tag.toUpperCase()
    this.attrs = { ...attrs }
    this.listeners = {}
  }
  get children() { return this.childNodes.filter((c) => c instanceof Element) }
  get className() { return this.attrs.class || '' }
  set className(v) { this.attrs.class = v }
  get classList() {
    return {
      contains: (c) => this.className.split(/\s+/).includes(c),
      add: (c) => { if (!this.classList.contains(c)) this.className = (this.className + ' ' + c).trim() },
      remove: (c) => { this.className = this.className.split(/\s+/).filter((x) => x !== c).join(' ') },
    }
  }
  get id() { return this.attrs.id || '' }
  get disabled() { return this.hasAttribute('disabled') }
  get innerText() { return this.textContent }
  set innerHTML(html) {
    for (const c of this.childNodes) c.parentNode = null
    this.childNodes = []
    for (const n of parse(this.ownerDocument, html)) this.appendChild(n)
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null }
  hasAttribute(n) { return n in this.attrs }
  setAttribute(n, v) { this.attrs[n] = String(v) }
  removeAttribute(n) { delete this.attrs[n] }
  appendChild(n) { n.remove(); n.parentNode = this; this.childNodes.push(n); return n }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false }
  cloneNode(deep) {
    const c = new this.constructor(this.ownerDocument, this.tagName.toLowerCase(), this.attrs)
    if (deep) for (const k of this.childNodes) c.appendChild(k.cloneNode(true))
    return c
  }
  querySelectorAll(sel) {
    const groups = parseSelector(sel)
    const out = []
    const walk = (el) => {
      for (const c of el.children) {
        if (groups.some((g) => matchComplex(c, g, null))) out.push(c)
        walk(c)
      }
    }
    walk(this)
    return out
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  matches(sel) { return parseSelector(sel).some((g) => matchComplex(this, g, null)) }
  closest(sel) { for (let p = this; p instanceof Element; p = p.parentNode) if (p.matches(sel)) return p; return null }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  dispatchEvent(ev) {
    ev.target = this
    for (let p = this; p; p = p.parentNode) {
      for (const fn of (p.listeners && p.listeners[ev.type]) || []) fn.call(p, ev)
      if (!ev.bubbles || ev.propagationStopped) break
    }
    if (this.ownerDocument && this.ownerDocument.onEvent) this.ownerDocument.onEvent(ev)
    return !ev.defaultPrevented
  }
  click() { this.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true })) }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this }
}

export class InputElement extends Element {
  constructor(doc, tag, attrs) { super(doc, tag, attrs); this._value = attrs && attrs.value ? attrs.value : ''; this.files = null }
  get value() { return this._value }
  set value(v) { this._value = String(v) }
}

function parse(doc, html) {
  const root = new Element(doc, 'root')
  let cur = root
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) { cur.appendChild(new Comment(doc)); continue }
    if (m[1]) {
      const tag = m[1].toUpperCase()
      for (let p = cur; p && p !== root; p = p.parentNode) {
        if (p.tagName === tag) { cur = p.parentNode; break }
      }
      continue
    }
    if (m[2]) {
      const tag = m[2].toLowerCase()
      const attrs = {}
      const ar = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
      let a
      while ((a = ar.exec(m[3] || ''))) attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '')
      const el = tag === 'input' || tag === 'textarea' ? new InputElement(doc, tag, attrs) : new Element(doc, tag, attrs)
      cur.appendChild(el)
      if (!VOID.has(tag) && !m[4]) cur = el
      continue
    }
    if (m[5]) cur.appendChild(new Text(doc, decode(m[5])))
  }
  return [...root.childNodes]
}

// ---- selectors: tag, #id, .class, [attr], [attr=|*=|^=|$=v], :not(), ' ', '>', ','
function splitTop(s, sep) {
  const out = []
  let depth = 0, q = null, start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'") q = ch
    else if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    else if (depth === 0 && ch === sep) { out.push(s.slice(start, i)); start = i + 1 }
  }
  out.push(s.slice(start))
  return out
}
function parseCompound(s) {
  const c = { tag: null, parts: [] }
  const re = /^([a-zA-Z*][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([^\]=*^$~|]+)(?:([*^$]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|:not\(((?:[^()]|\([^()]*\))*)\)/y
  let i = 0
  while (i < s.length) {
    re.lastIndex = i
    const m = re.exec(s)
    if (!m) throw new Error('fakedom: unsupported selector ' + s)
    if (m[1]) c.tag = m[1] === '*' ? null : m[1].toUpperCase()
    else if (m[2]) c.parts.push((e) => e.id === m[2])
    else if (m[3]) c.parts.push((e) => e.classList.contains(m[3]))
    else if (m[4]) {
      const name = m[4].trim(), op = m[5], val = m[6] ?? m[7] ?? (m[8] || '').trim()
      c.parts.push((e) => {
        const v = e.getAttribute(name)
        if (v == null) return false
        if (!op) return true
        if (op === '=') return v === val
        if (op === '*=') return v.includes(val)
        if (op === '^=') return v.startsWith(val)
        return v.endsWith(val)
      })
    } else if (m[9] != null) {
      const inner = parseSelector(m[9])
      c.parts.push((e) => !inner.some((g) => matchComplex(e, g, null)))
    }
    i = re.lastIndex
  }
  return c
}
const cache = new Map()
function parseSelector(sel) {
  if (cache.has(sel)) return cache.get(sel)
  const groups = splitTop(sel, ',').map((g) => {
    const toks = g.trim().replace(/\s*>\s*/g, ' > ').split(/\s+(?![^\[]*\])/).filter(Boolean)
    const seq = []
    let comb = ' '
    for (const t of toks) {
      if (t === '>') { comb = '>'; continue }
      seq.push({ comb, c: parseCompound(t) })
      comb = ' '
    }
    return seq
  })
  cache.set(sel, groups)
  return groups
}
const matchCompound = (e, c) => e instanceof Element && (!c.tag || e.tagName === c.tag) && c.parts.every((p) => p(e))
function matchComplex(el, seq, scope, i = seq.length - 1) {
  if (!matchCompound(el, seq[i].c)) return false
  if (i === 0) return true
  const within = (p) => p && p !== scope && p instanceof Element
  if (seq[i].comb === '>') return within(el.parentNode) && matchComplex(el.parentNode, seq, scope, i - 1)
  for (let p = el.parentNode; within(p); p = p.parentNode) if (matchComplex(p, seq, scope, i - 1)) return true
  return false
}

// ---- document / window ------------------------------------------------------
export function createPage({ html = '', url = 'https://creator.douyin.com/' } = {}) {
  const doc = {
    activeElement: null,
    onEvent: null,
    execCommand: () => false,
    createRange: () => ({ selectNodeContents() {}, setStart() {}, collapse() {} }),
    // Like the real editor: a caret moved by script is only picked up after
    // the (asynchronous) selectionchange. Edits before that land elsewhere.
    selectionPending: false,
  }
  const body = new Element(doc, 'body')
  doc.body = body
  body.innerHTML = html
  doc.querySelector = (s) => body.querySelector(s)
  doc.querySelectorAll = (s) => body.querySelectorAll(s)
  doc.parse = (h) => parse(doc, h)
  const location = new URL(url)
  const window = {
    location,
    MouseEvent: FakeMouseEvent,
    KeyboardEvent: FakeKeyboardEvent,
    InputEvent: FakeInputEvent,
    Event: FakeEvent,
    HTMLInputElement: InputElement,
    getSelection: () => ({
      removeAllRanges() {},
      addRange() {
        doc.selectionPending = true
        setTimeout(() => { doc.selectionPending = false }, 10)
      },
    }),
    File: class { constructor(parts, name, opts) { this.name = name; this.type = opts && opts.type; this.size = parts.reduce((n, p) => n + (p.size || 0), 0) } },
    DataTransfer: class { constructor() { const list = []; this.files = list; this.items = { add: (f) => list.push(f) } } },
  }
  return { window, document: doc, body }
}
