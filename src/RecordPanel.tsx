import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { shrinkPhoto } from "./photo";
import { type NewRecord, type RecordSummary, sendRecord } from "./record";

type State =
	| { kind: "idle" }
	| { kind: "recording" }
	| { kind: "sending" }
	/** summary が null なら、記録は保存したが要約はない。 */
	| { kind: "done"; summary: RecordSummary | null; photos: Blob[] }
	/** unsent は送れなかった記録。同じ記録 ID のまま送り直せる。 */
	| { kind: "failed"; message: string; unsent?: NewRecord };

const KIND_LABELS = { observation: "観察", judgment: "判断", work: "作業" };

// 写真を 0 枚以上撮ってから、ボタン 1 つで録音を始め、もう 1 度押すと終えて送り、要約を表示する。
// 写真だけの記録も送れる。記録 ID と記録日時は、最初の写真を撮ったとき（なければ録音を始めたとき）に決める。
export function RecordPanel() {
	const [state, setState] = useState<State>({ kind: "idle" });
	const [photos, setPhotos] = useState<Blob[]>([]);
	// 縮めている途中の写真の数。縮め終わるまでは送らない（写真が記録から抜けないように）。
	const [shrinking, setShrinking] = useState(0);
	const draft = useRef<{ recordId: string; recordedAt: string } | null>(null);
	const recorder = useRef<MediaRecorder | null>(null);
	const camera = useRef<HTMLInputElement>(null);

	function startDraft() {
		draft.current ??= {
			recordId: crypto.randomUUID(),
			recordedAt: new Date().toISOString(),
		};
		return draft.current;
	}

	async function addPhotos(files: FileList | null) {
		if (!files || files.length === 0) return;
		startDraft();
		setShrinking((count) => count + 1);
		try {
			const shrunk = await Promise.all([...files].map(shrinkPhoto));
			setPhotos((current) => [...current, ...shrunk]);
		} catch {
			setState({ kind: "failed", message: "写真を読み込めませんでした。" });
		} finally {
			setShrinking((count) => count - 1);
		}
	}

	function sendDraft(audio: Blob | null) {
		const { recordId, recordedAt } = startDraft();
		return deliver({ recordId, recordedAt, audio, photos });
	}

	async function deliver(record: NewRecord) {
		setState({ kind: "sending" });
		try {
			const response = await sendRecord(supabase, record);
			draft.current = null;
			setPhotos([]);
			setState({
				kind: "done",
				summary: response.status === "summarized" ? response.summary : null,
				photos: record.photos,
			});
		} catch {
			// 送れなかった記録は、同じ記録 ID のまま「もう一度送る」で送り直せる（記録処理関数で二重にならない）。
			// 録り直すときは、写真と記録日時は残したまま、新しい記録 ID にする。
			// 送れなかった記録が実はサーバーに届いていたとき、録り直した音声が届いていた記録に紛れないようにするため。
			if (draft.current)
				draft.current = { ...draft.current, recordId: crypto.randomUUID() };
			setState({
				kind: "failed",
				message: "記録を送れませんでした。電波のあるところで試してください。",
				unsent: record,
			});
		}
	}

	async function start() {
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			setState({
				kind: "failed",
				message: "マイクを使えません。マイクの使用を許可してください。",
			});
			return;
		}
		startDraft();
		const chunks: Blob[] = [];
		const mediaRecorder = new MediaRecorder(stream);
		mediaRecorder.ondataavailable = (event) => chunks.push(event.data);
		mediaRecorder.onstop = () => {
			for (const track of stream.getTracks()) track.stop();
			sendDraft(new Blob(chunks, { type: mediaRecorder.mimeType }));
		};
		recorder.current = mediaRecorder;
		mediaRecorder.start();
		setState({ kind: "recording" });
	}

	function stop() {
		recorder.current?.stop();
		recorder.current = null;
	}

	const busy = state.kind === "recording" || state.kind === "sending";
	const unsent = state.kind === "failed" ? state.unsent : undefined;
	const canSend = !busy && shrinking === 0;

	return (
		<section className="record-panel">
			{photos.length > 0 && <Photos photos={photos} />}
			<input
				ref={camera}
				type="file"
				accept="image/*"
				capture="environment"
				multiple
				hidden
				onChange={(event) => {
					addPhotos(event.target.files);
					event.target.value = "";
				}}
			/>
			<button
				type="button"
				className="secondary"
				onClick={() => camera.current?.click()}
				disabled={busy}
			>
				{photos.length > 0 ? "写真をもう 1 枚撮る" : "写真を撮る"}
			</button>
			{state.kind === "recording" ? (
				<button
					type="button"
					className="record-button recording"
					onClick={stop}
				>
					終えて送る
				</button>
			) : (
				<button
					type="button"
					className="record-button"
					onClick={start}
					disabled={!canSend}
				>
					{state.kind === "sending"
						? "送っています…"
						: shrinking > 0
							? "写真を読み込んでいます…"
							: "録音する"}
				</button>
			)}
			{photos.length > 0 && canSend && (
				<button
					type="button"
					className="secondary"
					onClick={() => sendDraft(null)}
				>
					写真だけ送る
				</button>
			)}
			{state.kind === "failed" && (
				<>
					<p role="alert">{state.message}</p>
					{unsent && (
						<button
							type="button"
							className="secondary"
							onClick={() => deliver(unsent)}
						>
							もう一度送る
						</button>
					)}
				</>
			)}
			{state.kind === "done" && (
				<>
					{state.photos.length > 0 && <Photos photos={state.photos} />}
					{state.summary ? (
						<Summary summary={state.summary} />
					) : (
						<p>記録は保存しました。要約は作れませんでした。</p>
					)}
				</>
			)}
		</section>
	);
}

