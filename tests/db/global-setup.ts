import { execFileSync } from "node:child_process";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		supabaseUrl: string;
		anonKey: string;
		serviceRoleKey: string;
	}
}

// 起動中のローカル Supabase の接続情報を `supabase status` から読み、テストに渡す。鍵はファイルに書かない。
export default function setup(project: TestProject) {
	let output: string;
	try {
		output = execFileSync(
			process.execPath,
			["node_modules/supabase/dist/supabase.js", "status", "-o", "env"],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch {
		throw new Error(
			"ローカルの Supabase が起動していません。`npx supabase start` を実行してください。",
		);
	}
	const env = Object.fromEntries(
		output
			.split(/\r?\n/)
			.map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
			.filter((m): m is RegExpMatchArray => m !== null)
			.map((m) => [m[1], m[2]]),
	);
	const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = env;
	if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
		throw new Error(
			"`supabase status -o env` から API_URL・ANON_KEY・SERVICE_ROLE_KEY を読めませんでした。",
		);
	}
	project.provide("supabaseUrl", API_URL);
	project.provide("anonKey", ANON_KEY);
	project.provide("serviceRoleKey", SERVICE_ROLE_KEY);
}
