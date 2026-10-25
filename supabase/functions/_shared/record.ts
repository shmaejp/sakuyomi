// 記録処理関数（主なシーム）。録音・写真を受け取り、同期で次の順に処理して、要約を応答として返す。
// 1. 正本（音声・写真）と記録を保存する 2. 文字起こしする（写真だけなら省く） 3. 構造化する 4. AI の版と計測を保存する 5. 要約を返す
// 記録を保存すると、出来事「記録」も DB のトリガーで残る。
// DB には、呼び出したメンバーの権限で書き込み、RLS を効かせる。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/lib/database.types.ts";
import { farmDateOf } from "./dates.ts";
import {
	type Ground,
	isPhotoType,
	type Link,
	type Material,
	type Registered,
	type RegisteredVariety,
	type StructuredItem,
	type Structurer,
	type Transcriber,
} from "./parts.ts";

type Client = SupabaseClient<Database>;

export type RecordDeps = {
	supabaseUrl: string;
	anonKey: string;
	transcribe: Transcriber;
	structure: Structurer;
};

/** 結びついた圃場・作目・品種。id が null なら未確定で、name は話の中の言い方。 */
type Named = { id: string | null; name: string };

/** 判断の根拠。observation は同じ要約の中の観察の位置で、文章だけの根拠なら null。text はどちらでも入る。 */
type SummaryGround = { observation: number | null; text: string };

export type SummaryItem = {
	text: string;
	/** 実施日（YYYY-MM-DD）。 */
	performedOn: string;
	fields: Named[];
	crops: Named[];
	varieties: Named[];
} & (
	| { kind: "observation" }
	| {
			kind: "judgment";
			judge: { id: string; name: string };
			grounds: SummaryGround[];
	  }
	| { kind: "work"; materials: Material[] }
);

export type RecordSummary = {
	recordId: string;
	versionId: string;
	/** 写真だけの記録では null。 */
	transcript: string | null;
	items: SummaryItem[];
};