/** 記録の写真を、撮った順に並べて表示する。 */
function Photos({ photos }: { photos: Blob[] }) {
	const [urls, setUrls] = useState<string[]>([]);
	useEffect(() => {
		const created = photos.map((photo) => URL.createObjectURL(photo));
		setUrls(created);
		return () => {
			for (const url of created) URL.revokeObjectURL(url);
		};
	}, [photos]);
	return (
		<div className="photos">
			{urls.map((url, i) => (
				<img key={url} src={url} alt={`写真 ${i + 1}`} />
			))}
		</div>
	);
}

/** 実施日（YYYY-MM-DD）を「10月24日」の形にする。 */
function dayOf(date: string) {
	const [, month, day] = date.split("-");
	return `${Number(month)}月${Number(day)}日`;
}

function Summary({ summary }: { summary: RecordSummary }) {
	if (summary.items.length === 0)
		return <p>記録しました。取り出せる内容はありませんでした。</p>;
	return (
		<ul className="summary">
			{summary.items.map((item, i) => (
				// 取り出しは並び順そのものが識別になる。
				// biome-ignore lint/suspicious/noArrayIndexKey: 要約の中で順序は変わらない
				<li key={i}>
					<span className="kind">
						{KIND_LABELS[item.kind]}
						<span className="performed-on">{dayOf(item.performedOn)}</span>
					</span>
					<span>{item.text}</span>
					{item.kind === "judgment" && (
						<>
							<span className="detail">判断者：{item.judge.name}</span>
							{item.grounds.length > 0 && (
								<span className="detail">
									根拠：{item.grounds.map((ground) => ground.text).join("／")}
								</span>
							)}
						</>
					)}
					{item.kind === "work" && item.materials.length > 0 && (
						<span className="detail">
							資材：
							{item.materials
								.map((m) =>
									[m.name, m.dilution, m.amount]
										.filter((part) => part !== null)
										.join(" "),
								)
								.join("、")}
						</span>
					)}
					<span className="links">
						{[...item.fields, ...item.crops, ...item.varieties]
							.map((link) => (link.id ? link.name : `${link.name}（未確定）`))
							.join("・")}
					</span>
				</li>
			))}
		</ul>
	);
}
