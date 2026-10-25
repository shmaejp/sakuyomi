import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";
import type {
	StructuredItem,
	Structurer,
	StructuringInput,
	TokenUsage,
	Transcriber,
	TranscriptionInput,
} from "../../supabase/functions/_shared/parts.ts";
import {
	handleRecordRequest,
	type RecordSummary,
} from "../../supabase/functions/_shared/record.ts";
import { adminClient, TestData } from "./support";

/** 決まった文章と料金を返し、受け取った入力を残す偽物の文字起こし。 */
function fakeTranscriber(
	text: string,
	options: { costUsd?: number; delayMs?: number } = {},
) {
	const calls: TranscriptionInput[] = [];
	const transcribe: Transcriber = async (input) => {
		calls.push(input);
		await delay(options.delayMs ?? 0);
		return { text, costUsd: options.costUsd ?? 0 };
	};
	return { transcribe, calls };
}

/** 決まった取り出しとトークン数を返し、受け取った入力を残す偽物の構造化。 */
function fakeStructurer(
	result: (input: StructuringInput) => { items: StructuredItem[] },
	options: { usage?: TokenUsage; delayMs?: number } = {},
) {
	const calls: StructuringInput[] = [];
	const structure: Structurer = async (input) => {
		calls.push(input);
		await delay(options.delayMs ?? 0);
		return {
			...result(input),
			usage: options.usage ?? { inputTokens: 0, outputTokens: 0 },
		};
	};
	return { structure, calls };
}

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordRequest(
	accessToken: string | null,
	values: {
		recordId?: string;
		recordedAt?: string;
		audio?: Blob | null;
		photos?: Blob[];
	},
) {
	const form = new FormData();
	form.set("recordId", values.recordId ?? crypto.randomUUID());
	form.set("recordedAt", values.recordedAt ?? "2026-10-24T08:30:00.000Z");
	const audio =
		values.audio === undefined
			? new Blob(["fake audio"], { type: "audio/webm" })
			: values.audio;
	if (audio) form.set("audio", audio, "audio.webm");
	for (const photo of values.photos ?? [])
		form.append("photos", photo, "photo.jpg");
	return new Request("http://localhost/functions/v1/record", {
		method: "POST",
		headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
		body: form,
	});
}

