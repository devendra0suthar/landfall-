import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePostingUrl } from '../src/ingest/resolve.js';

/**
 * Identifying a posting from the page the candidate is on.
 *
 * Every URL here is a real shape taken from the index or from Greenhouse's own
 * embed documentation. The alternative to this parser is asking someone to
 * carry an internal id between two windows, so the bar is that it works on what
 * employers actually link to.
 */

test('reads the modern job-boards host', () => {
  assert.deepEqual(parsePostingUrl('https://job-boards.greenhouse.io/addepar1/jobs/8451871002'), {
    vendor: 'greenhouse', boardToken: 'addepar1', vendorJobId: '8451871002',
  });
});

test('reads the older boards host, with its duplicated id', () => {
  assert.deepEqual(parsePostingUrl('https://boards.greenhouse.io/figma/jobs/5711913004?gh_jid=5711913004'), {
    vendor: 'greenhouse', boardToken: 'figma', vendorJobId: '5711913004',
  });
});

test('reads the application page, which is where the extension actually runs', () => {
  const ref = parsePostingUrl('https://job-boards.greenhouse.io/addepar1/jobs/8451871002/application');
  assert.equal(ref?.vendorJobId, '8451871002');
});

test('reads the embedded form, where both parts are in the query', () => {
  assert.deepEqual(parsePostingUrl('https://boards.greenhouse.io/embed/job_app?for=figma&token=5711913004'), {
    vendor: 'greenhouse', boardToken: 'figma', vendorJobId: '5711913004',
  });
});

test('refuses a host it cannot read rather than guessing', () => {
  // Guessing here would send someone else's posting id to the planner and fill
  // a form with a plan for a different job.
  assert.equal(parsePostingUrl('https://www.linkedin.com/jobs/view/123'), null);
  assert.equal(parsePostingUrl('https://boards.greenhouse.io.evil.example/figma/jobs/1'), null);
  assert.equal(parsePostingUrl('not a url at all'), null);
});

test('refuses a greenhouse page that is not a posting', () => {
  assert.equal(parsePostingUrl('https://boards.greenhouse.io/figma'), null);
  assert.equal(parsePostingUrl('https://job-boards.greenhouse.io/'), null);
});
