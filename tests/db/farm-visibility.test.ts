import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMyFarm } from "../../src/farm";
import type { Client } from "../../src/lib/supabase";
import { anonClient, TestData } from "./support";

const tables = ["farms", "farm_members", "fields", "crops"] as const;

async function visibleRows(client: Client) {
	const rows: Record<string, unknown[]> = {};
	for (const table of tables) {
		const { data } = await client.from(table).select("*");
		rows[table] = data ?? [];
	}
	return rows;
}

describe("農場の見え方", () => {
	let data: TestData;
	let farmA: string;

	beforeEach(async () => {
		data = new TestData();
		farmA = await data.farm("前田農場");
		await data.field(farmA, {
			name: "1番ハウス",
			spokenNames: ["1番", "手前のハウス"],
		});
		await data.field(farmA, { name: "3番ハウス", spokenNames: ["奥のハウス"] });
		await data.field(farmA, {
			name: "旧2番ハウス",
			retiredAt: new Date().toISOString(),
		});
		await data.crop(farmA, { name: "トマト", spokenNames: ["とまと"] });
		await data.member(farmA, { displayName: "父", spokenNames: ["親父"] });
	});

	afterEach(async () => {
		await data.cleanUp();
	});

	it("農場メンバーは、自分の農場の名前と、廃止されていない圃場・作目を呼び名つきで見られる", async () => {
		const me = await data.user("me");
		await data.member(farmA, { userId: me.userId, displayName: "晋弥" });

		const farm = await loadMyFarm(me.client);

		expect(farm?.name).toMatch(/^前田農場-/);
		expect(farm?.fields).toEqual([
			{
				id: expect.any(String),
				name: "1番ハウス",
				spokenNames: ["1番", "手前のハウス"],
			},
			{
				id: expect.any(String),
				name: "3番ハウス",
				spokenNames: ["奥のハウス"],
			},
		]);
		expect(farm?.crops).toEqual([
			{ id: expect.any(String), name: "トマト", spokenNames: ["とまと"] },
		]);
	});

	it("農場メンバーは、アプリを使わないメンバーを含む同じ農場のメンバーを見られる", async () => {
		const me = await data.user("me");
		await data.member(farmA, { userId: me.userId, displayName: "晋弥" });

		const { data: members } = await me.client
			.from("farm_members")
			.select("display_name, user_id");

		expect(members).toEqual(
			expect.arrayContaining([
				{ display_name: "父", user_id: null },
				{ display_name: "晋弥", user_id: me.userId },
			]),
		);
	});

	it("別の農場のメンバーからは、どの表の行も見えない", async () => {
		const farmB = await data.farm("隣の農場");
		await data.field(farmB, { name: "南の畑" });
		const neighbor = await data.user("neighbor");
		await data.member(farmB, {
			userId: neighbor.userId,
			displayName: "隣の人",
		});

		const farm = await loadMyFarm(neighbor.client);
		const rows = await visibleRows(neighbor.client);

		expect(farm?.name).toMatch(/^隣の農場-/);
		expect(farm?.fields.map((f) => f.name)).toEqual(["南の畑"]);
		for (const table of tables) {
			expect(rows[table]).not.toContainEqual(
				expect.objectContaining(
					table === "farms" ? { id: farmA } : { farm_id: farmA },
				),
			);
		}
	});

	it("農場を離れたメンバーは、その農場の行を見られない", async () => {
		const left = await data.user("left");
		await data.member(farmA, {
			userId: left.userId,
			displayName: "離れた人",
			leftAt: new Date().toISOString(),
		});

		expect(await loadMyFarm(left.client)).toBeNull();
		for (const rows of Object.values(await visibleRows(left.client)))
			expect(rows).toEqual([]);
	});

	it("どの農場にも属さない人には、何も見えない", async () => {
		const stranger = await data.user("stranger");

		expect(await loadMyFarm(stranger.client)).toBeNull();
		for (const rows of Object.values(await visibleRows(stranger.client)))
			expect(rows).toEqual([]);
	});

	it("ログインしていない人には、何も見えない", async () => {
		for (const rows of Object.values(await visibleRows(anonClient())))
			expect(rows).toEqual([]);
	});
});
