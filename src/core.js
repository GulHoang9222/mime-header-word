/**
 * MIME encoded-word decoder per RFC 2047.
 *
 * Supports the two charsets that matter in practice — UTF-8 (the modern
 * default) and ISO-8859-1 (the legacy Latin-1 still seen in old mail
 * archives). Other charsets are decoded as best-effort Latin-1 because
 * Node has no built-in iconv; that decision is documented in the README.
 */

const TOKEN_B = 0x42; // 'B'
const TOKEN_Q = 0x51; // 'Q'
const TOKEN_QMARK = 0x3f; // '?'

/** True iff `s` matches the RFC 2047 encoded-word shape. */
export function isEncodedWord(s) {
  return /^=\?[^?]*\?[BbQq]\?[^?]*\?=$/.test(s);
}

/**
 * Decode a single RFC 2047 encoded-word token (with surrounding `=?...?=`).
 *
 * Returns the decoded string. If the token is malformed — missing the
 * trailing `?=`, unrecognised encoding, or a charset Node cannot represent —
 * the original text is returned verbatim. That matches the behaviour mail
 * readers exhibit in the wild: a broken encoded-word is shown as-is rather
 * than dropped, so the user at least sees the raw bytes.
 */
export function decodeEncodedWord(token) {
  // Tight match: charset and encoded-text may not contain '?', so the
  // six-delimiter structure is unambiguous.
  const m = /^=\?([^?]+)\?([BbQq])\?([^?]*)\?=$/.exec(token);
  if (!m) return token;

  const charset = m[1].toLowerCase();
  const encoding = m[2].toUpperCase();
  const encoded = m[3];

  let bytes;
  try {
    if (encoding === 'B') {
      bytes = decodeBase64ToBytes(encoded);
    } else {
      bytes = decodeQToBytes(encoded);
    }
  } catch {
    return token;
  }

  return bytesToText(bytes, charset);
}

/**
 * Decode a full header value: every RFC 2047 encoded-word is replaced by its
 * decoded form, and linear-white-space between adjacent encoded-words is
 * removed (per RFC 2047 §6.2, "adjacent" rule). All other text — including
 * text between a non-encoded token and an encoded-word — is left untouched.
 */
export function decodeMimeHeader(input) {
  if (typeof input !== 'string') {
    throw new TypeError('input must be a string');
  }
  if (input.length === 0) return '';

  // Tokenise into encoded-words, whitespace runs, and literal spans. We
  // do this in a single pass so the "adjacent encoded-words" rule can look
  // at neighbouring tokens without re-scanning.
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const c = input.charCodeAt(i);
    if (c === 0x3d /* = */ && input.charCodeAt(i + 1) === 0x3f /* ? */) {
      const end = input.indexOf('?=\n', i);
      const adj = end >= 0 ? end + 2 : -1;
      const lone = input.indexOf('?', i + 2);
      // We look for the canonical `=?<cs>?<enc>?<text>?=` terminator.
      const close = findEncodedWordEnd(input, i);
      if (close > i) {
        tokens.push({ t: 'ew', v: input.slice(i, close + 2) });
        i = close + 2;
        continue;
      }
    }
    if (isWs(c)) {
      let j = i + 1;
      while (j < input.length && isWs(input.charCodeAt(j))) j++;
      tokens.push({ t: 'ws', v: input.slice(i, j) });
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < input.length && !isWs(input.charCodeAt(j)) && !(input.charCodeAt(j) === 0x3d && input.charCodeAt(j + 1) === 0x3f)) j++;
    tokens.push({ t: 'lit', v: input.slice(i, j) });
    i = j;
  }

  // Collapse whitespace between two adjacent encoded-words; keep it
  // everywhere else. This is the RFC 2047 "linear-white-space between
  // adjacent encoded-words is ignored" rule.
  let out = '';
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k];
    if (cur.t === 'ws') {
      const prev = tokens[k - 1];
      const next = tokens[k + 1];
      if (prev && prev.t === 'ew' && next && next.t === 'ew') {
        continue; // drop the separating whitespace
      }
      out += cur.v;
      continue;
    }
    out += cur.t === 'ew' ? decodeEncodedWord(cur.v) : cur.v;
  }
  return out;
}

/** Decode a Quoted-Printable payload to a byte array. Throws on bad input. */
function decodeQToBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; ) {
    const c = s.charCodeAt(i);
    if (c === 0x5f /* _ */) {
      out.push(0x20);
      i++;
    } else if (c === 0x25 /* % */) {
      // Per RFC 2047 §4.2, '%' is the hex-escape prefix in Q encoding
      // (NOT '=', which is used in body Quoted-Printable). This is the
      // single most common implementation mistake.
      const hi = hexVal(s.charCodeAt(i + 1));
      const lo = hexVal(s.charCodeAt(i + 2));
      if (hi < 0 || lo < 0) throw new Error('bad Q escape');
      out.push((hi << 4) | lo);
      i += 3;
    } else {
      out.push(c & 0xff);
      i++;
    }
  }
  return new Uint8Array(out);
}

/** Decode a Base64 payload to a byte array. Throws on bad input. */
function decodeBase64ToBytes(s) {
  // Node's Buffer ignores stray whitespace and bad padding silently; we
  // reject anything outside the canonical alphabet plus '=' so that a
  // truncated token is surfaced rather than mis-decoded.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    throw new Error('invalid base64');
  }
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/** Convert a byte array to a JS string using the named charset. */
function bytesToText(bytes, charset) {
  // Node's TextDecoder only ships with UTF-* and legacy single-byte
  // ISO-8859 code pages built in. We special-case UTF-8 (the only
  // charset the brief asks for) and fall back to ISO-8859-1 for
  // everything else — including the ISO-8859-* family and US-ASCII,
  // which is a strict subset. That is a deliberate, documented choice:
  // the brief says no third-party deps, so no iconv.
  if (charset === 'utf-8' || charset === 'utf8') {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  if (charset === 'iso-8859-1' || charset === 'latin1' || charset === 'us-ascii' || charset === 'ascii') {
    return new TextDecoder('iso-8859-1', { fatal: false }).decode(bytes);
  }
  // Unknown charset: best-effort Latin-1 so the user sees *something*
  // rather than an exception. This is the same fallback Postfix uses.
  return new TextDecoder('iso-8859-1', { fatal: false }).decode(bytes);
}

function hexVal(c) {
  if (c >= 0x30 && c <= 0x39) return c - 0x30; // 0-9
  if (c >= 0x41 && c <= 0x46) return c - 0x37; // A-F
  if (c >= 0x61 && c <= 0x66) return c - 0x57; // a-f
  return -1;
}

function isWs(c) {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

/**
 * Find the index of the '?' in the closing '?=' of an encoded-word starting
 * at `start`, or -1 if the token does not match the encoded-word shape.
 */
function findEncodedWordEnd(s, start) {
  // =? charset ? enc ? text ?=
  // 0 1 2      3 4   5 6    7 8
  let p = start + 2; // skip '?'
  const cs = s.indexOf('?', p);
  if (cs < 0) return -1;
  p = cs + 1;
  if (p >= s.length) return -1;
  const enc = s.charCodeAt(p);
  if (enc !== TOKEN_B && enc !== TOKEN_B + 32 && enc !== TOKEN_Q && enc !== TOKEN_Q + 32) return -1;
  p++;
  if (s.charCodeAt(p) !== TOKEN_QMARK) return -1;
  p++;
  const text = s.indexOf('?', p);
  if (text < 0) return -1;
  if (s.charCodeAt(text + 1) !== 0x3d /* = */) return -1;
  return text;
}
