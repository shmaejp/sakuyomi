import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CorrectedItem,
	CorrectionRejected,
	correctRecord,
	removeItem,
	toCorrectedItems,
} from "../../src/correction";
import type { Client } from "../../src/lib/supabase";
import {
	loadSummary,
	type RecordSummary,
} from "../../supabase/functions/_shared/summary.ts";
import { adminClient, TestData, type TestItem } from "./support";

describe("訂正", () => {
	let data: TestData;
	let farm: string;
	let me: { client: Client; memberId: string };
	let house1: string;
	let tomato: string;

	beforeEach(async () => {
		data = new TestData();
		farm = await data.farm("前田農場");
		const user = await data.user("me");
		me = {
			client: user.client,
			memberId: await data.member(farm, {
				userId: user.userId,
				displayName: "晋弥",
			}),
		};
		house1 = await data.field(farm, { name: "1番ハウス" });
		tomato = await data.crop(farm, { name: "トマト" });
	});

	afterEach(async () => {
		await data.cleanUp();
	});

	/** 自分の記録を、AI の版つきで 1 件作り、その要約を返す。 */
	async function myRecord(...items: TestItem[]): Promise<RecordSummary> {
		const recordId = await data.record(farm, {
			recorderId: me.memberId,
			recordedAt: "2026-10-24T08:00:00Z",
			transcript: "奥のハウスのトマトの葉が巻いていた",
			items,
		});
		const summary = await loadSummary(me.client, recordId);
		if (!summary) throw new Error("要約がありません");
		return summary;
	}

	/** 要約の取り出しを直して訂正する。 */
	function correct(
		client: Client,
		summary: RecordSummary,
		edit: (items: CorrectedItem[]) => CorrectedItem[],
	) {
		return correctRecord(client, {
			recordId: summary.recordId,
			baseVersionId: summary.versionId,
			items: edit(toCorrectedItems(summary)),
		});
	}

	it("未確定だった圃場を、後から登録した圃場に結びつけると、人の版が新しく作られ、訂正者・訂正日時・元にした版が残り、訂正済みとわかる", async () => {
		const before = await myRecord({
			kind: "observation",
			body: "トマトの葉が巻いていた",
			performedOn: "2026-10-24",
			unresolvedFields: ["奥のハウス"],
			cropIds: [tomato],
		});
		const back = await data.field(farm, { name: "奥のハウス" });

		const result = await correct(me.client, before, ([item]) => [
			{ ...(item as CorrectedItem), fields: [{ id: back }] },
		]);

		// 訂正済みかどうか（作り直しの対象から外す条件）は、最新の版が人の版かどうかでわかる。
		expect(before.correction).toBeNull();
		expect(result.status).toBe("corrected");
		const after = result.summary;
		expect(after.versionId).not.toBe(before.versionId);
		expect(after.items[0]?.fields).toEqual([{ id: back, name: "奥のハウス" }]);
		expect(after.items[0]?.crops).toEqual([{ id: tomato, name: "トマト" }]);
		expect(after.transcript).toBe("奥のハウスのトマトの葉が巻いていた");
		expect(after.correction).toEqual({
			by: { id: me.memberId, name: "晋弥" },
			at: expect.any(String),
			basedOnVersionId: before.versionId,
		});
		expect(Date.now() - Date.parse(after.correction?.at ?? "")).toBeLessThan(
			60_000,
		);
		// 元にした版とその取り出しは変わらない。記録の中身は最新の版（人の版）から出る。
		expect(await loadSummary(me.client, before.recordId)).toEqual(after);
		const { data: base } = await me.client
			.from("versions")
			.select(
				"author, extractions (body, extraction_fields (spoken_as, field_id))",
			)
			.eq("id", before.versionId)
			.single();
		expect(base).toEqual({
			author: "ai",
			extractions: [
				{
					body: "トマトの葉が巻いていた",
					extraction_fields: [{ spoken_as: "奥のハウス", field_id: null }],
				},
			],
		});
	});

	it("何も変えずに保存すると、新しい版を作らず、元にした版を返す", async () => {
		const father = await data.member(farm, { displayName: "父" });
		const before = await myRecord(
			{
				kind: "observation",
				body: "葉が巻いていた",
				performedOn: "2026-10-24",
				fieldIds: [house1],
				unresolvedFields: ["奥のハウス"],
				cropIds: [tomato],
			},
			{
				kind: "judgment",
				body: "消毒することにした",
				performedOn: "2026-10-24",
				cropIds: [tomato],
				judgeId: father,
			},
		);

		const result = await correct(me.client, before, (items) => items);

		expect(result).toEqual({ status: "unchanged", summary: before });
		const { count } = await me.client
			.from("versions")
			.select("*", { count: "exact", head: true })
			.eq("record_id", before.recordId);
		expect(count).toBe(1);
	});

	it("他のメンバーが、種別・文章・実施日を直し、廃止された圃場を含む複数の圃場に結びつけられる。判断にすると記録者が判断者になる", async () => {
		const oldHouse = await data.field(farm, {
			name: "旧2番ハウス",
			retiredAt: "2026-01-01T00:00:00Z",
		});
		const sister = await data.user("sister");
		const sisterId = await data.member(farm, {
			userId: sister.userId,
			displayName: "妹",
		});
		const before = await myRecord({
			kind: "observation",
			body: "消毒する",
			performedOn: "2026-10-24",
			cropIds: [tomato],
		});

		const result = await correct(sister.client, before, ([item]) => [
			{
				kind: "judgment",
				judgeId: null,
				grounds: [],
				text: "1番と旧2番を消毒することにした",
				performedOn: "2026-10-23",
				fields: [{ id: house1 }, { id: oldHouse }],
				crops: item?.crops ?? [],
				varieties: [],
			},
		]);

		expect(result.status).toBe("corrected");
		expect(result.summary.items).toEqual([
			{
				kind: "judgment",
				text: "1番と旧2番を消毒することにした",
				performedOn: "2026-10-23",
				judge: { id: me.memberId, name: "晋弥" },
				grounds: [],
				fields: [
					{ id: house1, name: "1番ハウス" },
					{ id: oldHouse, name: "旧2番ハウス" },
				],
				crops: [{ id: tomato, name: "トマト" }],
				varieties: [],
			},
		]);
		expect(result.summary.correction?.by).toEqual({ id: sisterId, name: "妹" });
	});

	it("結びついた作目に合わない品種を指定した訂正は拒否され、版は増えない", async () => {
		const cucumber = await data.crop(farm, { name: "キュウリ" });
		const momotaro = await data.variety(farm, tomato, { name: "桃太郎" });
		const before = await myRecord({
			kind: "observation",
			body: "実がなった",
			performedOn: "2026-10-24",
			cropIds: [cucumber],
		});

		await expect(
			correct(me.client, before, ([item]) => [
				{ ...(item as CorrectedItem), varieties: [{ id: momotaro }] },
			]),
		).rejects.toThrow(CorrectionRejected);
		await expect(
			correct(me.client, before, ([item]) => [
				{
					...(item as CorrectedItem),
					crops: [],
					varieties: [{ id: momotaro }],
				},
			]),
		).rejects.toThrow(CorrectionRejected);
		expect(await loadSummary(me.client, before.recordId)).toEqual(before);
	});

	it("AI が作目なしで品種だけ結びつけた版も、何も変えずに保存すれば、拒否されずに元にした版が返る", async () => {
		const momotaro = await data.variety(farm, tomato, { name: "桃太郎" });
		const before = await myRecord({
			kind: "observation",
			body: "桃太郎の実が割れた",
			performedOn: "2026-10-24",
			varietyIds: [momotaro],
		});

		const result = await correct(me.client, before, (items) => items);

		expect(result).toEqual({ status: "unchanged", summary: before });
	});

	it("他の農場の圃場・作目・品種を指定した訂正は拒否される", async () => {
		const otherFarm = await data.farm("別の農場");
		const otherField = await data.field(otherFarm, { name: "よその畑" });
		const otherCrop = await data.crop(otherFarm, { name: "よそのトマト" });
		const otherVariety = await data.variety(otherFarm, otherCrop, {
			name: "よその品種",
		});
		const before = await myRecord({
			kind: "observation",
			body: "葉が巻いていた",
			performedOn: "2026-10-24",
			cropIds: [tomato],
		});

		for (const edit of [
			(item: CorrectedItem) => ({ ...item, fields: [{ id: otherField }] }),
			(item: CorrectedItem) => ({ ...item, crops: [{ id: otherCrop }] }),
			(item: CorrectedItem) => ({
				...item,
				crops: [{ id: otherCrop }],
				varieties: [{ id: otherVariety }],
			}),
		])
			await expect(
				correct(me.client, before, ([item]) => [edit(item as CorrectedItem)]),
			).rejects.toThrow(CorrectionRejected);
		expect(await loadSummary(me.client, before.recordId)).toEqual(before);
	});

	it("他の農場のメンバー・農場を離れたメンバーは訂正できず、版のない記録は訂正できない", async () => {
		const before = await myRecord({
			kind: "observation",
			body: "葉が巻いていた",
			performedOn: "2026-10-24",
		});
		const relink = (items: CorrectedItem[]) =>
			items.map((item) => ({ ...item, fields: [{ id: house1 }] }));

		const otherFarm = await data.farm("別の農場");
		const stranger = await data.user("stranger");
		await data.member(otherFarm, {
			userId: stranger.userId,
			displayName: "よその人",
		});
		await expect(correct(stranger.client, before, relink)).rejects.toThrow(
			CorrectionRejected,
		);

		const leaver = await data.user("leaver");
		await data.member(farm, {
			userId: leaver.userId,
			displayName: "離れた人",
			leftAt: "2026-09-01T00:00:00Z",
		});
		await expect(correct(leaver.client, before, relink)).rejects.toThrow(
			CorrectionRejected,
		);
		expect(await loadSummary(me.client, before.recordId)).toEqual(before);

		const unversioned = crypto.randomUUID();
		await adminClient()
			.from("records")
			.insert({
				id: unversioned,
				farm_id: farm,
				recorder_member_id: me.memberId,
				recorded_at: "2026-10-24T08:00:00Z",
				audio_path: `${farm}/${unversioned}/audio`,
			});
		await expect(
			correctRecord(me.client, {
				recordId: unversioned,
				baseVersionId: before.versionId,
				items: [],
			}),
		).rejects.toThrow(CorrectionRejected);
	});

	it("古い版を元にした訂正は拒否されて最新の版が返り、それをもとに直し直せる", async () => {
		const sister = await data.user("sister");
		await data.member(farm, { userId: sister.userId, displayName: "妹" });
		const original = await myRecord({
			kind: "observation",
			body: "葉が巻いていた",
			performedOn: "2026-10-24",
		});
		const mine = await correct(me.client, original, ([item]) => [
			{ ...(item as CorrectedItem), text: "下の葉が巻いていた" },
		]);

		const stale = await correct(sister.client, original, ([item]) => [
			{ ...(item as CorrectedItem), fields: [{ id: house1 }] },
		]);

		expect(stale).toEqual({ status: "stale", summary: mine.summary });
		const retried = await correct(sister.client, stale.summary, ([item]) => [
			{ ...(item as CorrectedItem), fields: [{ id: house1 }] },
		]);
		expect(retried.status).toBe("corrected");
		expect(retried.summary.items[0]?.text).toBe("下の葉が巻いていた");
		expect(retried.summary.items[0]?.fields).toEqual([
			{ id: house1, name: "1番ハウス" },
		]);
		expect(retried.summary.correction?.basedOnVersionId).toBe(
			mine.summary.versionId,
		);
	});

	it("取り出しを足す・消す・0 件にすることができ、0 件の版に足すこともできる", async () => {
		const added: CorrectedItem = {
			kind: "work",
			materials: [],
			text: "脇芽をかいた",
			performedOn: "2026-10-24",
			fields: [{ id: house1 }],
			crops: [{ id: tomato }],
			varieties: [],
		};
		const before = await myRecord(
			{
				kind: "observation",
				body: "余計な取り出し",
				performedOn: "2026-10-24",
			},
			{
				kind: "observation",
				body: "葉が巻いていた",
				performedOn: "2026-10-24",
			},
		);

		const edited = await correct(me.client, before, ([, kept]) => [
			kept as CorrectedItem,
			added,
		]);
		expect(edited.summary.items.map((item) => item.text)).toEqual([
			"葉が巻いていた",
			"脇芽をかいた",
		]);

		const emptied = await correct(me.client, edited.summary, () => []);
		expect(emptied.status).toBe("corrected");
		expect(emptied.summary.items).toEqual([]);

		const refilled = await correct(me.client, emptied.summary, () => [added]);
		expect(refilled.status).toBe("corrected");
		expect(refilled.summary.items.map((item) => item.text)).toEqual([
			"脇芽をかいた",
		]);
	});

	it("根拠に指された観察を消すと、その根拠は観察の文章だけの根拠になり、後ろの観察を指す根拠は同じ観察を指したまま保存される", async () => {
		const before = await myRecord(
			{
				kind: "observation",
				body: "葉が巻いていた",
				performedOn: "2026-10-24",
			},
			{
				kind: "observation",
				body: "下の葉が黄色い",
				performedOn: "2026-10-24",
			},
			{
				kind: "judgment",
				body: "消毒することにした",
				performedOn: "2026-10-24",
				judgeId: me.memberId,
				grounds: [{ observation: 0 }, { observation: 1 }],
			},
		);

		const removed = removeItem(toCorrectedItems(before), 0);
		expect(removed.detached).toBe(1);
		const result = await correctRecord(me.client, {
			recordId: before.recordId,
			baseVersionId: before.versionId,
			items: removed.items,
		});

		expect(result.status).toBe("corrected");
		const judgment = result.summary.items[1];
		expect(judgment?.kind === "judgment" && judgment.grounds).toEqual([
			{ observation: null, text: "葉が巻いていた" },
			{ observation: 0, text: "下の葉が黄色い" },
		]);
	});
});
