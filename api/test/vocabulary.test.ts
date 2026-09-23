import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termsIn } from '../src/jobs/extract.js';

/**
 * The vocabulary has to be a vocabulary, not a software vocabulary.
 *
 * Everything in this product that compares a candidate to a posting runs
 * through `termsIn` — matching, the gap report, tailoring, the analyser. So a
 * craft the vocabulary cannot see is a craft the product silently scores at
 * zero, with no message explaining why.
 *
 * That was measurably true: a working photographer's CV — Lightroom, Capture
 * One, Hasselblad, photojournalism, colour grading, retouching — returned one
 * term, "campaigns", and that was a false positive from marketing. These tests
 * stop it quietly becoming true again.
 */

const PHOTOGRAPHER = `Freelance Photographer. Editorial and commercial portrait photography.
Adobe Lightroom, Photoshop, Capture One. Studio lighting, medium format.
Photojournalism for national press. Retouching, colour grading, print production.
Drone videography, DaVinci Resolve, motion graphics.`;

const DEVELOPER = 'Python, SQL, Kubernetes, Docker, React, AWS, Terraform, PostgreSQL.';

test('a photographer is legible to the matcher', () => {
  const found = termsIn(PHOTOGRAPHER);
  // Not an exact list — the point is that the craft is visible, not that it
  // matches a snapshot that any sensible addition would break.
  assert.ok(found.length >= 8, `expected a photographer's craft to be visible, got: ${found.join(', ')}`);
  for (const term of ['lightroom', 'photoshop', 'photojournalism', 'retouching', 'videography']) {
    assert.ok(found.includes(term), `"${term}" should be recognised`);
  }
});

test('adding a domain did not disturb the existing one', () => {
  const found = termsIn(DEVELOPER);
  assert.deepEqual(
    [...found].sort(),
    ['aws', 'docker', 'kubernetes', 'postgresql', 'python', 'react', 'sql', 'terraform'].sort(),
  );
});

test('the words deliberately left out stay out', () => {
  // Each of these fires constantly on postings that have nothing to do with
  // visual media, which is why the vocabulary does not carry them. A future
  // "just add camera" would make every computer-vision role a photography one.
  const backend = 'Camera calibration service in a studio environment. Print logs, '
    + 'edit configs, compose services. Shoot me a message. Lighting-fast latency.';
  const found = termsIn(backend);
  for (const bad of ['camera', 'studio', 'print', 'editing', 'composition', 'lighting']) {
    assert.ok(!found.includes(bad), `"${bad}" is too generic to be in the vocabulary`);
  }
});

test('multi-word craft terms are not eaten by their shorter halves', () => {
  // SORTED_VOCAB is length-ordered for exactly this. "colour grading" must not
  // be consumed by a bare "colour", and "portrait photography" must survive
  // alongside "photography".
  assert.ok(termsIn('We need colour grading and studio lighting').includes('colour grading'));
  assert.ok(termsIn('Portrait photography for editorial').includes('portrait photography'));
});

test('both spellings of colour grading are understood', () => {
  // The product indexes worldwide postings; a US posting writes "color".
  assert.ok(termsIn('color grading in DaVinci').includes('color grading'));
  assert.ok(termsIn('colour grading in DaVinci').includes('colour grading'));
});

test('a skill that ends a sentence is still a skill', () => {
  // Found while adding the media domain, and far older than it: the boundary
  // rule excluded `.` so that "node" could not match inside "node.js" — which
  // also meant a full stop *after* a term blocked it. "Python. Kubernetes.
  // Docker." matched nothing at all, and CVs are written in sentences.
  assert.deepEqual(
    [...termsIn('Python. Kubernetes. Docker.')].sort(),
    ['docker', 'kubernetes', 'python'],
  );
  assert.ok(termsIn('I use PostgreSQL.').includes('postgresql'));
  assert.ok(termsIn('Lightroom. Photoshop. Retouching.').includes('photoshop'));
});

test('dotted terms survive the fix that allowed full stops', () => {
  // The reason `.` was excluded in the first place. A dot followed by a word is
  // part of the term; a dot followed by anything else is punctuation.
  const dotted = termsIn('Built with Node.js and .NET');
  assert.ok(dotted.includes('node.js'), 'node.js must still match');
  assert.ok(dotted.includes('.net'), '.net must keep its leading dot');
  assert.ok(!dotted.includes('node'), '"node" must not match inside "node.js"');
  assert.ok(termsIn('Experience with ci/cd and c++.').includes('c++'));
});
