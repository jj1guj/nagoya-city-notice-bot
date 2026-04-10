// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { XMLParser } from 'fast-xml-parser';
import { buildNoteText, getItemStorageKey, normalizeItems } from '../src/index';

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

	it('creates stable storage key from item link', () => {
		const key = getItemStorageKey({
			title: 'テスト記事',
			link: 'https://www.city.nagoya.jp/test/path?a=1&b=2'
		});
		expect(key).toBe(
			'posted:https%3A%2F%2Fwww.city.nagoya.jp%2Ftest%2Fpath%3Fa%3D1%26b%3D2'
		);
	});
});