describe("記録処理関数", () => {
	let data: TestData;
	let farm: string;
	let house1: string;
	let house2: string;
	let tomato: string;

	beforeEach(async () => {
		data = new TestData();
		farm = await data.farm("前田農場");
		house1 = await data.field(farm, {
			name: "1番ハウス",
			spokenNames: ["1番", "手前のハウス"],
		});
		house2 = await data.field(farm, {
			name: "2番ハウス",
			spokenNames: ["2番"],
		});
		tomato = await data.crop(farm, { name: "トマト", spokenNames: ["とまと"] });
	});

	afterEach(async () => {
		await data.cleanUp();
	});

	async function signedInMember() {
		const me = await data.user("me");
		const memberId = await data.member(farm, {
			userId: me.userId,
			displayName: "晋弥",
		});
		return { ...me, memberId };
	}

	it("音声の記録を送ると要約が返り、記録・正本・AI の版・取り出し・結びつきが保存される", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();
		const transcriber = fakeTranscriber(
			"1番と2番ハウスのトマトに消毒した。葉に斑点が出ていたから。",
		);
		const structurer = fakeStructurer(() => ({
			items: [
				{
					kind: "observation",
					text: "トマトの葉に斑点が出ていた",
					fields: [{ id: house1 }, { id: house2 }],
					crops: [{ id: tomato }],
				},
				{
					kind: "work",
					text: "1番と2番ハウスのトマトに消毒した",
					fields: [{ id: house1 }, { id: house2 }],
					crops: [{ id: tomato }],
				},
			],
		}));

		const response = await handleRecordRequest(
			recordRequest(me.accessToken, {
				recordId,
				recordedAt: "2026-10-24T08:30:00.000Z",
			}),
			deps(transcriber.transcribe, structurer.structure),
		);

		expect(response.status).toBe(200);
		const summary: RecordSummary = await response.json();
		expect(summary).toEqual({
			recordId,
			versionId: expect.any(String),
			transcript: "1番と2番ハウスのトマトに消毒した。葉に斑点が出ていたから。",
			items: [
				{
					kind: "observation",
					text: "トマトの葉に斑点が出ていた",
					fields: [
						{ id: house1, name: "1番ハウス" },
						{ id: house2, name: "2番ハウス" },
					],
					crops: [{ id: tomato, name: "トマト" }],
				},
				{
					kind: "work",
					text: "1番と2番ハウスのトマトに消毒した",
					fields: [
						{ id: house1, name: "1番ハウス" },
						{ id: house2, name: "2番ハウス" },
					],
					crops: [{ id: tomato, name: "トマト" }],
				},
			],
		});

		const { data: record } = await me.client
			.from("records")
			.select(
				"id, farm_id, recorded_at, audio_path, recorder:farm_members (display_name), versions (author, transcript, extractions (kind, body, extraction_fields (field_id), extraction_crops (crop_id)))",
			)
			.eq("id", recordId)
			.single();
		expect(record).toMatchObject({
			id: recordId,
			farm_id: farm,
			recorded_at: "2026-10-24T08:30:00+00:00",
			recorder: { display_name: "晋弥" },
			versions: [
				{
					author: "ai",
					transcript:
						"1番と2番ハウスのトマトに消毒した。葉に斑点が出ていたから。",
				},
			],
		});
		const extractions = record?.versions[0]?.extractions ?? [];
		expect(extractions).toHaveLength(2);
		expect(
			extractions.find((e) => e.kind === "work")?.extraction_fields,
		).toEqual(
			expect.arrayContaining([{ field_id: house1 }, { field_id: house2 }]),
		);

		const audio = await me.client.storage
			.from("originals")
			.download(record?.audio_path ?? "");
		expect(await audio.data?.text()).toBe("fake audio");
	});

	it("記録ごとに、Claude の入力/出力トークン数と文字起こしの料金が保存される", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();

		await handleRecordRequest(
			recordRequest(me.accessToken, { recordId }),
			deps(
				fakeTranscriber("1番のトマトに消毒した", { costUsd: 0.0123 })
					.transcribe,
				fakeStructurer(() => ({ items: [] }), {
					usage: { inputTokens: 1520, outputTokens: 230 },
				}).structure,
			),
		);

		const { data: metrics } = await me.client
			.from("record_metrics")
			.select("input_tokens, output_tokens, transcription_cost_usd")
			.eq("record_id", recordId);
		expect(metrics).toEqual([
			{
				input_tokens: 1520,
				output_tokens: 230,
				transcription_cost_usd: 0.0123,
			},
		]);
	});

	it("記録ごとに、文字起こしの秒数・構造化の秒数・合計の秒数が保存される", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();

		await handleRecordRequest(
			recordRequest(me.accessToken, { recordId }),
			deps(
				fakeTranscriber("1番のトマト", { delayMs: 100 }).transcribe,
				fakeStructurer(() => ({ items: [] }), { delayMs: 300 }).structure,
			),
		);

		const { data: metrics } = await me.client
			.from("record_metrics")
			.select("transcription_seconds, structuring_seconds, total_seconds")
			.eq("record_id", recordId)
			.single();
		expect(metrics?.transcription_seconds).toBeGreaterThanOrEqual(0.1);
		expect(metrics?.transcription_seconds).toBeLessThan(0.3);
		expect(metrics?.structuring_seconds).toBeGreaterThanOrEqual(0.3);
		expect(metrics?.total_seconds).toBeGreaterThan(
			(metrics?.transcription_seconds ?? 0) +
				(metrics?.structuring_seconds ?? 0),
		);
	});

	it("記録を受け取ると、構造化に失敗しても、出来事「記録」と受け取った日時が残る", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();
		const before = Date.now();

		await expect(
			handleRecordRequest(
				// 圏外で 3 日前に記録し、今送ったもの
				recordRequest(me.accessToken, {
					recordId,
					recordedAt: new Date(before - 3 * 86_400_000).toISOString(),
				}),
				deps(fakeTranscriber("1番のトマト").transcribe, async () => {
					throw new Error("構造化に失敗");
				}),
			),
		).rejects.toThrow();
		const after = Date.now();

		const { data: events } = await me.client
			.from("events")
			.select("kind, member_id, record_id, farm_id")
			.eq("record_id", recordId);
		expect(events).toEqual([
			{
				kind: "record",
				member_id: me.memberId,
				record_id: recordId,
				farm_id: farm,
			},
		]);
		const { data: record } = await me.client
			.from("records")
			.select("received_at")
			.eq("id", recordId)
			.single();
		// ローカルの DB とテストの時計のずれを 1 秒まで許す
		const receivedAt = Date.parse(record?.received_at ?? "");
		expect(receivedAt).toBeGreaterThanOrEqual(before - 1000);
		expect(receivedAt).toBeLessThanOrEqual(after + 1000);
	});

	it("農場メンバーでも、出来事は書けない", async () => {
		const me = await signedInMember();

		const inserted = await me.client.from("events").insert({
			farm_id: farm,
			member_id: me.memberId,
			kind: "record",
		});

		expect(inserted.error).not.toBeNull();
		const { data: events } = await me.client.from("events").select("id");
		expect(events).toEqual([]);
	});

	it("写真を撮ってから話した記録は、写真と音声が 1 件の記録として保存され、写真が撮った順に構造化に渡される", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();
		const structurer = fakeStructurer(() => ({ items: [] }));

		const response = await handleRecordRequest(
			recordRequest(me.accessToken, {
				recordId,
				photos: [
					new Blob(["first photo"], { type: "image/jpeg" }),
					new Blob(["second photo"], { type: "image/png" }),
				],
			}),
			deps(fakeTranscriber("1番の葉").transcribe, structurer.structure),
		);

		expect(response.status).toBe(200);
		expect(structurer.calls).toHaveLength(1);
		const passed = structurer.calls[0]?.photos ?? [];
		expect(
			await Promise.all(passed.map(async (p) => [p.type, await p.text()])),
		).toEqual([
			["image/jpeg", "first photo"],
			["image/png", "second photo"],
		]);
		const { data: records } = await me.client
			.from("records")
			.select("audio_path, photo_paths")
			.eq("id", recordId);
		expect(records).toHaveLength(1);
		const originals = me.client.storage.from("originals");
		const saved = await Promise.all(
			(records?.[0]?.photo_paths ?? []).map(async (path) => {
				const { data: photo } = await originals.download(path);
				return [photo?.type, await photo?.text()];
			}),
		);
		expect(saved).toEqual([
			["image/jpeg", "first photo"],
			["image/png", "second photo"],
		]);
		const audio = await originals.download(records?.[0]?.audio_path ?? "");
		expect(await audio.data?.text()).toBe("fake audio");
	});

	it("登録にない場所・作物の話は、話の中の言い方のまま未確定として結びつく", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();
		const structurer = fakeStructurer(() => ({
			items: [
				{
					kind: "observation",
					text: "裏の畑のナスに虫がついていた",
					fields: [{ spokenAs: "裏の畑" }],
					crops: [{ spokenAs: "ナス" }],
				},
			],
		}));

		const response = await handleRecordRequest(
			recordRequest(me.accessToken, { recordId }),
			deps(
				fakeTranscriber("裏の畑のナスに虫").transcribe,
				structurer.structure,
			),
		);

		const summary: RecordSummary = await response.json();
		expect(summary.items).toEqual([
			{
				kind: "observation",
				text: "裏の畑のナスに虫がついていた",
				fields: [{ id: null, name: "裏の畑" }],
				crops: [{ id: null, name: "ナス" }],
			},
		]);
		const { data: extractions } = await me.client
			.from("extractions")
			.select(
				"extraction_fields (field_id, spoken_as), extraction_crops (crop_id, spoken_as), versions!inner (record_id)",
			)
			.eq("versions.record_id", recordId);
		expect(extractions).toMatchObject([
			{
				extraction_fields: [{ field_id: null, spoken_as: "裏の畑" }],
				extraction_crops: [{ crop_id: null, spoken_as: "ナス" }],
			},
		]);
	});

	it("文字起こしと構造化に、その農場の廃止されていない圃場と作目が、呼び名つきで渡される", async () => {
		const me = await signedInMember();
		await data.field(farm, {
			name: "旧3番ハウス",
			spokenNames: ["3番"],
			retiredAt: new Date().toISOString(),
		});
		const neighborFarm = await data.farm("隣の農場");
		await data.field(neighborFarm, { name: "南の畑" });
		const transcriber = fakeTranscriber("とまとの葉が黄色い");
		const structurer = fakeStructurer(() => ({ items: [] }));

		await handleRecordRequest(
			recordRequest(me.accessToken, {
				recordedAt: "2026-10-24T08:30:00.000Z",
			}),
			deps(transcriber.transcribe, structurer.structure),
		);

		expect(transcriber.calls).toHaveLength(1);
		expect([...(transcriber.calls[0]?.vocabulary ?? [])].sort()).toEqual(
			[
				"1番ハウス",
				"1番",
				"手前のハウス",
				"2番ハウス",
				"2番",
				"トマト",
				"とまと",
			].sort(),
		);
		expect(structurer.calls).toEqual([
			{
				transcript: "とまとの葉が黄色い",
				photos: [],
				recordedAt: "2026-10-24T08:30:00.000Z",
				fields: [
					{
						id: house1,
						name: "1番ハウス",
						spokenNames: ["1番", "手前のハウス"],
					},
					{ id: house2, name: "2番ハウス", spokenNames: ["2番"] },
				],
				crops: [{ id: tomato, name: "トマト", spokenNames: ["とまと"] }],
			},
		]);
	});

	it("別の農場のメンバーからは、その記録も版も取り出しも結びつきも正本も出来事も計測も見えない", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();
		await handleRecordRequest(
			recordRequest(me.accessToken, { recordId }),
			deps(
				fakeTranscriber("1番のトマトに消毒した").transcribe,
				fakeStructurer(() => ({
					items: [
						{
							kind: "work",
							text: "1番のトマトに消毒した",
							fields: [{ id: house1 }],
							crops: [{ id: tomato }],
						},
					],
				})).structure,
			),
		);
		const neighborFarm = await data.farm("隣の農場");
		const neighbor = await data.user("neighbor");
		await data.member(neighborFarm, {
			userId: neighbor.userId,
			displayName: "隣の人",
		});

		for (const table of [
			"records",
			"versions",
			"extractions",
			"extraction_fields",
			"extraction_crops",
			"events",
			"record_metrics",
		] as const) {
			const { data: rows } = await neighbor.client.from(table).select("*");
			expect(rows, table).toEqual([]);
		}
		const audio = await neighbor.client.storage
			.from("originals")
			.download(`${farm}/${recordId}/audio`);
		expect(audio.data).toBeNull();
	});

	it("別の農場の記録には、版を作れない", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();
		await handleRecordRequest(
			recordRequest(me.accessToken, { recordId }),
			deps(
				fakeTranscriber("").transcribe,
				fakeStructurer(() => ({ items: [] })).structure,
			),
		);
		const neighborFarm = await data.farm("隣の農場");
		const neighbor = await data.user("neighbor");
		await data.member(neighborFarm, {
			userId: neighbor.userId,
			displayName: "隣の人",
		});

		const direct = await neighbor.client.from("versions").insert({
			farm_id: neighborFarm,
			record_id: recordId,
			author: "ai",
			transcript: "書き換え",
		});
		const viaFunction = await neighbor.client.rpc("save_ai_version", {
			target_record_id: recordId,
			transcript: "書き換え",
			items: [],
			metrics: {
				transcription_seconds: 0,
				structuring_seconds: 0,
				seconds_before_save: 0,
				input_tokens: 0,
				output_tokens: 0,
				transcription_cost_usd: 0,
			},
		});

		expect(direct.error).not.toBeNull();
		expect(viaFunction.error).not.toBeNull();
		const { data: versions } = await me.client
			.from("versions")
			.select("transcript")
			.eq("record_id", recordId);
		expect(versions).toEqual([{ transcript: "" }]);
	});

	it("取り出しを、別の農場の圃場・作目には結びつけられない", async () => {
		const me = await signedInMember();
		const neighborFarm = await data.farm("隣の農場");
		const neighborField = await data.field(neighborFarm, { name: "南の畑" });
		const neighborCrop = await data.crop(neighborFarm, { name: "ナス" });

		for (const link of [
			{ fields: [{ id: neighborField }], crops: [] },
			{ fields: [], crops: [{ id: neighborCrop }] },
		]) {
			await expect(
				handleRecordRequest(
					recordRequest(me.accessToken, {}),
					deps(
						fakeTranscriber("南の畑のナス").transcribe,
						fakeStructurer(() => ({
							items: [{ kind: "observation", text: "南の畑のナス", ...link }],
						})).structure,
					),
				),
			).rejects.toBeTruthy();
		}
		const { data: extractions } = await me.client
			.from("extractions")
			.select("id");
		expect(extractions).toEqual([]);
	});

	it("ログインしていない人・どの農場にも属さない人・農場を離れた人の記録は受け付けない", async () => {
		const stranger = await data.user("stranger");
		const left = await data.user("left");
		await data.member(farm, {
			userId: left.userId,
			displayName: "離れた人",
			leftAt: new Date().toISOString(),
		});
		const transcriber = fakeTranscriber("1番のトマト");
		const parts = deps(
			transcriber.transcribe,
			fakeStructurer(() => ({ items: [] })).structure,
		);

		const statuses = [];
		for (const token of [
			null,
			"not-a-token",
			stranger.accessToken,
			left.accessToken,
		]) {
			const response = await handleRecordRequest(
				recordRequest(token, {}),
				parts,
			);
			statuses.push(response.status);
		}

		expect(statuses).toEqual([401, 401, 403, 403]);
		expect(transcriber.calls).toEqual([]);
		const { count } = await adminClient()
			.from("records")
			.select("*", { count: "exact", head: true })
			.eq("farm_id", farm);
		expect(count).toBe(0);
	});

	it("写真だけの記録は、文字起こしを呼ばずに構造化し、取り出しは観察だけが残る", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();
		const transcriber = fakeTranscriber("呼ばれないはず");
		const structurer = fakeStructurer(() => ({
			items: [
				{
					kind: "observation",
					text: "トマトの葉に斑点がある",
					fields: [],
					crops: [{ id: tomato }],
				},
				{
					kind: "judgment",
					text: "消毒することにした",
					fields: [],
					crops: [{ id: tomato }],
				},
			],
		}));

		const response = await handleRecordRequest(
			recordRequest(me.accessToken, {
				recordId,
				audio: null,
				photos: [new Blob(["leaf"], { type: "image/jpeg" })],
			}),
			deps(transcriber.transcribe, structurer.structure),
		);

		expect(response.status).toBe(200);
		expect(transcriber.calls).toEqual([]);
		expect(structurer.calls[0]?.transcript).toBeNull();
		const summary: RecordSummary = await response.json();
		expect(summary).toMatchObject({
			transcript: null,
			items: [{ kind: "observation", text: "トマトの葉に斑点がある" }],
		});
		expect(summary.items).toHaveLength(1);
		const { data: record } = await me.client
			.from("records")
			.select(
				"audio_path, photo_paths, versions (transcript, extractions (kind)), record_metrics (transcription_seconds, transcription_cost_usd)",
			)
			.eq("id", recordId)
			.single();
		expect(record).toMatchObject({
			audio_path: null,
			photo_paths: [expect.any(String)],
			versions: [{ transcript: null, extractions: [{ kind: "observation" }] }],
			record_metrics: [
				{ transcription_seconds: null, transcription_cost_usd: null },
			],
		});
	});

	it("構造化に渡せない形式・大きさの写真は受け付けない", async () => {
		const me = await signedInMember();
		const structurer = fakeStructurer(() => ({ items: [] }));

		const statuses = [];
		for (const photo of [
			new Blob(["heic"], { type: "image/heic" }),
			new Blob([new Uint8Array(4 * 1024 * 1024)], { type: "image/jpeg" }),
		]) {
			const response = await handleRecordRequest(
				recordRequest(me.accessToken, { photos: [photo] }),
				deps(fakeTranscriber("").transcribe, structurer.structure),
			);
			statuses.push(response.status);
		}

		expect(statuses).toEqual([400, 400]);
		expect(structurer.calls).toEqual([]);
		const { data: records } = await me.client.from("records").select("id");
		expect(records).toEqual([]);
	});

	it("音声も写真もない記録は受け付けない", async () => {
		const me = await signedInMember();

		const response = await handleRecordRequest(
			recordRequest(me.accessToken, { audio: null }),
			deps(
				fakeTranscriber("").transcribe,
				fakeStructurer(() => ({ items: [] })).structure,
			),
		);

		expect(response.status).toBe(400);
		const { data: records } = await me.client.from("records").select("id");
		expect(records).toEqual([]);
	});

	it("農場メンバーでも、正本の音声・写真と記録は書き換えも削除もできない", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();
		await handleRecordRequest(
			recordRequest(me.accessToken, {
				recordId,
				recordedAt: "2026-10-24T08:30:00.000Z",
				photos: [new Blob(["fake photo"], { type: "image/jpeg" })],
			}),
			deps(
				fakeTranscriber("").transcribe,
				fakeStructurer(() => ({ items: [] })).structure,
			),
		);
		const audioPath = `${farm}/${recordId}/audio`;
		const photoPath = `${farm}/${recordId}/photos/0`;
		const originals = me.client.storage.from("originals");

		for (const path of [audioPath, photoPath]) {
			await originals.upload(path, new Blob(["overwritten"]), {
				upsert: true,
			});
			await originals.update(path, new Blob(["overwritten"]));
			await originals.remove([path]);
		}
		await me.client
			.from("records")
			.update({ recorded_at: "2020-01-01T00:00:00.000Z" })
			.eq("id", recordId);
		await me.client.from("records").delete().eq("id", recordId);

		const audio = await originals.download(audioPath);
		expect(await audio.data?.text()).toBe("fake audio");
		const photo = await originals.download(photoPath);
		expect(await photo.data?.text()).toBe("fake photo");
		const { data: record } = await me.client
			.from("records")
			.select("recorded_at")
			.eq("id", recordId)
			.single();
		expect(record).toEqual({ recorded_at: "2026-10-24T08:30:00+00:00" });
	});

	it("人の版はまだ作れない", async () => {
		const me = await signedInMember();
		const recordId = crypto.randomUUID();
		await handleRecordRequest(
			recordRequest(me.accessToken, { recordId }),
			deps(
				fakeTranscriber("").transcribe,
				fakeStructurer(() => ({ items: [] })).structure,
			),
		);

		const inserted = await me.client.from("versions").insert({
			farm_id: farm,
			record_id: recordId,
			author: "human",
			transcript: "直した",
		});

		expect(inserted.error).not.toBeNull();
		const { data: versions } = await me.client
			.from("versions")
			.select("author")
			.eq("record_id", recordId);
		expect(versions).toEqual([{ author: "ai" }]);
	});
});

function deps(transcribe: Transcriber, structure: Structurer) {
	return {
		supabaseUrl: inject("supabaseUrl"),
		anonKey: inject("anonKey"),
		transcribe,
		structure,
	};
}
