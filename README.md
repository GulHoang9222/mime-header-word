# mime-header-word

Decode RFC 2047 encoded-word tokens as they appear in MIME message headers: `=?UTF-8?B?...?=` and `=?UTF-8?Q?...?=`. Returns plain text.

```js
import { decodeMimeHeader, decodeEncodedWord, isEncodedWord } from 'mime-header-word';

isEncodedWord('=?UTF-8?B?SGVsbG8=?=');           // true
decodeEncodedWord('=?UTF-8?B?SGVsbG8=?=');        // 'Hello'
decodeMimeHeader('Subject: =?UTF-8?Q?caf%C3%A9?='); // 'Subject: café'
```

## Why

Every mail library eventually needs this, and most pull in a 200 KB dependency graph to get it. This library is the 4 KB of code that actually handles the cases real mail produces: UTF-8 Base64, UTF-8 Quoted-Printable, and the whitespace-folding rule from RFC 2047 §6.2 that collapses runs of linear-white-space between adjacent encoded-words.

The trade-off is charset coverage. Node has no built-in iconv, and this library has zero third-party dependencies, so only UTF-8 and ISO-8859-1 are decoded through `TextDecoder`. Any other declared charset falls back to Latin-1 so you see bytes rather than an exception. If you need Shift-JIS or GB2312, this is not the library for you.

## The awkward edge

Quoted-Printable in RFC 2047 uses `%` as the hex-escape prefix, not `=`. The `=` prefix belongs to body QP (RFC 2045). Some mail in the wild uses `=` by mistake; this library follows the spec and only honours `%`. A payload like `=?UTF-8?Q?caf=C3=A9?=` will be returned as the literal bytes `c`, `a`, `f`, `=`, `C`, `3`, `=`, `A`, `9` — which is wrong-looking but spec-correct. If you need to be lenient about that particular mistake, wrap the input before calling this.
