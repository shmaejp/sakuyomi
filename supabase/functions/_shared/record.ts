// 記録処理関数（主なシーム）。録音を受け取り、同期で次の順に処理して、要約を応答として返す。
// 1. 正本（音声）と記録を保存する 2. 文字起こしする 3. 構造化する 4. AI の版と計測を保存する 5. 要約を返す
// 記録を保存すると、出来事「記録」も DB のトリガーで残る。
// DB には、呼び出したメンバーの権限で書き込み、RLS を効かせる。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/lib/database.types.ts";
import type {
	ExtractionKind,
	Link,
	Registered,
	Structurer,
	Transcriber,
} from "./parts.ts";

type Client = SupabaseClient<Database>;

export type RecordDeps = {
	supabaseUrl: string;
	anonKey: string;
	transcribe: Transcriber;
	structure: Structurer;
};

/** 結びついた圃場・作目。id が null なら未確定で、name は話の中の言い方。 */
type Named = { id: string | null; name: string };

export type RecordSummary = {
	recordId: string;
	versionId: string;
	transcript: string;
	items: {
		kind: ExtractionKind;
		text: string;
		fields: Named[];
		crops: Named[];
	}[];
};

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
	const audioPath = `${member.farmId}/${input.recordId}/audio`;
	const upload = await client.storage
		.from("originals")
		.upload(audioPath, input.audio, {
			contentType: input.audio.type || "application/octet-stream",
			upsert: false,
		});
	if (upload.error) throw upload.error;
	const inserted = await client.from("records").insert({
		id: input.recordId,
		farm_id: member.farmId,
		recorder_member_id: member.id,
		recorded_at: input.recordedAt,
		audio_path: audioPath,
	});
	if (inserted.error) throw inserted.error;

	// 2. 文字起こしする
	const transcribing = performance.now();
	const { text: transcript, costUsd } = await deps.transcribe({
		audio: input.audio,
		vocabulary: vocabularyOf(farm),
	});

	// 3. 構造化する
	const structuring = performance.now();
	const { items, usage } = await deps.structure({
		transcript,
		recordedAt: input.recordedAt,
		fields: farm.fields,
		crops: farm.crops,
	});
	const structured = performance.now();

	// 4. AI の版を、計測と一緒に保存する
	const saved = await client.rpc("save_ai_version", {
		target_record_id: input.recordId,
		transcript,
		items: items.map((item) => ({
			kind: item.kind,
			body: item.text,
			fields: item.fields.map(toLinkRow),
			crops: item.crops.map(toLinkRow),
		})),
		metrics: {
			transcription_seconds: seconds(transcribing, structuring),
			structuring_seconds: seconds(structuring, structured),
			seconds_before_save: seconds(started, performance.now()),
			input_tokens: usage.inputTokens,
			output_tokens: usage.outputTokens,
			transcription_cost_usd: costUsd,
		},
	});
	if (saved.error) throw saved.error;

	// 5. 要約を返す
	const summary: RecordSummary = {
		recordId: input.recordId,
		versionId: saved.data,
		transcript,
		items: items.map((item) => ({
			kind: item.kind,
			text: item.text,
			fields: item.fields.map((link) => named(link, farm.fields)),
			crops: item.crops.map((link) => named(link, farm.crops)),
		})),
	};
	return Response.json(summary);
}

type Input = { recordId: string; recordedAt: string; audio: Blob };

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
	if (!(audio instanceof Blob) || audio.size === 0) return "音声がありません";
	return { recordId, recordedAt: new Date(recordedAt).toISOString(), audio };
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

/** 構造化に渡す、農場の圃場（廃止されていないもの）と作目。 */
async function loadRegistered(client: Client, farmId: string) {
	const [fields, crops] = await Promise.all([
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
	]);
	if (fields.error) throw fields.error;
	if (crops.error) throw crops.error;
	const toRegistered = (r: {
		id: string;
		name: string;
		spoken_names: string[];
	}): Registered => ({ id: r.id, name: r.name, spokenNames: r.spoken_names });
	return {
		fields: fields.data.map(toRegistered),
		crops: crops.data.map(toRegistered),
	};
}

function vocabularyOf(farm: { fields: Registered[]; crops: Registered[] }) {
	const words = [...farm.fields, ...farm.crops].flatMap((r) => [
		r.name,
		...r.spokenNames,
	]);
	return [...new Set(words)];
}

function toLinkRow(link: Link) {
	return "id" in link ? { id: link.id } : { spoken_as: link.spokenAs };
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
