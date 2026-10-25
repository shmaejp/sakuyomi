// 本物の構造化（Claude）・文字起こしを呼んで、決められた形で返ることを確かめる。API を呼ぶので料金がかかる。
// `npm run test:live` で手動で走らせる（`npm test` では走らない）。鍵や録音がなければ、そのテストは飛ばす。
// 構造化の質はここでは見ない（評価用の記録集で確かめる）。
import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { claudeStructurer } from "../../supabase/functions/_shared/claude-structurer.ts";
import { openAiTranscriber } from "../../supabase/functions/_shared/openai-transcriber.ts";
import type { StructuringInput } from "../../supabase/functions/_shared/parts.ts";

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const openAiKey = process.env.OPENAI_API_KEY;
const audioPath = process.env.SAKUYOMI_LIVE_AUDIO;

const farm = {
	recorderId: "member-me",
	fields: [
		{ id: "field-1", name: "1番ハウス", spokenNames: ["手前のハウス"] },
		{ id: "field-3", name: "3番ハウス", spokenNames: ["奥のハウス"] },
	],
	crops: [{ id: "crop-tomato", name: "トマト", spokenNames: [] }],
	varieties: [
		{
			id: "variety-momotaro",
			name: "桃太郎",
			spokenNames: [],
			cropId: "crop-tomato",
		},
	],
	members: [
		{ id: "member-me", name: "前田晋弥", spokenNames: ["自分"] },
		{ id: "member-father", name: "前田父", spokenNames: ["父", "親父"] },
	],
	nearbyFields: [],
} satisfies Omit<StructuringInput, "transcript" | "photos" | "recordedAt">;

describe.skipIf(!anthropicKey)("構造化の本物（Claude）", () => {
	const structure = claudeStructurer(anthropicKey ?? "");

	it("文字起こしから、登録した圃場・作目に結びついた取り出しとトークン数を返す", async () => {
		const { items, usage } = await structure({
			...farm,
			transcript:
				"奥のハウスのトマト、下の葉が黄色くなってきた。父が言うには肥料切れだから、明日追肥する。",
			photos: [],
			recordedAt: "2026-10-25T08:30:00+09:00",
		});

		expect(items.length).toBeGreaterThan(0);
		for (const item of items) {
			expect(["observation", "judgment", "work"]).toContain(item.kind);
			expect(item.text.trim()).not.toBe("");
		}
		expect(items.flatMap((item) => item.fields)).toContainEqual({
			id: "field-3",
		});
		expect(items.flatMap((item) => item.crops)).toContainEqual({
			id: "crop-tomato",
		});
		expect(usage.inputTokens).toBeGreaterThan(0);
		expect(usage.outputTokens).toBeGreaterThan(0);
	});

	it("写真だけの記録からは、観察だけを返す", async () => {
		const { items, usage } = await structure({
			...farm,
			transcript: null,
			photos: [greenSquare()],
			recordedAt: "2026-10-25T08:30:00+09:00",
		});

		for (const item of items) expect(item.kind).toBe("observation");
		expect(usage.inputTokens).toBeGreaterThan(0);
	});
});

describe.skipIf(!openAiKey || !audioPath)("文字起こしの本物", () => {
	const transcribe = openAiTranscriber(openAiKey ?? "");

	it("録音から、文章と料金を返す", async () => {
		const path = audioPath ?? "";
		const audio = new Blob([readFileSync(path)], { type: audioTypeOf(path) });
		const { text, costUsd } = await transcribe({
			audio,
			vocabulary: [
				...farm.fields.flatMap((f) => [f.name, ...f.spokenNames]),
				...farm.crops.map((c) => c.name),
			],
		});

		expect(text.trim()).not.toBe("");
		expect(costUsd).toBeGreaterThan(0);
	});
});

function audioTypeOf(path: string) {
	if (/\.(m4a|mp4)$/i.test(path)) return "audio/mp4";
	if (/\.ogg$/i.test(path)) return "audio/ogg";
	if (/\.wav$/i.test(path)) return "audio/wav";
	if (/\.mp3$/i.test(path)) return "audio/mpeg";
	return "audio/webm";
}

/** 64px 四方の緑一色の PNG。写真だけの記録の写真の代わりにする。 */
function greenSquare(): Blob {
	const size = 64;
	const row = Buffer.from([0, ...Array(size).fill([70, 130, 60]).flat()]);
	const pixels = Buffer.concat(Array(size).fill(row));
	const chunk = (type: string, data: Buffer) => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([length, body, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header.set([8, 2, 0, 0, 0], 8); // 8 ビット・RGB
	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]);
	return new Blob([png], { type: "image/png" });
}
