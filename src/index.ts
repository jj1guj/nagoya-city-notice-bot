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
}

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

export function isRecentlyPublished(pubDate: string | undefined, now: Date): boolean {
	if (!pubDate) {
		return false;
	}
	const publishedAt = new Date(pubDate);
	if (Number.isNaN(publishedAt.getTime())) {
		return false;
	}
	const diffMs = now.getTime() - publishedAt.getTime();
	return diffMs >= 0 && diffMs <= 2 * 60 * 1000;
}

export function buildNoteText(item: RssItem): string {
	const description = (item.description ?? '').trim();
	if (description.length > 0) {
		return `【名古屋市お知らせ】\n${item.title}\n\n${description}\n${item.link}`;
	}
	return `【名古屋市お知らせ】\n${item.title}\n${item.link}`;
}

async function fetchNewArticle(env: Env): Promise<RssItem[]> {
	try {
		const feedUrl = env.RSS_URL ?? env.MASUDA_URL;
		if (!feedUrl) {
			throw new Error('RSS_URL or MASUDA_URL is required');
		}
		const response = await fetch(feedUrl);
		if (!response.ok) {
			throw new Error(`Failed to fetch RSS: ${response.status}`);
		}
		const xmlText = await response.text();
		const parser = new XMLParser();
		const parsed = parser.parse(xmlText);
		const now = new Date();
		const items = normalizeItems(parsed)
			.filter((item) => item.title && item.link)
			.filter((item) => isRecentlyPublished(item.pubDate, now))
			.sort((a, b) => new Date(a.pubDate ?? 0).getTime() - new Date(b.pubDate ?? 0).getTime());
		return items;
	} catch (error) {
		console.error('Error fetching RSS feed:', error);
		return [];
	}
}


async function postNewArticle(env: Env, items: RssItem[]): Promise<void> {
	for (let item of items) {
		const postString = buildNoteText(item);
		await fetch(`https://${env.MISSKEY_HOST}/api/notes/create`, {
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
	}
}

export default {
	async scheduled(controller, env, ctx): Promise<void> {
		console.log('Scheduled task started');
		const items = await fetchNewArticle(env);
		await postNewArticle(env, items);
	},
	async fetch(request, env, ctx): Promise<Response> {
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