// 構造化（Claude）に渡せる写真の大きさ。Claude は base64 にして 5MB までなので、元の大きさで 3.75MB まで。
// PWA は長い辺を縮めた JPEG にしてから送るので、ふつうはこれよりずっと小さい。
const MAX_PHOTO_BYTES = (5 * 1024 * 1024 * 3) / 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleRecordRequest(
	request: Request,
	deps: RecordDeps,
): Promise<Response> {
	const started = performance.now();
	const authorization = request.headers.get("Authorization");
	if (!authorization?.startsWith("Bearer "))
		return error(401, "ログインしてください");

	const input = await parseInput(request);
	if (typeof input === "string") return error(400, input);

	const client = createClient<Database>(deps.supabaseUrl, deps.anonKey, {
		global: { headers: { Authorization: authorization } },
		auth: { persistSession: false, autoRefreshToken: false },
	});
	const token = authorization.slice("Bearer ".length);
	const { data: user } = await client.auth.getUser(token);
	if (!user.user) return error(401, "ログインしてください");

	const member = await findMember(client, user.user.id);
	if (!member) return error(403, "どの農場にも登録されていません");
	const farm = await loadRegistered(client, member.farmId);

	// 1. 正本と記録を保存する
	const folder = `${member.farmId}/${input.recordId}`;
	const audio = input.audio && { path: `${folder}/audio`, file: input.audio };
	const photos = input.photos.map((file, i) => ({
		path: `${folder}/photos/${i}`,
		file,
	}));
	await Promise.all(
		[...(audio ? [audio] : []), ...photos].map(({ path, file }) =>
			saveOriginal(client, path, file),
		),
	);
	const inserted = await client.from("records").insert({
		id: input.recordId,
		farm_id: member.farmId,
		recorder_member_id: member.id,
		recorded_at: input.recordedAt,
		audio_path: audio?.path ?? null,
		photo_paths: photos.map((photo) => photo.path),
	});
	if (inserted.error) throw inserted.error;

	// 2. 文字起こしする（写真だけの記録では呼ばない）
	const transcribing = performance.now();
	const transcription = input.audio
		? await deps.transcribe({
				audio: input.audio,
				vocabulary: vocabularyOf(farm),
			})
		: null;
	const transcript = transcription?.text ?? null;

	// 3. 構造化する
	const structuring = performance.now();
	const extracted = await deps.structure({
		transcript,
		photos: input.photos,
		recordedAt: input.recordedAt,
		recorderId: member.id,
		fields: farm.fields,
		crops: farm.crops,
		varieties: farm.varieties,
		members: farm.members,
	});
	const structured = performance.now();
	const { usage } = extracted;
	// 写真だけの記録から取り出すのは観察だけ。構造化の部品にも頼んであるが、ここでも守る。
	const items =
		transcript === null
			? extracted.items.filter((item) => item.kind === "observation")
			: extracted.items;
	// 構造化の部品が省いたときの既定。実施日は記録日時の日付、判断者は記録者。
	const defaults: Defaults = {
		performedOn: farmDateOf(input.recordedAt),
		judgeId: member.id,
	};

	// 4. AI の版を、計測と一緒に保存する
	const saved = await client.rpc("save_ai_version", {
		target_record_id: input.recordId,
		...(transcript === null ? {} : { transcript }),
		items: items.map((item) => ({
			kind: item.kind,
			body: item.text,
			performed_on: item.performedOn ?? defaults.performedOn,
			fields: item.fields.map(toLinkRow),
			crops: item.crops.map(toLinkRow),
			varieties: (item.varieties ?? []).map(toLinkRow),
			...(item.kind === "judgment" && {
				judge_member_id: item.judgeId ?? defaults.judgeId,
				grounds: (item.grounds ?? []).map(toGroundRow),
			}),
			...(item.kind === "work" && { materials: item.materials ?? [] }),
		})),
		metrics: {
			transcription_seconds: transcription
				? seconds(transcribing, structuring)
				: null,
			structuring_seconds: seconds(structuring, structured),
			seconds_before_save: seconds(started, performance.now()),
			input_tokens: usage.inputTokens,
			output_tokens: usage.outputTokens,
			transcription_cost_usd: transcription?.costUsd ?? null,
		},
	});
	if (saved.error) throw saved.error;

	// 5. 要約を返す
	const summary: RecordSummary = {
		recordId: input.recordId,
		versionId: saved.data,
		transcript,
		items: items.map((item) => summaryItem(item, items, farm, defaults)),
	};
	return Response.json(summary);
}

type Input = {
	recordId: string;
	recordedAt: string;
	audio: Blob | null;
	photos: Blob[];
};

async function parseInput(request: Request): Promise<Input | string> {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return "記録は multipart/form-data で送ってください";
	}
	const recordId = form.get("recordId");
	const recordedAt = form.get("recordedAt");
	const audio = form.get("audio");
	if (typeof recordId !== "string" || !UUID.test(recordId))
		return "recordId には UUID を入れてください";
	if (typeof recordedAt !== "string" || Number.isNaN(Date.parse(recordedAt)))
		return "recordedAt には日時を入れてください";
	const photos = form
		.getAll("photos")
		.filter((photo): photo is File => photo instanceof Blob && photo.size > 0);
	const hasAudio = audio instanceof Blob && audio.size > 0;
	if (!hasAudio && photos.length === 0) return "音声も写真もありません";
	if (photos.some((photo) => !isPhotoType(photo.type)))
		return "写真は JPEG・PNG・WebP・GIF で送ってください";
	if (photos.some((photo) => photo.size > MAX_PHOTO_BYTES))
		return "写真が大きすぎます";
	return {
		recordId,
		recordedAt: new Date(recordedAt).toISOString(),
		audio: hasAudio ? audio : null,
		photos,
	};
}

/** 正本をストレージに置く。正本は書き換えないので、同じパスへの上書きはしない。 */
async function saveOriginal(client: Client, path: string, file: Blob) {
	const { error } = await client.storage.from("originals").upload(path, file, {
		contentType: file.type || "application/octet-stream",
		upsert: false,
	});
	if (error) throw error;
}

/** ログイン中の人の、離れていない農場メンバーとしての行。複数あれば最初に入った農場。 */
async function findMember(client: Client, userId: string) {
	const { data, error } = await client
		.from("farm_members")
		.select("id, farm_id")
		.eq("user_id", userId)
		.is("left_at", null)
		.order("created_at")
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return data && { id: data.id, farmId: data.farm_id };
}

