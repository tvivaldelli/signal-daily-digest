import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toUtcIso, normalizePubDate } from '../server/dateUtils.js';

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('toUtcIso', () => {
  it('converts an RFC-822 date with a numeric negative offset to UTC', () => {
    assert.equal(toUtcIso('Wed, 29 Apr 2026 14:30:00 -0400'), '2026-04-29T18:30:00.000Z');
  });

  it('converts an RFC-822 date with a +0000 offset to UTC', () => {
    assert.equal(toUtcIso('Sat, 11 Jul 2026 23:45:12 +0000'), '2026-07-11T23:45:12.000Z');
  });

  it('converts an RFC-822 date with a GMT zone name to UTC', () => {
    assert.equal(toUtcIso('Fri, 10 Jul 2026 08:00:00 GMT'), '2026-07-10T08:00:00.000Z');
  });

  it('converts an RFC-822 date with a US zone abbreviation (EDT) to UTC', () => {
    assert.equal(toUtcIso('Tue, 07 Jul 2026 09:15:00 EDT'), '2026-07-07T13:15:00.000Z');
  });

  it('passes an already-ISO UTC string through unchanged', () => {
    assert.equal(toUtcIso('2026-07-12T10:30:00.828Z'), '2026-07-12T10:30:00.828Z');
  });

  it('returns null for an unparseable string', () => {
    assert.equal(toUtcIso('not a date'), null);
  });

  it('returns null for empty, null, undefined, and non-string input', () => {
    assert.equal(toUtcIso(''), null);
    assert.equal(toUtcIso(null), null);
    assert.equal(toUtcIso(undefined), null);
    assert.equal(toUtcIso(1752316200000), null);
  });
});

describe('normalizePubDate', () => {
  it('prefers isoDate over pubDate when both are present', () => {
    const item = {
      isoDate: '2026-07-12T10:00:00.000Z',
      pubDate: 'Wed, 01 Jan 2020 00:00:00 GMT',
      title: 'Both dates',
    };
    assert.equal(normalizePubDate(item, 'TestSource'), '2026-07-12T10:00:00.000Z');
  });

  it('falls back to a validated pubDate parse when isoDate is missing', () => {
    const item = { pubDate: 'Wed, 29 Apr 2026 14:30:00 -0400', title: 'pubDate only' };
    assert.equal(normalizePubDate(item, 'TestSource'), '2026-04-29T18:30:00.000Z');
  });

  it('falls back to pubDate when isoDate is present but unparseable', () => {
    const item = {
      isoDate: 'garbage',
      pubDate: 'Fri, 10 Jul 2026 08:00:00 GMT',
      title: 'bad isoDate',
    };
    assert.equal(normalizePubDate(item, 'TestSource'), '2026-07-10T08:00:00.000Z');
  });

  it('falls back to now (valid UTC ISO-8601) when neither date parses', () => {
    const before = Date.now();
    const result = normalizePubDate({ isoDate: 'nope', pubDate: 'also nope', title: 'dateless' }, 'TestSource');
    const after = Date.now();

    assert.match(result, ISO_8601_UTC);
    const resultMs = Date.parse(result);
    assert.ok(resultMs >= before && resultMs <= after, 'fallback timestamp should be "now"');
  });

  it('falls back to now when both date fields are absent', () => {
    const result = normalizePubDate({ title: 'no dates at all' }, 'TestSource');
    assert.match(result, ISO_8601_UTC);
  });
});
