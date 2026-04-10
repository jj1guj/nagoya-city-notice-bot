// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { XMLParser } from 'fast-xml-parser';
import { buildNoteText, buildRssRequestHeaders, getPendingItems, normalizeItems } from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Nagoya news worker', () => {
	it('responds with 404 (unit style)', async () => {
		const request = new IncomingRequest('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const unitEnv = env as unknown as Parameters<typeof worker.fetch>[1];
		const response = await worker.fetch(request, unitEnv, ctx);
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

	it('collects pending items after the latest seen link', () => {
		const pendingItems = getPendingItems(
			[
				{ title: 'D', link: 'https://example.com/d' },
				{ title: 'C', link: 'https://example.com/c' },
				{ title: 'B', link: 'https://example.com/b' },
				{ title: 'A', link: 'https://example.com/a' },
			],
			'https://example.com/a'
		);
		expect(pendingItems.map((item) => item.title)).toEqual(['B', 'C', 'D']);
	});

	it('returns no backlog when latest seen link is not initialized', () => {
		const pendingItems = getPendingItems(
			[{ title: 'A', link: 'https://example.com/a' }],
			null
		);
		expect(pendingItems).toEqual([]);
	});

	it('builds rss fetch headers for stricter endpoints', () => {
		const headers = buildRssRequestHeaders() as Record<string, string>;
		expect(headers.Accept).toContain('application/rss+xml');
		expect(headers['Accept-Language']).toContain('ja');
		expect(headers['Cache-Control']).toBe('no-cache');
		expect(headers['User-Agent']).toContain('nagoya-city-notice-bot');
	});
});
