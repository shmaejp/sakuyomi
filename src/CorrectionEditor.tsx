import { useEffect, useState } from "react";
import { farmDateOf } from "../supabase/functions/_shared/dates.ts";
import {
	type CorrectedItem,
	type CorrectedLink,
	type CorrectionChoices,
	CorrectionRejected,
	changeKind,
	correctRecord,
	linkedIds,
	loadCorrectionChoices,
	removeItem,
	toCorrectedItems,
} from "./correction";
import { supabase } from "./lib/supabase";
import type { RecordSummary } from "./record";

const KINDS = [
	{ kind: "observation", label: "観察" },
	{ kind: "judgment", label: "判断" },
	{ kind: "work", label: "作業" },
] as const;

type Choice = { id: string; name: string; spokenNames: string[] };

// 要約の取り出しを直し、まとめて 1 回で保存する（訂正）。直したくなければ「やめる」で閉じるだけ。
// 保存できなければ（圏外など）、直した内容は画面に残す。送信待ちの列には入れない。
export function CorrectionEditor({
	summary,
	onSaved,
	onCancel,
}: {
	summary: RecordSummary;
	/** 保存できたとき（何も変わっていなかったときも）。最新の版の要約を渡す。 */
	onSaved: (summary: RecordSummary) => void;
	onCancel: () => void;
}) {
	const [base, setBase] = useState(summary);
	const [items, setItems] = useState(() => toCorrectedItems(summary));
	const [choices, setChoices] = useState<CorrectionChoices | null>(null);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		loadCorrectionChoices(supabase).then(setChoices, () =>
			setMessage("圃場・作目の一覧を読み込めませんでした。"),
		);
	}, []);

	function update(index: number, item: CorrectedItem) {
		setItems((current) => current.map((it, i) => (i === index ? item : it)));
	}

	// 消した観察・観察でなくした取り出しを指していた根拠は、文章だけの根拠になる。そのことを知らせる。
	function apply(result: { items: CorrectedItem[]; detached: number }) {
		setItems(result.items);
		setMessage(
			result.detached > 0
				? "この観察を根拠にしていた判断は、観察の文章だけを根拠として残します。"
				: null,
		);
	}

	async function save() {
		setSaving(true);
		setMessage(null);
		try {
			const result = await correctRecord(supabase, {
				recordId: base.recordId,
				baseVersionId: base.versionId,
				items,
			});
			if (result.status === "stale") {
				// 他の人の訂正を黙って上書きしない。最新の内容を見せて、直し直してもらう。
				setBase(result.summary);
				setItems(toCorrectedItems(result.summary));
				setMessage(
					"他のメンバーが先に直していました。最新の内容を表示しています。必要ならもう一度直してください。",
				);
				return;
			}
			onSaved(result.summary);
		} catch (error) {
			setMessage(
				error instanceof CorrectionRejected
					? "保存できませんでした。登録されていない圃場・作目・品種や、作目に合わない品種がないか確かめてください。直した内容は残っています。"
					: "保存できませんでした。直した内容は残っています。電波のあるところで、もう一度保存してください。",
			);
		} finally {
			setSaving(false);
		}
	}

	if (!choices) return <p role="status">{message ?? "読み込んでいます…"}</p>;
	return (
		<div className="correction">
			{items.map((item, i) => (
				<ItemEditor
					// 取り出しは並び順そのものが識別になる。
					// biome-ignore lint/suspicious/noArrayIndexKey: 編集中の並び順で区別する
					key={i}
					item={item}
					choices={choices}
					onChange={(changed) => update(i, changed)}
					onKindChange={(kind) => apply(changeKind(items, i, kind))}
					onRemove={() => apply(removeItem(items, i))}
				/>
			))}
			<button
				type="button"
				className="secondary"
				onClick={() =>
					setItems((current) => [
						...current,
						{
							kind: "observation",
							text: "",
							performedOn:
								items[0]?.performedOn ?? farmDateOf(new Date().toISOString()),
							fields: [],
							crops: [],
							varieties: [],
						},
					])
				}
			>
				取り出しを足す
			</button>
			{message && <p role="alert">{message}</p>}
			<button
				type="button"
				onClick={save}
				disabled={saving || items.some((item) => item.text.trim() === "")}
			>
				{saving ? "保存しています…" : "保存する"}
			</button>
			<button
				type="button"
				className="secondary"
				onClick={onCancel}
				disabled={saving}
			>
				やめる
			</button>
		</div>
	);
}

