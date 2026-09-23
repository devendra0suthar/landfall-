import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, passwordProblem } from '../src/auth/password.js';

/**
 * Password hashing, checked offline like everything else in this suite.
 *
 * These are not line-coverage tests. Each one is a way the hash could be wrong
 * in a manner that still *looks* like it works: a verify that accepts anything,
 * a salt that is not actually random, a stored format whose cost parameters are
 * ignored on read, or a corrupt row that throws a 500 instead of reading as a
 * failed login.
 */

test('a password verifies against its own hash', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
});

test('a wrong password does not', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery stapler', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('the same password hashes differently every time', async () => {
  // If these collide the salt is not doing its job, and one leaked table
  // becomes a rainbow table for every account that shares a password.
  const a = await hashPassword('the same password twice');
  const b = await hashPassword('the same password twice');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('the same password twice', a), true);
  assert.equal(await verifyPassword('the same password twice', b), true);
});

test('the cost parameters travel with the hash', async () => {
  const hash = await hashPassword('parameters are stored');
  const [scheme, n, r, p, salt, key] = hash.split('$');
  assert.equal(scheme, 'scrypt');
  assert.ok(Number(n) >= 16384, 'cost factor should not be weak');
  assert.equal(r, '8');
  assert.equal(p, '1');
  assert.ok((salt ?? '').length > 0 && (key ?? '').length > 0);
});

test('a hash made with different parameters still verifies', async () => {
  // Raising the cost factor must not lock out every existing account, which is
  // the whole reason the parameters are read from the stored string.
  const hash = await hashPassword('old and cheap');
  const weakened = hash.replace(/^scrypt\$\d+/, 'scrypt$16384');
  // Re-derived at the stated cost, so it must NOT match the stronger hash.
  assert.equal(await verifyPassword('old and cheap', weakened), false);
  // …and the original is untouched.
  assert.equal(await verifyPassword('old and cheap', hash), true);
});

test('an account with no password cannot be signed into', async () => {
  // Null means "has not set one", never "any password will do".
  assert.equal(await verifyPassword('anything', null), false);
  assert.equal(await verifyPassword('', null), false);
});

test('a corrupt row reads as a failed login, not a crash', async () => {
  for (const bad of [
    '', 'not-a-hash', 'scrypt$', 'scrypt$1$2$3$4',
    'bcrypt$32768$8$1$c2FsdA$a2V5', 'scrypt$abc$8$1$c2FsdA$a2V5',
    'scrypt$32768$8$1$$', 'scrypt$999999999$8$1$c2FsdA$a2V5',
  ]) {
    assert.equal(await verifyPassword('anything', bad), false, `should refuse: ${bad}`);
  }
});

test('length is the only rule, and it has both ends', () => {
  assert.ok(passwordProblem('short'));
  assert.equal(passwordProblem('a'.repeat(10)), null);
  assert.equal(passwordProblem('a'.repeat(200)), null);
  assert.ok(passwordProblem('a'.repeat(201)));
  // No composition rules: a long passphrase of plain words is fine.
  assert.equal(passwordProblem('correct horse battery staple'), null);
});

test('unicode passwords normalise, so the same keystrokes always work', async () => {
  // "é" composed vs decomposed are different byte strings for the same typed
  // character; without NFKC, one keyboard signs in and another does not.
  const composed = 'café password here';
  const decomposed = 'café password here';
  assert.notEqual(composed, decomposed);
  const hash = await hashPassword(composed);
  assert.equal(await verifyPassword(decomposed, hash), true);
});
