import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMimeHeader, decodeEncodedWord, isEncodedWord } from '../src/index.js';

test('isEncodedWord recognises well-formed B and Q tokens', () => {
  assert.equal(isEncodedWord('=?UTF-8?B?SGVsbG8=?='), true);
  assert.equal(isEncodedWord('=?utf-8?Q?Hi?='), true);
  assert.equal(isEncodedWord('plain text'), false);
  assert.equal(isEncodedWord('=?UTF-8?X?Hi?='), false);
});

test('decodeEncodedWord decodes UTF-8 Base64', () => {
  // "Hello" in Base64
  assert.equal(decodeEncodedWord('=?UTF-8?B?SGVsbG8=?='), 'Hello');
});

test('decodeEncodedWord decodes UTF-8 Quoted-Printable with percent escapes', () => {
  // café = 0x63 0x61 0x66 0xC3 0xA9
  assert.equal(decodeEncodedWord('=?UTF-8?Q?caf%C3%A9?='), 'café');
});

test('decodeEncodedWord treats underscore as space in Q', () => {
  assert.equal(decodeEncodedWord('=?UTF-8?Q?Hello_World?='), 'Hello World');
});

test('decodeEncodedWord passes through malformed input verbatim', () => {
  assert.equal(decodeEncodedWord('=?UTF-8?B?@@@?='), '=?UTF-8?B?@@@?=');
  assert.equal(decodeEncodedWord('not an encoded word'), 'not an encoded word');
});

test('decodeEncodedWord falls back to Latin-1 for unknown charset', () => {
  // 0xE9 in Latin-1 is é
  assert.equal(decodeEncodedWord('=?WHATEVER?Q?%E9?='), 'é');
});

test('decodeMimeHeader leaves plain text untouched', () => {
  assert.equal(decodeMimeHeader('Subject: Plain text'), 'Subject: Plain text');
  assert.equal(decodeMimeHeader(''), '');
});

test('decodeMimeHeader decodes a single embedded encoded-word', () => {
  assert.equal(decodeMimeHeader('Subject: =?UTF-8?B?SGVsbG8=?='), 'Subject: Hello');
});

test('decodeMimeHeader collapses whitespace between adjacent encoded-words', () => {
  // Two Base64 words for "Foo" and "Bar", separated by a space.
  // RFC 2047 §6.2 says whitespace between adjacent encoded-words is ignored.
  assert.equal(
    decodeMimeHeader('=?UTF-8?B?Rm9v?= =?UTF-8?B?QmFy?='),
    'FooBar',
  );
});

test('decodeMimeHeader preserves whitespace between literal and encoded-word', () => {
  assert.equal(
    decodeMimeHeader('Re: =?UTF-8?B?Rm9v?='),
    'Re: Foo',
  );
});

test('decodeMimeHeader handles mixed Q and B in one line', () => {
  assert.equal(
    decodeMimeHeader('=?UTF-8?Q?caf%C3%A9?= =?UTF-8?B?QmFy?='),
    'caféBar',
  );
});

test('decodeMimeHeader is case-insensitive on the encoding letter', () => {
  assert.equal(decodeEncodedWord('=?UTF-8?b?SGVsbG8=?='), 'Hello');
  assert.equal(decodeEncodedWord('=?utf-8?q?Hello_World?='), 'Hello World');
});

test('decodeMimeHeader throws on non-string input', () => {
  assert.throws(() => decodeMimeHeader(42), TypeError);
  assert.throws(() => decodeMimeHeader(null), TypeError);
});

test('decodeMimeHeader keeps an encoded-word with a bad payload as-is', () => {
  assert.equal(
    decodeMimeHeader('Subject: =?UTF-8?B?@not-base64@?='),
    'Subject: =?UTF-8?B?@not-base64@?=',
  );
});
