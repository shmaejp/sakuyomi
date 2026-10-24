// PostToolUse hook: Claude Code が編集・作成したファイルを Biome で整形する。
// Biome が扱わない拡張子や、Biome が未インストールのときは何もしない。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const SUPPORTED = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".jsonc",
	".css",
]);

const input = JSON.parse(readFileSync(0, "utf8"));
const filePath = input.tool_input?.file_path;
if (!filePath || !SUPPORTED.has(extname(filePath).toLowerCase()))
	process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const biome = join(
	projectDir,
	"node_modules",
	"@biomejs",
	"biome",
	"bin",
	"biome",
);
if (!existsSync(biome)) process.exit(0);

const result = spawnSync(
	process.execPath,
	[biome, "format", "--write", "--no-errors-on-unmatched", filePath],
	{
		cwd: projectDir,
		encoding: "utf8",
	},
);
// 構文エラーなどで整形できなくても編集は止めず、理由だけ表示する。
if (result.status !== 0) process.stderr.write(result.stderr || result.stdout);
process.exit(0);
