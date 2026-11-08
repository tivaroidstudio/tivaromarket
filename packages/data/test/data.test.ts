import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, resample, onlyClosed, sourceStatus, redact, DEFAULT_UNIVERSE } from '../src/index.ts';

test('RSS and Atom parsing', () => {
  const rss = `<rss><channel><item><title><![CDATA[Fed holds rates &amp; signals cut]]></title><link>https://x.test/a</link>
    <pubDate>Sat, 08 Nov 2026 12:00:00 GMT</pubDate><description>&lt;p&gt;Statement text&lt;/p&gt;</description></item></channel></rss>`;
  const a = parseFeed(rss, 'Fed');
  assert.equal(a.length, 1);
  assert.equal(a[0].title, 'Fed holds rates & signals cut');
  assert.equal(a[0].ts, Date.parse('2026-11-08T12:00:00Z'));
  const atom = `<feed><entry><title>ECB decision</title><link href="https://ecb.test/x"/><updated>2026-11-07T10:00:00Z</updated></entry></feed>`;
  const b = parseFeed(atom, 'ECB');
  assert.equal(b[0].url, 'https://ecb.test/x');
});

test('resample 1h → 4h and 1d → 1w (Monday aligned)', () => {
  const H = 3_600_000;
  const hours = Array.from({ length: 8 }, (_, i) => ({ t: i * H, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 1 }));
  const four = resample(hours, '4h');
  assert.equal(four.length, 2);
  assert.deepEqual(four[0], { t: 0, o: 0, h: 4, l: -1, c: 3.5, v: 4 });
  const D = 86_400_000;
  const monday = Date.parse('2026-11-02T00:00:00Z');
  const days = Array.from({ length: 10 }, (_, i) => ({ t: monday + i * D, o: 1, h: 2, l: 0, c: 1, v: 1 }));
  const weeks = resample(days, '1w');
  assert.equal(weeks[0].t, monday);
  assert.equal(weeks[0].v, 7);
});

test('only closed candles are kept', () => {
  const now = 10 * 3_600_000 + 5;
  const c = [{ t: 9 * 3_600_000, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: 10 * 3_600_000, o: 1, h: 1, l: 1, c: 1, v: 1 }];
  assert.equal(onlyClosed(c, '1h', now).length, 1);
});

test('source status reflects keys; secrets are redacted', () => {
  const s = sourceStatus({});
  assert.equal(s.find((x) => x.id === 'binance')?.available, true);
  assert.equal(s.find((x) => x.id === 'alpaca')?.available, false);
  assert.equal(redact('https://a.test/?symbol=X&token=abc&apikey=zzz'), 'https://a.test/?symbol=X&token=***&apikey=***');
  assert.ok(DEFAULT_UNIVERSE.length > 30);
  assert.equal(new Set(DEFAULT_UNIVERSE.map((i) => i.id)).size, DEFAULT_UNIVERSE.length);
});
