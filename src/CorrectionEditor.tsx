import { useCallback, useEffect, useState } from "react";
import { farmDateOf } from "../supabase/functions/_shared/dates.ts";
import type { Material } from "../supabase/functions/_shared/parts.ts";
import {
	type CorrectedGround,
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
	onStale,
	onCancel,
}: {
	summary: RecordSummary;
	/** 保存できたとき（何も変わっていなかったときも）。最新の版の要約を渡す。 */
	onSaved: (summary: RecordSummary) => void;
	/** 他の人が先に直していたとき。編集は続けたまま、最新の版の要約を渡す。 */
	onStale: (summary: RecordSummary) => void;
	onCancel: () => void;
}) {
	const [base, setBase] = useState(summary);
	const [items, setItems] = useState(() => toCorrectedItems(summary));
	const [choices, setChoices] = useState<CorrectionChoices | null>(null);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	// 一覧を読み込めなかったとき（圏外など）は、読み直せるようにする。
	const [loadFailed, setLoadFailed] = useState(false);
	const loadChoices = useCallback(() => {
		setLoadFailed(false);
		loadCorrectionChoices(supabase).then(setChoices, () => setLoadFailed(true));
	}, []);

	useEffect(loadChoices, [loadChoices]);

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
		// 圏外とわかっていれば、送らずにすぐ知らせる（送ると、トークンの更新の再試行で 30 秒ほど待たされることがある）。
		if (!navigator.onLine) {
			setMessage(
				"圏外では保存できません。直した内容は残っています。電波のあるところで、もう一度保存してください。",
			);
			return;
		}
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
				onStale(result.summary);
				setMessage(
					"他のメンバーが先に直していました。最新の内容を表示しています。必要ならもう一度直してください。",
				);
				return;
			}
			onSaved(result.summary);
		} catch (error) {
			setMessage(
				error instanceof CorrectionRejected
					? "保存できませんでした。登録されていない圃場・作目・品種・判断者や、作目に合わない品種、取り出しにない観察を指す根拠がないか確かめてください。直した内容は残っています。"
					: "保存できませんでした。直した内容は残っています。電波のあるところで、もう一度保存してください。",
			);
		} finally {
			setSaving(false);
		}
	}

	// 一覧を読み込むまでも、要約に戻れるようにする。
	if (!choices) {
		return (
			<div className="correction">
				{loadFailed ? (
					<>
						<p role="alert">圃場・作目の一覧を読み込めませんでした。</p>
						<button type="button" className="secondary" onClick={loadChoices}>
							もう一度読み込む
						</button>
					</>
				) : (
					<p role="status">読み込んでいます…</p>
				)}
				<button type="button" className="secondary" onClick={onCancel}>
					やめる
				</button>
			</div>
		);
	}
	return (
		<div className="correction">
			{items.map((item, i) => (
				<ItemEditor
					// 取り出しは並び順そのものが識別になる。
					// biome-ignore lint/suspicious/noArrayIndexKey: 編集中の並び順で区別する
					key={i}
					item={item}
					choices={choices}
					observations={items.flatMap((other, j) =>
						other.kind === "observation" && j !== i
							? [{ index: j, text: other.text }]
							: [],
					)}
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
			{items.some(isIncomplete) && (
				<p className="related-status">
					空の文章・空の根拠・名前のない資材があると保存できません。
				</p>
			)}
			<button
				type="button"
				onClick={save}
				disabled={saving || items.some(isIncomplete)}
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
	observations,
	onChange,
	onKindChange,
	onRemove,
}: {
	item: CorrectedItem;
	choices: CorrectionChoices;
	/** 根拠に選べる、同じ記録の観察（編集中に足したものも含む）。index は取り出しの位置。 */
	observations: { index: number; text: string }[];
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
			{item.kind === "judgment" && (
				<>
					<label>
						判断者
						<select
							value={item.judgeId ?? ""}
							onChange={(event) =>
								onChange({ ...item, judgeId: event.target.value || null })
							}
						>
							{/* 判断に変えたばかりの取り出しは、判断者を選ぶまで記録者になる。 */}
							{item.judgeId === null && <option value="">記録者</option>}
							{choices.members
								.filter((m) => !m.left || m.id === item.judgeId)
								.map((member) => (
									<option key={member.id} value={member.id}>
										{member.name}
										{member.spokenNames.length > 0 &&
											`（${member.spokenNames.join("・")}）`}
										{member.left && "（離脱）"}
									</option>
								))}
						</select>
					</label>
					<GroundsEditor
						grounds={item.grounds}
						observations={observations}
						onChange={(grounds) => onChange({ ...item, grounds })}
					/>
				</>
			)}
			{item.kind === "work" && (
				<MaterialsEditor
					materials={item.materials}
					onChange={(materials) => onChange({ ...item, materials })}
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

/** 根拠を足す・消す・直す。同じ記録の観察を一覧から選ぶか、文章だけで書く。 */
function GroundsEditor({
	grounds,
	observations,
	onChange,
}: {
	grounds: CorrectedGround[];
	observations: { index: number; text: string }[];
	onChange: (grounds: CorrectedGround[]) => void;
}) {
	const replace = (index: number, ground: CorrectedGround) =>
		onChange(grounds.map((g, i) => (i === index ? ground : g)));
	return (
		<div className="sub-editor">
			<span className="link-title">根拠</span>
			{grounds.map((ground, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: 根拠は並び順で区別する
				<div key={i} className="sub-row">
					<select
						aria-label={`根拠 ${i + 1} の種類`}
						value={"observation" in ground ? String(ground.observation) : ""}
						onChange={(event) =>
							replace(
								i,
								event.target.value === ""
									? { text: "observation" in ground ? "" : ground.text }
									: { observation: Number(event.target.value) },
							)
						}
					>
						<option value="">文章で書く</option>
						{observations.map((o) => (
							<option key={o.index} value={o.index}>
								{o.index + 1} 番目の観察：{o.text || "（文章なし）"}
							</option>
						))}
					</select>
					{"text" in ground && (
						<input
							aria-label={`根拠 ${i + 1} の文章`}
							value={ground.text}
							onChange={(event) => replace(i, { text: event.target.value })}
						/>
					)}
					<button
						type="button"
						className="secondary"
						onClick={() => onChange(grounds.filter((_, j) => j !== i))}
					>
						この根拠を消す
					</button>
				</div>
			))}
			<button
				type="button"
				className="secondary"
				onClick={() => onChange([...grounds, { text: "" }])}
			>
				根拠を足す
			</button>
		</div>
	);
}

/** 資材・量・倍率を直す。量・倍率は空にできる（話していない値を残さないため）。 */
function MaterialsEditor({
	materials,
	onChange,
}: {
	materials: Material[];
	onChange: (materials: Material[]) => void;
}) {
	const replace = (index: number, material: Material) =>
		onChange(materials.map((m, i) => (i === index ? material : m)));
	const orNull = (value: string) => (value.trim() === "" ? null : value);
	return (
		<div className="sub-editor">
			<span className="link-title">資材</span>
			{materials.map((material, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: 資材は並び順で区別する
				<div key={i} className="sub-row">
					<input
						aria-label={`資材 ${i + 1} の名前`}
						placeholder="資材"
						value={material.name}
						onChange={(event) =>
							replace(i, { ...material, name: event.target.value })
						}
					/>
					<input
						aria-label={`資材 ${i + 1} の量`}
						placeholder="量"
						value={material.amount ?? ""}
						onChange={(event) =>
							replace(i, { ...material, amount: orNull(event.target.value) })
						}
					/>
					<input
						aria-label={`資材 ${i + 1} の倍率`}
						placeholder="倍率"
						value={material.dilution ?? ""}
						onChange={(event) =>
							replace(i, {
								...material,
								dilution: orNull(event.target.value),
							})
						}
					/>
					<button
						type="button"
						className="secondary"
						onClick={() => onChange(materials.filter((_, j) => j !== i))}
					>
						この資材を消す
					</button>
				</div>
			))}
			<button
				type="button"
				className="secondary"
				onClick={() =>
					onChange([...materials, { name: "", amount: null, dilution: null }])
				}
			>
				資材を足す
			</button>
		</div>
	);
}

/** 保存できない（空の文章・空の根拠・名前のない資材がある）取り出しか。 */
function isIncomplete(item: CorrectedItem) {
	if (item.text.trim() === "") return true;
	if (item.kind === "judgment")
		return item.grounds.some((g) => "text" in g && g.text.trim() === "");
	if (item.kind === "work")
		return item.materials.some((m) => m.name.trim() === "");
	return false;
}
