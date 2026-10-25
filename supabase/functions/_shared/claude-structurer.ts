// 構造化の本物の部品。Claude Opus 5.5 を effort low で呼び、決められた形（スキーマ）で取り出しを受け取る。
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { farmDateTimeOf } from "./dates.ts";
import {
	type Ground,
	isPhotoType,
	type Link,
	type Registered,
	type StructuredItem,
	type Structurer,
} from "./parts.ts";

const MODEL = "claude-opus-5-5";

const LinkSchema = z.object({
	registered: z
		.string()
		.nullable()
		.describe(
			"登録の一覧にある記号（F1・C1・V1 など）。登録にないものなら null",
		),
	spoken_as: z.string().describe("話の中での言い方"),
});

const OutputSchema = z.object({
	items: z.array(
		z.object({
			kind: z.enum(["observation", "judgment", "work"]),
			text: z
				.string()
				.describe("取り出した内容を、話した人の言葉に近い短い文で"),
			performed_on: z
				.string()
				.nullable()
				.describe(
					"話から読み取れる実施日（YYYY-MM-DD）。読み取れなければ null",
				),
			fields: z.array(LinkSchema),
			crops: z.array(LinkSchema),
			varieties: z.array(LinkSchema),
			judge: z
				.string()
				.nullable()
				.describe(
					"判断のときだけ：判断者の農場メンバーの記号（M1 など）。記録者なら null。判断以外は null",
				),
			grounds: z
				.array(
					z.object({
						observation: z
							.number()
							.nullable()
							.describe(
								"同じ記録の観察を根拠にするなら、その観察の items の位置（0 から）。文章だけの根拠なら null",
							),
						text: z.string().describe("根拠の内容"),
					}),
				)
				.describe("判断のときだけ：判断の根拠。判断以外は空"),
			materials: z
				.array(
					z.object({
						name: z.string().describe("資材の名前"),
						amount: z
							.string()
							.nullable()
							.describe("量を話されたままに（200リットルなど）。なければ null"),
						dilution: z
							.string()
							.nullable()
							.describe("倍率を話されたままに（1000倍など）。なければ null"),
					}),
				)
				.describe(
					"作業のときだけ：使った資材（混ぜたなら資材ごと）。作業以外は空",
				),
		}),
	),
});

type Output = z.infer<typeof OutputSchema>;

const SYSTEM = `あなたは、家族農場の農家が畑でスマホに話した・撮った記録を整理する係です。
文字起こしと写真から、観察・判断・作業を取り出し、それぞれをどの圃場・作目・品種の話かに結びつけます。

- observation（観察）：作物や圃場の状態についての気づき
- judgment（判断）：栽培について決めたこと（やらないと決めたことも含む）
- work（作業）：実施したこと
- 1 つの作業や判断が複数の圃場・作目にまたがるときは、分けずに 1 つの取り出しにし、圃場・作目を複数結びつける
- 圃場・作目・品種は、登録の一覧の名前と呼び名を手がかりに結びつけ、registered に記号を入れる。一覧にない場所・作物・品種の話なら registered は null にする。推測で別のものに結びつけない
- 実施日：「昨日消毒した」なら記録日時の前日のように、話から読み取れる日を performed_on に入れる。読み取れなければ null
- 判断者：話した人（記録者）とは別の農場メンバーが決めたと読み取れれば、judge にそのメンバーの記号を入れる。記録者の判断なら null。農場の外の人（JA の指導員など）は判断者にせず、その助言を根拠にする
- 根拠：判断の理由として話されたことを grounds に入れる。同じ記録で取り出した観察が理由なら observation にその観察の位置を入れ、それ以外（外の人の助言、話された理由）は observation を null にして text に書く
- 資材：作業で使った資材を、資材ごとに名前・量・倍率で materials に入れる。量・倍率は話されたままに書き、話されなければ null
- 話されていないことは足さない。助言・提案・評価は書かない
- 疑問を口にしていても記録として扱い、読み取れる観察・判断・作業を取り出す
- 写真は、話の中の観察・判断・作業を補う手がかりとして見る
- 文字起こしがない（写真だけの）記録では、写真に写った作物や圃場の状態を observation（観察）としてだけ取り出す。judgment・work は取り出さない
- 聞き取れない、または取り出せるものがなければ items は空にする`;

