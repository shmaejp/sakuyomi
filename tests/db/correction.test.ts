import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type CorrectedItem,
	CorrectionRejected,
	correctRecord,
	removeItem,
	toCorrectedItems,
} from "../../src/correction";
import type { Client } from "../../src/lib/supabase";
import { loadRelatedRecords } from "../../src/related";
import {
	loadSummary,
	type RecordSummary,
} from "../../supabase/functions/_shared/summary.ts";
import {
	adminClient,
	TestData,
	type TestItem,
	relatedTexts as texts,
} from "./support";

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

	describe("判断者・根拠・資材/量/倍率", () => {
		/** 観察 1 つ、判断 1 つ、作業 1 つの記録。 */
		function threeKinds(judgeId: string) {
			return myRecord(
				{
					kind: "observation",
					body: "葉が巻いていた",
					performedOn: "2026-10-24",
				},
				{
					kind: "judgment",
					body: "消毒することにした",
					performedOn: "2026-10-24",
					judgeId,
					grounds: [{ observation: 0 }],
				},
				{ kind: "work", body: "消毒した", performedOn: "2026-10-24" },
			);
		}

		/** 取り出しを、種別に合わない中身ごと差し替える（画面の型では作れない形を、サーバーが拒否するか確かめる）。 */
		function asUntypedItem(item: Record<string, unknown>): CorrectedItem {
			return item as unknown as CorrectedItem;
		}

		it("判断者をアプリを使わないメンバーに選び直し、根拠を足す・消す・直し、資材・量・倍率を直す・空にできる", async () => {
			const father = await data.member(farm, { displayName: "父" });
			const before = await threeKinds(me.memberId);

			const result = await correct(
				me.client,
				before,
				([observation, judgment, work]) => [
					observation as CorrectedItem,
					{
						...(judgment as CorrectedItem),
						kind: "judgment",
						judgeId: father,
						grounds: [{ text: "JA の指導員に言われた" }, { observation: 0 }],
					},
					{
						...(work as CorrectedItem),
						kind: "work",
						materials: [
							{ name: "ダコニール", amount: null, dilution: "1000倍" },
							{ name: "展着剤", amount: "5ml", dilution: null },
						],
					},
				],
			);

			expect(result.status).toBe("corrected");
			const [, judgment, work] = result.summary.items;
			expect(judgment?.kind === "judgment" && judgment.judge).toEqual({
				id: father,
				name: "父",
			});
			expect(judgment?.kind === "judgment" && judgment.grounds).toEqual([
				{ observation: null, text: "JA の指導員に言われた" },
				{ observation: 0, text: "葉が巻いていた" },
			]);
			expect(work?.kind === "work" && work.materials).toEqual([
				{ name: "ダコニール", amount: null, dilution: "1000倍" },
				{ name: "展着剤", amount: "5ml", dilution: null },
			]);

			const emptied = await correct(me.client, result.summary, (items) =>
				items.map((item) =>
					item.kind === "work"
						? { ...item, materials: [] }
						: item.kind === "judgment"
							? { ...item, grounds: [] }
							: item,
				),
			);
			const [, noGrounds, noMaterials] = emptied.summary.items;
			expect(noGrounds?.kind === "judgment" && noGrounds.grounds).toEqual([]);
			expect(noMaterials?.kind === "work" && noMaterials.materials).toEqual([]);
		});

		it("他の農場のメンバーを判断者にした訂正は拒否される", async () => {
			const otherFarm = await data.farm("別の農場");
			const stranger = await data.member(otherFarm, {
				displayName: "よその人",
			});
			const before = await threeKinds(me.memberId);

			await expect(
				correct(me.client, before, (items) =>
					items.map((item) =>
						item.kind === "judgment" ? { ...item, judgeId: stranger } : item,
					),
				),
			).rejects.toThrow(CorrectionRejected);
			expect(await loadSummary(me.client, before.recordId)).toEqual(before);
		});

		it("根拠が、新しい版にない観察や、観察でない取り出しを指す訂正は拒否される", async () => {
			const before = await threeKinds(me.memberId);
			const pointTo = (observation: number) => (items: CorrectedItem[]) =>
				items.map((item) =>
					item.kind === "judgment"
						? { ...item, grounds: [{ observation }] }
						: item,
				);

			// 観察を消したのに、根拠がその位置を指したまま。
			await expect(
				correct(me.client, before, (items) => pointTo(2)(items.slice(1))),
			).rejects.toThrow(CorrectionRejected);
			// 作業を指している。
			await expect(correct(me.client, before, pointTo(2))).rejects.toThrow(
				CorrectionRejected,
			);
			expect(await loadSummary(me.client, before.recordId)).toEqual(before);
		});

		it("観察や作業に判断者・根拠を、観察や判断に資材・量・倍率を持たせた訂正は拒否される", async () => {
			const before = await threeKinds(me.memberId);
			const base = {
				text: "葉が巻いていた",
				performedOn: "2026-10-24",
				fields: [],
				crops: [],
				varieties: [],
			};
			const material = { name: "ダコニール", amount: null, dilution: null };

			for (const wrong of [
				{ ...base, kind: "observation", judgeId: me.memberId, grounds: [] },
				{ ...base, kind: "observation", grounds: [{ text: "なんとなく" }] },
				{
					...base,
					kind: "work",
					grounds: [{ text: "なんとなく" }],
					materials: [],
				},
				{ ...base, kind: "observation", materials: [material] },
				{
					...base,
					kind: "judgment",
					judgeId: null,
					grounds: [],
					materials: [material],
				},
			])
				await expect(
					correct(me.client, before, () => [asUntypedItem(wrong)]),
				).rejects.toThrow(CorrectionRejected);
			expect(await loadSummary(me.client, before.recordId)).toEqual(before);
		});
	});

	describe("訂正の後の即時応答の後半", () => {
		/** 自分の記録を 1 件作る（取り出しは 1 つで、実施日は記録した日）。 */
		async function recordOn(
			recordedAt: string,
			body: string,
			links: { fieldIds?: string[]; cropIds?: string[] },
		) {
			const recordId = await data.record(farm, {
				recorderId: me.memberId,
				recordedAt,
				items: [
					{
						kind: "observation",
						body,
						performedOn: recordedAt.slice(0, 10),
						...links,
					},
				],
			});
			const summary = await loadSummary(me.client, recordId);
			if (!summary) throw new Error("要約がありません");
			return summary;
		}

		it("訂正で結びつけた圃場・作目では他の記録の直近の記録・去年の同じ時期の記録に出て、外した圃場・作目では出なくなる", async () => {
			const cucumber = await data.crop(farm, { name: "キュウリ" });
			const house2 = await data.field(farm, { name: "2番ハウス" });
			const lastYearSummary = await recordOn(
				"2025-10-20T00:00:00Z",
				"去年の記録",
				{
					fieldIds: [house2],
					cropIds: [cucumber],
				},
			);
			const tomatoToday = await recordOn(
				"2026-10-24T00:00:00Z",
				"1番のトマト",
				{
					fieldIds: [house1],
					cropIds: [tomato],
				},
			);
			const cucumberToday = await recordOn(
				"2026-10-24T01:00:00Z",
				"2番のキュウリ",
				{ fieldIds: [house2], cropIds: [cucumber] },
			);
			const beforeTomato = await loadRelatedRecords(
				me.client,
				tomatoToday.recordId,
			);
			expect(texts(beforeTomato.recent)).toEqual([]);
			expect(texts(beforeTomato.lastYear)).toEqual([]);
			const beforeCucumber = await loadRelatedRecords(
				me.client,
				cucumberToday.recordId,
			);
			expect(texts(beforeCucumber.recent)).toEqual(["去年の記録"]);
			expect(texts(beforeCucumber.lastYear)).toEqual(["去年の記録"]);

			// 去年の記録を、キュウリと 2 番ハウスから、トマトと 1 番ハウスに直す。
			await correct(me.client, lastYearSummary, ([item]) => [
				{
					...(item as CorrectedItem),
					fields: [{ id: house1 }],
					crops: [{ id: tomato }],
				},
			]);

			const afterTomato = await loadRelatedRecords(
				me.client,
				tomatoToday.recordId,
			);
			expect(texts(afterTomato.recent)).toEqual(["去年の記録"]);
			expect(texts(afterTomato.lastYear)).toEqual(["去年の記録"]);
			const afterCucumber = await loadRelatedRecords(
				me.client,
				cucumberToday.recordId,
			);
			expect(texts(afterCucumber.recent)).toEqual([]);
			expect(texts(afterCucumber.lastYear)).toEqual([]);
		});

		it("訂正した記録自身の即時応答の後半は、直した圃場・作目で取り直される", async () => {
			const cucumber = await data.crop(farm, { name: "キュウリ" });
			await recordOn("2026-10-20T00:00:00Z", "前のキュウリ", {
				cropIds: [cucumber],
			});
			const today = await recordOn("2026-10-24T00:00:00Z", "今日の記録", {
				cropIds: [tomato],
			});
			expect(
				texts((await loadRelatedRecords(me.client, today.recordId)).recent),
			).toEqual([]);

			await correct(me.client, today, ([item]) => [
				{ ...(item as CorrectedItem), crops: [{ id: cucumber }] },
			]);

			expect(
				texts((await loadRelatedRecords(me.client, today.recordId)).recent),
			).toEqual(["前のキュウリ"]);
		});
	});
});