function ItemEditor({
	item,
	choices,
	onChange,
	onKindChange,
	onRemove,
}: {
	item: CorrectedItem;
	choices: CorrectionChoices;
	onChange: (item: CorrectedItem) => void;
	onKindChange: (kind: CorrectedItem["kind"]) => void;
	onRemove: () => void;
}) {
	const cropIds = new Set(linkedIds(item.crops));
	// 品種は、結びついた作目の品種だけを出す。作目を外したら、その作目の品種も外す。
	const varieties = choices.varieties.filter((v) => cropIds.has(v.cropId));
	const changeCrops = (crops: CorrectedLink[]) => {
		const kept = new Set(linkedIds(crops));
		const allowed = new Set(
			choices.varieties.filter((v) => kept.has(v.cropId)).map((v) => v.id),
		);
		onChange({
			...item,
			crops,
			varieties: item.varieties.filter(
				(v) => !("id" in v) || allowed.has(v.id),
			),
		});
	};

	return (
		<fieldset className="correction-item">
			<div className="kinds">
				{KINDS.map(({ kind, label }) => (
					<label key={kind} className="choice">
						<input
							type="radio"
							checked={item.kind === kind}
							onChange={() => onKindChange(kind)}
						/>
						{label}
					</label>
				))}
			</div>
			<label>
				文章
				<textarea
					value={item.text}
					onChange={(event) => onChange({ ...item, text: event.target.value })}
				/>
			</label>
			<label>
				実施日
				<input
					type="date"
					value={item.performedOn}
					required
					onChange={(event) =>
						event.target.value &&
						onChange({ ...item, performedOn: event.target.value })
					}
				/>
			</label>
			<LinkPicker
				title="圃場"
				links={item.fields}
				choices={choices.fields.map((f) => ({
					...f,
					name: f.retired ? `${f.name}（廃止）` : f.name,
				}))}
				onChange={(fields) => onChange({ ...item, fields })}
			/>
			<LinkPicker
				title="作目"
				links={item.crops}
				choices={choices.crops}
				onChange={changeCrops}
			/>
			{(varieties.length > 0 || item.varieties.length > 0) && (
				<LinkPicker
					title="品種"
					links={item.varieties}
					choices={varieties}
					onChange={(changed) => onChange({ ...item, varieties: changed })}
				/>
			)}
			<button type="button" className="secondary" onClick={onRemove}>
				この取り出しを消す
			</button>
		</fieldset>
	);
}

/** 登録された一覧から呼び名つきで選ぶ。未確定の結びつき（話の中の言い方）は外すだけができる。 */
function LinkPicker({
	title,
	links,
	choices,
	onChange,
}: {
	title: string;
	links: CorrectedLink[];
	choices: Choice[];
	onChange: (links: CorrectedLink[]) => void;
}) {
	const selected = new Set(linkedIds(links));
	const unresolved = links.flatMap((l) => ("spokenAs" in l ? [l] : []));
	return (
		<div className="link-picker">
			<span className="link-title">{title}</span>
			{unresolved.map((link) => (
				<label key={link.spokenAs} className="choice">
					<input
						type="checkbox"
						checked
						onChange={() => onChange(links.filter((l) => l !== link))}
					/>
					{link.spokenAs}（未確定）
				</label>
			))}
			{choices.map((choice) => (
				<label key={choice.id} className="choice">
					<input
						type="checkbox"
						checked={selected.has(choice.id)}
						onChange={(event) =>
							onChange(
								event.target.checked
									? [...links, { id: choice.id }]
									: links.filter((l) => !("id" in l) || l.id !== choice.id),
							)
						}
					/>
					{choice.name}
					{choice.spokenNames.length > 0 && (
						<span className="spoken-names">
							（{choice.spokenNames.join("・")}）
						</span>
					)}
				</label>
			))}
		</div>
	);
}
