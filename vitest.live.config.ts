import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// 本物の構造化・文字起こしを呼ぶテスト（`npm run test:live`）。料金がかかるので `npm test` には入れない。
// 鍵は、環境変数か、Edge Functions と同じ supabase/functions/.env から読む（中身は表示しない）。
const functionsEnv = "supabase/functions/.env";
if (existsSync(functionsEnv)) process.loadEnvFile(functionsEnv);

export default defineConfig({
	test: {
		name: "live",
		include: ["tests/live/**/*.test.ts"],
		testTimeout: 120_000,
	},
});
