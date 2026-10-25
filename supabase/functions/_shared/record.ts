// 記録処理関数（主なシーム）。録音・写真を受け取り、同期で次の順に処理して、要約を応答として返す。
// 1. 正本（音声・写真）と記録を保存する 2. 文字起こしする（写真だけなら省く） 3. 構造化する 4. AI の版と計測を保存する 5. 要約を返す
// 記録を保存すると、出来事「記録」も DB のトリガーで残る。
// DB には、呼び出したメンバーの権限で書き込み、RLS を効かせる。
//
// 同じ記録 ID で何度呼ばれても結果が同じになるようにする（圏外の送信待ちから送り直されるため）。
// - 版のある記録なら、処理し直さず、その版の要約を返す
// - 記録だけがあって版のない記録（前回の処理が途中で失敗したもの）なら、正本から文字起こしをやり直す
// - 正本は二重に保存しない
// 記録を保存した後に文字起こし・構造化・版の保存に失敗したら、記録は残したまま「保存したが要約はない」を返す。
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

/**
 * 記録処理関数の応答。どちらも、記録を受け取ったことを表す（送信待ちの列から消してよい）。
 * saved は「記録は保存したが要約はない」。同じ記録 ID で送り直すと、要約を作り直す。
 */
export type RecordResponse =
	| { status: "summarized"; summary: RecordSummary }
	| { status: "saved"; recordId: string };

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

	// 1. 正本と記録を保存する（既にあれば、それを使う）
	const found = await findRecord(client, input.recordId);
	const record = found ?? (await saveRecord(client, member, input));
	if (!record || record.recorderId !== member.id)
		return error(409, "同じ記録 ID の別の記録があります");
	if (found) {
		const summary = await loadSummary(client, record.id);
		if (summary) return respond({ status: "summarized", summary });
	}

	// 2〜5. 文字起こし・構造化・版の保存と、要約を返す。失敗しても記録は残っているので、「保存したが要約はない」を返す
	try {
		// 前の呼び出しで保存した記録なら、正本はストレージから読む（送り直された中身ではなく、正本から作る）
		const originals = found ? await loadOriginals(client, record) : input;
		await structureRecord(client, deps, { member, record, originals, started });
		// 送り直されたときと同じ要約になるよう、保存した版から作る
		const summary = await loadSummary(client, record.id);
		if (!summary) throw new Error("保存した版を読めませんでした");
		return respond({ status: "summarized", summary });
	} catch (cause) {
		// リクエストの中身を含みうるエラーオブジェクトは出さず、種類と文だけを残す。
		console.error("記録の要約を作れませんでした", errorSummary(cause));
		return respond({ status: "saved", recordId: record.id });
	}
}

/** 記録の正本。写真だけの記録では音声が null。 */
type Originals = { audio: Blob | null; photos: Blob[] };

type Input = Originals & {
	recordId: string;
	recordedAt: string;
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
		recordId: recordId.toLowerCase(),
		recordedAt: new Date(recordedAt).toISOString(),
		audio: hasAudio ? audio : null,
		photos,
	};
}

type Member = { id: string; farmId: string };

/** 保存した記録。 */
type SavedRecord = {
	id: string;
	recorderId: string;
	/** 記録日時（ISO 8601）。 */
	recordedAt: string;
	audioPath: string | null;
	photoPaths: string[];
};

/** 記録を読む。見えない（別の農場の）記録や、まだない記録なら null。 */
async function findRecord(
	client: Client,
	recordId: string,
): Promise<SavedRecord | null> {
	const { data, error } = await client
		.from("records")
		.select("id, recorder_member_id, recorded_at, audio_path, photo_paths")
		.eq("id", recordId)
		.maybeSingle();
	if (error) throw error;
	return (
		data && {
			id: data.id,
			recorderId: data.recorder_member_id,
			recordedAt: new Date(data.recorded_at).toISOString(),
			audioPath: data.audio_path,
			photoPaths: data.photo_paths,
		}
	);
}

/**
 * 正本と記録を保存する。記録は正本をすべて置いてから作るので、記録があれば正本はそろっている。
 * 同じ記録 ID の呼び出しが重なって先に記録ができていれば、その記録を返す（別の農場の記録なら null）。
 */
async function saveRecord(
	client: Client,
	member: Member,
	input: Input,
): Promise<SavedRecord | null> {
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
	const record: SavedRecord = {
		id: input.recordId,
		recorderId: member.id,
		recordedAt: input.recordedAt,
		audioPath: audio?.path ?? null,
		photoPaths: photos.map((photo) => photo.path),
	};
	const inserted = await client.from("records").insert({
		id: record.id,
		farm_id: member.farmId,
		recorder_member_id: record.recorderId,
		recorded_at: record.recordedAt,
		audio_path: record.audioPath,
		photo_paths: record.photoPaths,
	});
	if (inserted.error?.code === UNIQUE_VIOLATION)
		return findRecord(client, input.recordId);
	if (inserted.error) throw inserted.error;
	return record;
}

const UNIQUE_VIOLATION = "23505";

/**
 * 正本をストレージに置く。正本は書き換えないので、同じパスへの上書きはしない。
 * 既にあれば、前回の呼び出しが記録を作る前に途中で失敗したときに置いたものなので、そのまま使う。
 */
async function saveOriginal(client: Client, path: string, file: Blob) {
	const { error } = await client.storage.from("originals").upload(path, file, {
		contentType: file.type || "application/octet-stream",
		upsert: false,
	});
	if (error && !isAlreadyExists(error)) throw error;
}

function isAlreadyExists(error: Error) {
	return "statusCode" in error && String(error.statusCode) === "409";
}

