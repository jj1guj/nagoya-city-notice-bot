// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { XMLParser } from 'fast-xml-parser';
import { buildNoteText, isRecentlyPublished, normalizeItems } from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Nagoya news worker', () => {
	it('responds with 404 (unit style)', async () => {
		const request = new IncomingRequest('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	it('responds with 404 (integration style)', async () => {
		const response = await SELF.fetch('https://example.com');
		expect(response.status).toBe(404);
		expect(await response.text()).toBe('Not Found');
	});

	it('parses rss/channel/item and builds note text', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
<item>
<title>テスト記事</title>
<link>https://www.city.nagoya.jp/test.html</link>
<description>説明文</description>
<pubDate>Sat, 11 Apr 2026 00:06:01 +0900</pubDate>
</item>
</channel>
</rss>`;
		const parser = new XMLParser();
		const parsed = parser.parse(xml);
		const items = normalizeItems(parsed);
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('テスト記事');
		expect(items[0].link).toBe('https://www.city.nagoya.jp/test.html');

		const text = buildNoteText(items[0]);
		expect(text).toContain('【名古屋市お知らせ】');
		expect(text).toContain('テスト記事');
		expect(text).toContain('https://www.city.nagoya.jp/test.html');
	});

	it('recognizes recently published items within 2 minutes', () => {
		const now = new Date('2026-04-11T00:07:00+09:00');
		expect(isRecentlyPublished('Sat, 11 Apr 2026 00:06:01 +0900', now)).toBe(true);
		expect(isRecentlyPublished('Sat, 11 Apr 2026 00:03:59 +0900', now)).toBe(false);
		expect(isRecentlyPublished(undefined, now)).toBe(false);
	});
});