export function claudeStructurer(apiKey: string): Structurer {
	const client = new Anthropic({ apiKey });
	return async (input) => {
		const { transcript, photos, recordedAt } = input;
		const fieldKeys = keyed("F", input.fields);
		const cropKeys = keyed("C", input.crops);
		const varietyKeys = keyed("V", input.varieties);
		const memberKeys = keyed("M", input.members);
		const cropName = (cropId: string) =>
			input.crops.find((c) => c.id === cropId)?.name;
		const recorder = input.members.find((m) => m.id === input.recorderId);
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
						...(await Promise.all(photos.map(imageBlock))),
						{
							type: "text",
							text: [
								`記録日時：${farmDateTimeOf(recordedAt)}（日本時間）`,
								`記録者：${recorder?.name ?? "（不明）"}`,
								`農場メンバーの登録：\n${listing(memberKeys)}`,
								`圃場の登録：\n${listing(fieldKeys)}`,
								`作目の登録：\n${listing(cropKeys)}`,
								`品種の登録：\n${listing(varietyKeys, (v) => {
									const crop = cropName(v.cropId);
									return crop ? `作目：${crop}` : undefined;
								})}`,
								`写真：${photos.length} 枚（撮った順）`,
								transcript === null
									? "文字起こし：なし（写真だけの記録）"
									: `文字起こし：\n${transcript}`,
							].join("\n\n"),
						},
					],
				},
			],
		});
		if (response.stop_reason === "refusal")
			throw new Error("構造化が断られました");
		const output = response.parsed_output;
		if (!output) throw new Error("構造化の出力を読めませんでした");

		return {
			items: toItems(output, { fieldKeys, cropKeys, varietyKeys, memberKeys }),
			usage: {
				inputTokens: response.usage.input_tokens,
				outputTokens: response.usage.output_tokens,
			},
		};
	};
}

type Keys = Record<
	"fieldKeys" | "cropKeys" | "varietyKeys" | "memberKeys",
	Map<string, Registered>
>;

/** Claude の出力を取り出しの一覧にする。中身のない取り出しは除き、根拠が指す観察の位置を詰め直す。 */
function toItems(output: Output, keys: Keys): StructuredItem[] {
	const kept = output.items.filter((item) => item.text.trim() !== "");
	const toLink =
		(registered: Map<string, Registered>) =>
		(link: z.infer<typeof LinkSchema>): Link => {
			const found = link.registered
				? registered.get(link.registered)
				: undefined;
			return found ? { id: found.id } : { spokenAs: link.spoken_as };
		};
	// 観察を指していない、または読み取れない根拠は、文章があれば文章だけの根拠にする。
	const toGround = (
		ground: Output["items"][number]["grounds"][number],
	): Ground | null => {
		const target =
			ground.observation === null
				? undefined
				: output.items[ground.observation];
		const position = target ? kept.indexOf(target) : -1;
		if (position >= 0 && target?.kind === "observation")
			return { observation: position };
		return ground.text.trim() === "" ? null : { text: ground.text };
	};

	return kept.map((item): StructuredItem => {
		const base = {
			text: item.text,
			fields: item.fields.map(toLink(keys.fieldKeys)),
			crops: item.crops.map(toLink(keys.cropKeys)),
			varieties: item.varieties.map(toLink(keys.varietyKeys)),
			...(isDate(item.performed_on) && { performedOn: item.performed_on }),
		};
		if (item.kind === "judgment") {
			const judge = item.judge ? keys.memberKeys.get(item.judge) : undefined;
			return {
				...base,
				kind: "judgment",
				...(judge && { judgeId: judge.id }),
				grounds: item.grounds.map(toGround).filter((ground) => ground !== null),
			};
		}
		if (item.kind === "work")
			return {
				...base,
				kind: "work",
				materials: item.materials
					.filter((m) => m.name.trim() !== "")
					.map((m) => ({
						name: m.name,
						amount: m.amount?.trim() || null,
						dilution: m.dilution?.trim() || null,
					})),
			};
		return { ...base, kind: "observation" };
	});
}

/** YYYY-MM-DD の形の、実在する日付かどうか。 */
function isDate(value: string | null): value is string {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** UUID の代わりに短い記号（F1, F2, …）で Claude に渡す。 */
function keyed<T extends Registered>(prefix: string, registered: T[]) {
	return new Map(registered.map((r, i) => [`${prefix}${i + 1}`, r]));
}

function listing<T extends Registered>(
	keys: Map<string, T>,
	note: (r: T) => string | undefined = () => undefined,
) {
	if (keys.size === 0) return "（なし）";
	return [...keys]
		.map(([key, r]) => {
			const notes = [
				note(r),
				r.spokenNames.length > 0
					? `呼び名：${r.spokenNames.join("、")}`
					: undefined,
			].filter((n) => n !== undefined);
			return notes.length > 0
				? `${key}：${r.name}（${notes.join("、")}）`
				: `${key}：${r.name}`;
		})
		.join("\n");
}

/** 写真を Claude に渡す画像のブロックにする。形式はふつう記録処理関数で確かめてある。 */
async function imageBlock(photo: Blob) {
	const mediaType = photo.type;
	if (!isPhotoType(mediaType))
		throw new Error(`構造化に渡せない写真の形式です（${mediaType}）`);
	const bytes = new Uint8Array(await photo.arrayBuffer());
	// String.fromCharCode に一度に渡せる引数の数には上限があるので、区切って変換する。
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return {
		type: "image" as const,
		source: {
			type: "base64" as const,
			media_type: mediaType,
			data: btoa(binary),
		},
	};
}
