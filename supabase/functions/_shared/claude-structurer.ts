// 構造化の本物の部品。Claude Opus 5.5 を effort low で呼び、決められた形（スキーマ）で取り出しを受け取る。
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Link, Registered, Structurer } from "./parts.ts";

const MODEL = "claude-opus-5-5";

const LinkSchema = z.object({
	registered: z
		.string()
		.nullable()
		.describe("登録の一覧にある記号（F1・C1 など）。登録にないものなら null"),
	spoken_as: z.string().describe("話の中での言い方"),
});

const OutputSchema = z.object({
	items: z.array(
		z.object({
			kind: z.enum(["observation", "judgment", "work"]),
			text: z
				.string()
				.describe("取り出した内容を、話した人の言葉に近い短い文で"),
			fields: z.array(LinkSchema),
			crops: z.array(LinkSchema),
		}),
	),
});

const SYSTEM = `あなたは、家族農場の農家が畑でスマホに話した記録を整理する係です。
文字起こしから、観察・判断・作業を取り出し、それぞれをどの圃場・作目の話かに結びつけます。

- observation（観察）：作物や圃場の状態についての気づき
- judgment（判断）：栽培について決めたこと（やらないと決めたことも含む）
- work（作業）：実施したこと
- 1 つの作業や判断が複数の圃場・作目にまたがるときは、分けずに 1 つの取り出しにし、圃場・作目を複数結びつける
- 圃場・作目は、登録の一覧の名前と呼び名を手がかりに結びつけ、registered に記号を入れる。一覧にない場所・作物の話なら registered は null にする。推測で別のものに結びつけない
- 話されていないことは足さない。助言・提案・評価は書かない
- 疑問を口にしていても記録として扱い、読み取れる観察・判断・作業を取り出す
- 聞き取れない、または取り出せるものがなければ items は空にする`;

export function claudeStructurer(apiKey: string): Structurer {
	const client = new Anthropic({ apiKey });
	return async ({ transcript, recordedAt, fields, crops }) => {
		const fieldKeys = keyed("F", fields);
		const cropKeys = keyed("C", crops);
		const response = await client.beta.messages.parse({
			model: MODEL,
			max_tokens: 16000,
			betas: ["server-side-fallback-2026-07-01"],
			fallbacks: "default",
			output_config: {
				effort: "low",
				format: betaZodOutputFormat(OutputSchema),
			},
			system: SYSTEM,
			messages: [
				{
					role: "user",
					content: [
						`記録日時：${recordedAt}`,
						`圃場の登録：\n${listing(fieldKeys)}`,
						`作目の登録：\n${listing(cropKeys)}`,
						`文字起こし：\n${transcript}`,
					].join("\n\n"),
				},
			],
		});
		if (response.stop_reason === "refusal")
			throw new Error("構造化が断られました");
		const output = response.parsed_output;
		if (!output) throw new Error("構造化の出力を読めませんでした");

		const toLink =
			(keys: Map<string, Registered>) =>
			(link: z.infer<typeof LinkSchema>): Link => {
				const found = link.registered ? keys.get(link.registered) : undefined;
				return found ? { id: found.id } : { spokenAs: link.spoken_as };
			};
		return {
			items: output.items
				.filter((item) => item.text.trim() !== "")
				.map((item) => ({
					kind: item.kind,
					text: item.text,
					fields: item.fields.map(toLink(fieldKeys)),
					crops: item.crops.map(toLink(cropKeys)),
				})),
		};
	};
}

/** UUID の代わりに短い記号（F1, F2, …）で Claude に渡す。 */
function keyed(prefix: string, registered: Registered[]) {
	return new Map(registered.map((r, i) => [`${prefix}${i + 1}`, r]));
}

function listing(keys: Map<string, Registered>) {
	if (keys.size === 0) return "（なし）";
	return [...keys]
		.map(([key, r]) =>
			r.spokenNames.length > 0
				? `${key}：${r.name}（呼び名：${r.spokenNames.join("、")}）`
				: `${key}：${r.name}`,
		)
		.join("\n");
}