/**
 * 文字起こし・構造化に渡す、農場の圃場（廃止されていないもの）・作目・品種・農場メンバー（離れていないもの）と、
 * 過去の作業に出た資材名。
 */
async function loadRegistered(client: Client, farmId: string) {
	const [fields, crops, varieties, members, materials] = await Promise.all([
		client
			.from("fields")
			.select("id, name, spoken_names")
			.eq("farm_id", farmId)
			.is("retired_at", null)
			.order("created_at"),
		client
			.from("crops")
			.select("id, name, spoken_names")
			.eq("farm_id", farmId)
			.order("created_at"),
		client
			.from("varieties")
			.select("id, name, spoken_names, crop_id")
			.eq("farm_id", farmId)
			.order("created_at"),
		client
			.from("farm_members")
			.select("id, display_name, spoken_names")
			.eq("farm_id", farmId)
			.is("left_at", null)
			.order("created_at"),
		client.from("work_materials").select("name").eq("farm_id", farmId),
	]);
	if (fields.error) throw fields.error;
	if (crops.error) throw crops.error;
	if (varieties.error) throw varieties.error;
	if (members.error) throw members.error;
	if (materials.error) throw materials.error;
	const toRegistered = (r: {
		id: string;
		name: string;
		spoken_names: string[];
	}): Registered => ({ id: r.id, name: r.name, spokenNames: r.spoken_names });
	return {
		fields: fields.data.map(toRegistered),
		crops: crops.data.map(toRegistered),
		varieties: varieties.data.map(
			(v): RegisteredVariety => ({ ...toRegistered(v), cropId: v.crop_id }),
		),
		members: members.data.map((m) =>
			toRegistered({ ...m, name: m.display_name }),
		),
		materialNames: materials.data.map((m) => m.name),
	};
}

type Farm = Awaited<ReturnType<typeof loadRegistered>>;

function vocabularyOf(farm: Farm) {
	const words = [...farm.fields, ...farm.crops, ...farm.varieties].flatMap(
		(r) => [r.name, ...r.spokenNames],
	);
	return [...new Set([...words, ...farm.materialNames])];
}

function toLinkRow(link: Link) {
	return "id" in link ? { id: link.id } : { spoken_as: link.spokenAs };
}

function toGroundRow(ground: Ground) {
	return "observation" in ground
		? { observation: ground.observation }
		: { body: ground.text };
}

type Defaults = { performedOn: string; judgeId: string };

function summaryItem(
	item: StructuredItem,
	items: StructuredItem[],
	farm: Farm,
	defaults: Defaults,
): SummaryItem {
	const base = {
		text: item.text,
		performedOn: item.performedOn ?? defaults.performedOn,
		fields: item.fields.map((link) => named(link, farm.fields)),
		crops: item.crops.map((link) => named(link, farm.crops)),
		varieties: (item.varieties ?? []).map((link) =>
			named(link, farm.varieties),
		),
	};
	if (item.kind === "observation") return { ...base, kind: "observation" };
	if (item.kind === "work")
		return { ...base, kind: "work", materials: item.materials ?? [] };
	const judgeId = item.judgeId ?? defaults.judgeId;
	return {
		...base,
		kind: "judgment",
		judge: {
			id: judgeId,
			name: farm.members.find((m) => m.id === judgeId)?.name ?? "",
		},
		grounds: (item.grounds ?? []).map((ground) =>
			"observation" in ground
				? {
						observation: ground.observation,
						text: items[ground.observation]?.text ?? "",
					}
				: { observation: null, text: ground.text },
		),
	};
}

function named(link: Link, registered: Registered[]): Named {
	if (!("id" in link)) return { id: null, name: link.spokenAs };
	const found = registered.find((r) => r.id === link.id);
	return { id: link.id, name: found?.name ?? "" };
}

/** performance.now() の 2 つの値の間の秒数。 */
function seconds(from: number, to: number) {
	return (to - from) / 1000;
}

function error(status: number, message: string) {
	return Response.json({ error: message }, { status });
}
