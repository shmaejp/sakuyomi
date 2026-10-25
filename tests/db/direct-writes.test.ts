import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "../../src/lib/supabase";
import { loadSummary } from "../../supabase/functions/_shared/summary.ts";
import { TestData } from "./support";

// 版と取り出しは、記録処理（save_ai_version）と訂正（correct_record）の入口からだけ書ける。
// 入口の検査（古い版を元にした訂正・品種と作目・何も変えない訂正・1 回での保存）を飛ばせないようにし、
// 書き終えた版に後から足せないようにするため（ADR 0001・0006）。
describe("版と取り出しへの直接の書き込み", () => {
	let data: TestData;
	let farm: string;
	let me: { client: Client; memberId: string };
	let tomato: string;
	let field: string;

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
		tomato = await data.crop(farm, { name: "トマト" });
		field = await data.field(farm, { name: "1番ハウス" });
	});

	afterEach(async () => {
		await data.cleanUp();
	});

	it("農場メンバーでも、版を直接作れず、既にある版に取り出し・結びつき・根拠・資材を足せない", async () => {
		const recordId = await data.record(farm, {
			recorderId: me.memberId,
			recordedAt: "2026-10-24T08:00:00Z",
			items: [
				{
					kind: "observation",
					body: "葉が巻いていた",
					performedOn: "2026-10-24",
				},
				{
					kind: "judgment",
					body: "消毒することにした",
					performedOn: "2026-10-24",
					judgeId: me.memberId,
				},
				{ kind: "work", body: "消毒した", performedOn: "2026-10-24" },
			],
		});
		const before = await loadSummary(me.client, recordId);
		if (!before) throw new Error("要約がありません");
		const { data: extractions } = await me.client
			.from("extractions")
			.select("id, kind")
			.eq("version_id", before.versionId)
			.order("position");
		const [observation, judgment, work] = (extractions ?? []).map((e) => e.id);
		if (!observation || !judgment || !work)
			throw new Error("取り出しがありません");

		const attempts = {
			AIの版: me.client.from("versions").insert({
				farm_id: farm,
				record_id: recordId,
				author: "ai",
			}),
			人の版: me.client.from("versions").insert({
				farm_id: farm,
				record_id: recordId,
				author: "human",
				corrected_by_member_id: me.memberId,
				based_on_version_id: before.versionId,
			}),
			取り出し: me.client.from("extractions").insert({
				farm_id: farm,
				version_id: before.versionId,
				position: 3,
				kind: "observation",
				body: "後から足した",
				performed_on: "2026-10-24",
			}),
			圃場の結びつき: me.client.from("extraction_fields").insert({
				farm_id: farm,
				extraction_id: observation,
				position: 0,
				field_id: field,
			}),
			作目の結びつき: me.client.from("extraction_crops").insert({
				farm_id: farm,
				extraction_id: observation,
				position: 0,
				crop_id: tomato,
			}),
			品種の結びつき: me.client.from("extraction_varieties").insert({
				farm_id: farm,
				extraction_id: observation,
				position: 0,
				spoken_as: "桃太郎",
			}),
			根拠: me.client.from("grounds").insert({
				farm_id: farm,
				judgment_id: judgment,
				position: 0,
				observation_id: observation,
			}),
			資材: me.client.from("work_materials").insert({
				farm_id: farm,
				work_id: work,
				position: 0,
				name: "ダコニール",
			}),
		};

		for (const [label, attempt] of Object.entries(attempts)) {
			const { error } = await attempt;
			// RLS（制限的なポリシー）で拒否される。一意制約などの別の理由で落ちたのではないことも確かめる。
			expect(error?.code, label).toBe("42501");
		}
		expect(await loadSummary(me.client, recordId)).toEqual(before);
	});
});
