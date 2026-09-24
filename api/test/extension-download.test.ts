import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zip } from '../src/lib/zip.js';
import { manifestFor, originFor } from '../src/routes/extension.js';

test('crc32 matches the standard check value', () => {
  // The CRC-32 of "123456789" is 0xCBF43926 by definition of the algorithm.
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('a zip has one local header per file and a correct end record', () => {
  const z = zip([{ name: 'a/x.txt', data: Buffer.from('hello') }, { name: 'a/y.txt', data: Buffer.from('') }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50, 'starts with a local file header');
  const end = z.length - 22;
  assert.equal(z.readUInt32LE(end), 0x06054b50);
  assert.equal(z.readUInt16LE(end + 10), 2, 'two entries');
  assert.ok(z.includes(Buffer.from('hello')));
});

test('only https, or a machine talking to itself, is baked into the extension', () => {
  assert.equal(originFor('https', 'landfall-vlen.onrender.com'), 'https://landfall-vlen.onrender.com');
  assert.equal(originFor('http', 'localhost:5174'), 'http://localhost:5174');
  assert.equal(originFor('http', 'landfall-vlen.onrender.com'), null, 'no plain http to the internet');
  assert.equal(originFor('https', 'evil.com/"><script>'), null, 'a host header is not free text');
});

test('the installed manifest grants this site and drops developer localhost', () => {
  const raw = JSON.stringify({ host_permissions: ['https://boards.greenhouse.io/*', 'http://127.0.0.1:5175/*', 'http://localhost:5175/*'] });
  const m = JSON.parse(manifestFor(raw, 'https://landfall-vlen.onrender.com')) as { host_permissions: string[] };
  assert.deepEqual(m.host_permissions, ['https://boards.greenhouse.io/*', 'https://landfall-vlen.onrender.com/*']);
  const local = JSON.parse(manifestFor(raw, 'http://localhost:5174')) as { host_permissions: string[] };
  assert.ok(local.host_permissions.includes('http://localhost:5174/*'));
});
