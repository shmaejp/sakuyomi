import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{ test: { name: "unit", include: ["src/**/*.test.{ts,tsx}"] } },
			{
				// 起動中のローカル Supabase に対して走るテスト。接続情報は globalSetup が用意する。
				test: {
					name: "db",
					include: ["tests/db/**/*.test.ts"],
					globalSetup: ["tests/db/global-setup.ts"],
					fileParallelism: false,
				},
			},
		],
	},
});
