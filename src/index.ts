/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.json`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { XMLParser } from 'fast-xml-parser';

export interface Env {
	RSS_URL?: string;
	MASUDA_URL?: string;
	MISSKEY_HOST: string;
	MISSKEY_TOKEN: string;
	POSTED_ITEMS: KVNamespace;
	SYNC_LOCK: DurableObjectNamespace;
}

const LOCK_NAME = 'rss-sync-lock';
const POSTED_KEY_PREFIX = 'posted:';
const RSS_FETCH_USER_AGENT = 'Mozilla/5.0 (compatible; nagoya-city-notice-bot/1.0; +https://github.com/jj1guj/nagoya-city-notice-bot)';

export interface RssItem {
	title: string;
	link: string;
	description?: string;
	pubDate?: string;
}

export function normalizeItems(parsed: unknown): RssItem[] {
	const data = parsed as {
		rss?: {
			channel?: {
				item?: RssItem | RssItem[];
			};
		};
	};
	const rawItems = data.rss?.channel?.item;
	if (!rawItems) {
		return [];
	}
	return Array.isArray(rawItems) ? rawItems : [rawItems];
}

export function buildNoteText(item: RssItem): string {
	const description = (item.description ?? '').trim();
	if (description.length > 0) {
		return `【名古屋市お知らせ】\n${item.title}\n\n${description}\n${item.link}`;
	}
	return `【名古屋市お知らせ】\n${item.title}\n${item.link}`;
}

export function getItemStorageKey(item: RssItem): string {
	return `${POSTED_KEY_PREFIX}${encodeURIComponent(item.link)}`;
}

export function buildRssRequestHeaders(): HeadersInit {
	return {
		Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
		'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
		'Cache-Control': 'no-cache',
		'User-Agent': RSS_FETCH_USER_AGENT,
	};
}

function toComparableDate(pubDate: string | undefined): number {
	if (!pubDate) {
		return 0;
	}
	const timestamp = new Date(pubDate).getTime();
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

async function fetchFeedItems(env: Env): Promise<RssItem[]> {
	try {
		const feedUrl = env.RSS_URL ?? env.MASUDA_URL;
		if (!feedUrl) {
			throw new Error('RSS_URL or MASUDA_URL is required');
		}
		const response = await fetch(feedUrl, {
			headers: buildRssRequestHeaders(),
		});
		if (!response.ok) {
			const errorBody = (await response.text()).slice(0, 500);
			throw new Error(`Failed to fetch RSS: ${response.status} ${errorBody}`.trim());
		}
		const xmlText = await response.text();
		const parser = new XMLParser();
		const parsed = parser.parse(xmlText);
		const items = normalizeItems(parsed)
			.filter((item) => item.title && item.link)
			.sort((a, b) => toComparableDate(a.pubDate) - toComparableDate(b.pubDate));
		return items;
	} catch (error) {
		console.error('Error fetching RSS feed:', error);
		return [];
	}
}


async function postNewArticle(env: Env, item: RssItem): Promise<boolean> {
	const postString = buildNoteText(item);
	const response = await fetch(`https://${env.MISSKEY_HOST}/api/notes/create`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.MISSKEY_TOKEN}`
		},
		body: JSON.stringify({
			visibility: 'public',
			cw: null,
			localOnly: false,
			reactionAcceptance: null,
			noExtractMentions: false,
			noExtractHashtags: false,
			noExtractEmojis: false,
			replyId: null,
			renoteId: null,
			channelId: null,
			text: postString,
		})
	});

	if (!response.ok) {
		const body = await response.text();
		console.error('Failed to post note:', response.status, body);
		return false;
	}

	return true;
}

async function syncFeed(env: Env): Promise<void> {
	const items = await fetchFeedItems(env);
	let postedCount = 0;

	for (const item of items) {
		const storageKey = getItemStorageKey(item);
		const isPosted = await env.POSTED_ITEMS.get(storageKey);
		if (isPosted) {
			continue;
		}

		const isSuccess = await postNewArticle(env, item);
		if (!isSuccess) {
			continue;
		}

		await env.POSTED_ITEMS.put(storageKey, new Date().toISOString());
		postedCount += 1;
	}

	console.log(`Sync completed. postedCount=${postedCount}`);
}

export class SyncLock {
	private isRunning = false;

	constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== 'POST') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		if (this.isRunning) {
			console.log('Sync already running; skipping duplicate trigger.');
			return new Response('Already running', { status: 202 });
		}

		this.isRunning = true;
		try {
			await syncFeed(this.env);
		} finally {
			this.isRunning = false;
		}

		return new Response('OK', { status: 200 });
	}
}

export default {
	async scheduled(controller, env, ctx): Promise<void> {
		console.log('Scheduled task started');
		const id = env.SYNC_LOCK.idFromName(LOCK_NAME);
		const stub = env.SYNC_LOCK.get(id);
		await stub.fetch('https://sync-lock/run', { method: 'POST' });
	},
	async fetch(request, env, ctx): Promise<Response> {
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
