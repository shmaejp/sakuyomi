import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "../../src/lib/supabase";
import { loadRelatedRecords, type RelatedRecord } from "../../src/related";
import { TestData } from "./support";

/** 返った記録を、取り出しの文章で見分ける。 */
function texts(records: RelatedRecord[]) {
	return records.map((r) =>
		r.summary.items.map((item) => item.text).join("／"),
	);
}

describe("即時応答の後半（直近の記録・去年の同じ時期の記録）", () => {
	let data: TestData;
	let farm: string;
	let me: { client: Client; memberId: string };
	let house1: string;
	let house2: string;
	let tomato: string;
	let cucumber: string;

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
		house2 = await data.field(farm, { name: "2番ハウス" });
		tomato = await data.crop(farm, { name: "トマト" });
		cucumber = await data.crop(farm, { name: "キュウリ" });
	});

	afterEach(async () => {
		await data.cleanUp();
	});

	/** 自分の記録を 1 件作る。取り出しは 1 つで、実施日は記録した日にする。 */
	function myRecord(
		recordedAt: string,
		body: string,
		links: { fieldIds?: string[]; cropIds?: string[]; varietyIds?: string[] },
	) {
		return data.record(farm, {
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
	}

	it("同じ圃場または同じ作目の直近の記録が、新しい順に返る（その記録自身と、関係のない記録は返らない）", async () => {
		await myRecord("2026-10-01T00:00:00Z", "1番のキュウリ", {
			fieldIds: [house1],
			cropIds: [cucumber],
		});
		await myRecord("2026-10-02T00:00:00Z", "2番のトマト", {
			fieldIds: [house2],
			cropIds: [tomato],
		});
		await myRecord("2026-10-03T00:00:00Z", "2番のキュウリ", {
			fieldIds: [house2],
			cropIds: [cucumber],
		});
		const target = await myRecord("2026-10-04T00:00:00Z", "1番のトマト", {
			fieldIds: [house1],
			cropIds: [tomato],
		});

		const related = await loadRelatedRecords(me.client, target);

		expect(texts(related.recent)).toEqual(["2番のトマト", "1番のキュウリ"]);
		expect(related.recent[0]?.recordedAt).toBe("2026-10-02T00:00:00+00:00");
		expect(related.recent[0]?.recorder.name).toBe("晋弥");
	});

	it("直近の記録は、設定した件数までの新しいものだけが返る", async () => {
		for (const day of ["01", "02", "03"])
			await myRecord(`2026-10-${day}T00:00:00Z`, `${day}日のトマト`, {
				cropIds: [tomato],
			});
		const target = await myRecord("2026-10-04T00:00:00Z", "今日のトマト", {
			cropIds: [tomato],
		});

		const related = await loadRelatedRecords(me.client, target, {
			recentCount: 2,
		});

		expect(texts(related.recent)).toEqual(["03日のトマト", "02日のトマト"]);
	});

	it("同じ作目で、実施日が 1 年前の同じ日付の前後に入る記録だけが、品種が一致するものから先に返る", async () => {
		const momotaro = await data.variety(farm, tomato, { name: "桃太郎" });
		const aiko = await data.variety(farm, tomato, { name: "アイコ" });
		await myRecord("2025-10-01T00:00:00Z", "去年の3日前のアイコ", {
			cropIds: [tomato],
			varietyIds: [aiko],
		});
		await myRecord("2025-10-10T00:00:00Z", "去年の6日後の桃太郎", {
			cropIds: [tomato],
			varietyIds: [momotaro],
		});
		await myRecord("2025-10-19T00:00:00Z", "去年の15日後のトマト", {
			cropIds: [tomato],
		});
		await myRecord("2025-10-04T00:00:00Z", "去年の同じ日のキュウリ", {
			fieldIds: [house1],
			cropIds: [cucumber],
		});
		await myRecord("2024-10-04T00:00:00Z", "一昨年の同じ日のトマト", {
			cropIds: [tomato],
		});
		const target = await myRecord("2026-10-04T00:00:00Z", "1番の桃太郎", {
			fieldIds: [house1],
			cropIds: [tomato],
			varietyIds: [momotaro],
		});

		const related = await loadRelatedRecords(me.client, target, {
			seasonDays: 14,
		});

		expect(texts(related.lastYear)).toEqual([
			"去年の6日後の桃太郎",
			"去年の3日前のアイコ",
		]);
	});

	it("同じ農場の他のメンバーの記録も返り、他の農場のメンバーには何も返らない", async () => {
		const father = await data.member(farm, { displayName: "父" });
		await data.record(farm, {
			recorderId: father,
			recordedAt: "2025-10-05T00:00:00Z",
			items: [
				{
					kind: "judgment",
					body: "父の去年の判断",
					performedOn: "2025-10-05",
					cropIds: [tomato],
					judgeId: father,
				},
			],
		});
		const target = await myRecord("2026-10-04T00:00:00Z", "トマト", {
			cropIds: [tomato],
		});

		const related = await loadRelatedRecords(me.client, target);
		expect(texts(related.recent)).toEqual(["父の去年の判断"]);
		expect(related.recent[0]?.recorder.name).toBe("父");
		expect(texts(related.lastYear)).toEqual(["父の去年の判断"]);

		const otherFarm = await data.farm("別の農場");
		const stranger = await data.user("stranger");
		await data.member(otherFarm, {
			userId: stranger.userId,
			displayName: "よその人",
		});
		const seenByStranger = await loadRelatedRecords(stranger.client, target);
		expect(seenByStranger).toEqual({ recent: [], lastYear: [] });
	});

	it("記録の中身と結びつきは、その記録の最新の版（訂正した人の版）から出す", async () => {
		const corrected = await myRecord(
			"2026-10-01T00:00:00Z",
			"AI はキュウリと理解",
			{
				cropIds: [cucumber],
			},
		);
		await data.version(farm, corrected, {
			correction: {
				by: me.memberId,
				basedOn: await data.latestVersion(corrected),
			},
			items: [
				{
					kind: "observation",
					body: "訂正してトマト",
					performedOn: "2026-10-01",
					cropIds: [tomato],
				},
			],
		});
		const movedAway = await myRecord(
			"2026-10-02T00:00:00Z",
			"AI はトマトと理解",
			{
				cropIds: [tomato],
			},
		);
		await data.version(farm, movedAway, {
			correction: {
				by: me.memberId,
				basedOn: await data.latestVersion(movedAway),
			},
			items: [
				{
					kind: "observation",
					body: "訂正してキュウリ",
					performedOn: "2026-10-02",
					cropIds: [cucumber],
				},
			],
		});
		const target = await myRecord("2026-10-04T00:00:00Z", "トマト", {
			cropIds: [tomato],
		});

		const related = await loadRelatedRecords(me.client, target);

		expect(texts(related.recent)).toEqual(["訂正してトマト"]);
	});

	it("該当する記録がなければ、どちらも空で返る", async () => {
		await myRecord("2026-10-01T00:00:00Z", "2番のキュウリ", {
			fieldIds: [house2],
			cropIds: [cucumber],
		});
		const target = await myRecord("2026-10-04T00:00:00Z", "1番のトマト", {
			fieldIds: [house1],
			cropIds: [tomato],
		});
		const unlinked = await myRecord(
			"2026-10-04T01:00:00Z",
			"どこの話かわからない",
			{},
		);

		expect(await loadRelatedRecords(me.client, target)).toEqual({
			recent: [],
			lastYear: [],
		});
		expect(await loadRelatedRecords(me.client, unlinked)).toEqual({
			recent: [],
			lastYear: [],
		});
	});
});