/** 保存した記録の正本を、ストレージから読む。 */
async function loadOriginals(
	client: Client,
	record: SavedRecord,
): Promise<Originals> {
	const originals = client.storage.from("originals");
	const download = async (path: string) => {
		const { data, error } = await originals.download(path);
		if (error) throw error;
		return data;
	};
	const [audio, ...photos] = await Promise.all([
		record.audioPath ? download(record.audioPath) : null,
		...record.photoPaths.map(download),
	]);
	return { audio: audio ?? null, photos: photos.filter((p) => p !== null) };
}

/** 2〜4. 正本を文字起こし・構造化して、AI の版を計測と一緒に保存する。 */
async function structureRecord(
	client: Client,
	deps: RecordDeps,
	{
		member,
		record,
		originals,
		started,
	}: {
		member: Member;
		record: SavedRecord;
		originals: Originals;
		started: number;
	},
) {
	const farm = await loadRegistered(client, member.farmId);

	// 2. 文字起こしする（写真だけの記録では呼ばない）
	const transcribing = performance.now();
	const transcription = originals.audio
		? await deps.transcribe({
				audio: originals.audio,
				vocabulary: vocabularyOf(farm),
			})
		: null;
	const transcript = transcription?.text ?? null;

	// 3. 構造化する
	const structuring = performance.now();
	const extracted = await deps.structure({
		transcript,
		photos: originals.photos,
		recordedAt: record.recordedAt,
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
	const recordedOn = farmDateOf(record.recordedAt);

	// 4. AI の版を、計測と一緒に保存する
	const saved = await client.rpc("save_ai_version", {
		target_record_id: record.id,
		...(transcript === null ? {} : { transcript }),
		items: items.map((item) => ({
			kind: item.kind,
			body: item.text,
			performed_on: item.performedOn ?? recordedOn,
			fields: item.fields.map(toLinkRow),
			crops: item.crops.map(toLinkRow),
			varieties: (item.varieties ?? []).map(toLinkRow),
			...(item.kind === "judgment" && {
				judge_member_id: item.judgeId ?? member.id,
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
}

/** ログイン中の人の、離れていない農場メンバーとしての行。複数あれば最初に入った農場。 */
async function findMember(
	client: Client,
	userId: string,
): Promise<Member | null> {
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

/** 記録の最新の版から要約を作る。版がまだなければ null。 */
async function loadSummary(
	client: Client,
	recordId: string,
): Promise<RecordSummary | null> {
	const { data: version, error } = await client
		.from("versions")
		.select(
			`id, transcript,
			extractions (
				id, position, kind, body, performed_on, judge_member_id,
				judge:farm_members!extractions_judge_member_id_fkey (display_name),
				extraction_fields (position, field_id, spoken_as, fields (name)),
				extraction_crops (position, crop_id, spoken_as, crops (name)),
				extraction_varieties (position, variety_id, spoken_as, varieties (name)),
				grounds!grounds_judgment_id_fkey (position, observation_id, body),
				work_materials (position, name, amount, dilution)
			)`,
		)
		.eq("record_id", recordId)
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (!version) return null;

	const extractions = version.extractions.sort(byPosition);
	const positionOf = new Map(extractions.map((e, i) => [e.id, i]));
	const bodyOf = new Map(extractions.map((e) => [e.id, e.body]));
	return {
		recordId,
		versionId: version.id,
		transcript: version.transcript,
		items: extractions.map((e): SummaryItem => {
			const base = {
				text: e.body,
				performedOn: e.performed_on,
				fields: named(
					e.extraction_fields.map((l) => ({
						...l,
						id: l.field_id,
						name: l.fields?.name,
					})),
				),
				crops: named(
					e.extraction_crops.map((l) => ({
						...l,
						id: l.crop_id,
						name: l.crops?.name,
					})),
				),
				varieties: named(
					e.extraction_varieties.map((l) => ({
						...l,
						id: l.variety_id,
						name: l.varieties?.name,
					})),
				),
			};
			if (e.kind === "observation") return { ...base, kind: "observation" };
			if (e.kind === "work")
				return {
					...base,
					kind: "work",
					materials: e.work_materials
						.sort(byPosition)
						.map(({ name, amount, dilution }) => ({ name, amount, dilution })),
				};
			return {
				...base,
				kind: "judgment",
				judge: {
					id: e.judge_member_id ?? "",
					name: e.judge?.display_name ?? "",
				},
				grounds: e.grounds.sort(byPosition).map((ground) =>
					ground.observation_id
						? {
								observation: positionOf.get(ground.observation_id) ?? null,
								text: bodyOf.get(ground.observation_id) ?? "",
							}
						: { observation: null, text: ground.body ?? "" },
				),
			};
		}),
	};
}

/** 結びつきを並び順に並べる。登録された圃場・作目・品種なら登録の名前、未確定なら話の中の言い方。 */
function named(
	links: {
		position: number;
		id: string | null;
		name: string | undefined;
		spoken_as: string | null;
	}[],
): Named[] {
	return links
		.sort(byPosition)
		.map((link) =>
			link.id
				? { id: link.id, name: link.name ?? "" }
				: { id: null, name: link.spoken_as ?? "" },
		);
}

function byPosition(a: { position: number }, b: { position: number }) {
	return a.position - b.position;
}

function respond(body: RecordResponse) {
	return Response.json(body);
}

function errorSummary(cause: unknown) {
	return cause instanceof Error
		? `${cause.name}: ${cause.message}`
		: typeof cause;
}

/** performance.now() の 2 つの値の間の秒数。 */
function seconds(from: number, to: number) {
	return (to - from) / 1000;
}

function error(status: number, message: string) {
	return Response.json({ error: message }, { status });
}
