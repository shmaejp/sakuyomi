import { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import {
	locationWithin,
	type MeasuredLocation,
	requestLocation,
} from "./location";
import { shrinkPhoto } from "./photo";
import type { Sender } from "./queue";
import { type RecordSummary, sendRecord } from "./record";
import {
	loadRelatedRecords,
	type RelatedRecord,
	type RelatedRecords,
} from "./related";
import { type SentRecord, useRecordQueue } from "./useRecordQueue";

type State =
	| { kind: "idle" }
	| { kind: "recording" }
	/** 記録を送信待ちの列に入れている途中（位置を待つ間も含む）。 */
	| { kind: "saving" }
	| { kind: "failed"; message: string };

const KIND_LABELS = { observation: "観察", judgment: "判断", work: "作業" };

/** 送るときに位置を待つ長さ。要約が出るまでの 10 秒の目標を圧迫しないよう短くする。 */
const LOCATION_WAIT_MS = 2000;

const sendToServer: Sender = (record) => sendRecord(supabase, record);

// 写真を 0 枚以上撮ってから、ボタン 1 つで録音を始め、もう 1 度押すと終えて送り、要約を表示する。
// 写真だけの記録も送れる。記録 ID と記録日時は、最初の写真を撮ったとき（なければ録音を始めたとき）に決める。
// 記録は電波の有無にかかわらず送信待ちの列に入れ、列が古い順に送る。送れた記録ごとに要約を表示する。
export function RecordPanel() {
	const queue = useRecordQueue(sendToServer);
	const [state, setState] = useState<State>({ kind: "idle" });
	const [photos, setPhotos] = useState<Blob[]>([]);
	// 縮めている途中の写真の数。縮め終わるまでは送らない（写真が記録から抜けないように）。
	const [shrinking, setShrinking] = useState(0);
	const draft = useRef<{
		recordId: string;
		recordedAt: string;
		location: Promise<MeasuredLocation | null>;
	} | null>(null);
	const recorder = useRef<MediaRecorder | null>(null);
	const camera = useRef<HTMLInputElement>(null);

	// 位置情報の許可は、アプリを開いたときに聞いておく（録音を始めた直後に、マイクの許可と重ねて聞かないため）。
	// ここで取った位置は端末が覚えておくので、記録を始めたときの位置もすぐに返りやすくなる。
	useEffect(() => {
		requestLocation();
	}, []);

	// 位置は記録を始めたときに取りにいき、録音や撮影のあいだに届くのを待つ。
	function startDraft() {
		draft.current ??= {
			recordId: crypto.randomUUID(),
			recordedAt: new Date().toISOString(),
			location: requestLocation(),
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

	async function sendDraft(audio: Blob | null) {
		const { recordId, recordedAt, location } = startDraft();
		setState({ kind: "saving" });
		// 位置が届いていなければ、少しだけ待って、間に合わなければ位置なしで送る。
		const located = await locationWithin(location, LOCATION_WAIT_MS);
		try {
			await queue.add({
				recordId,
				recordedAt,
				audio,
				photos,
				location: located,
			});
		} catch {
			// 列に入らなければ、記録は端末にも残っていない。下書き（写真と記録 ID）は残し、もう一度送れるようにする。
			setState({
				kind: "failed",
				message: "記録を端末に保存できませんでした。もう一度送ってください。",
			});
			return;
		}
		draft.current = null;
		setPhotos([]);
		setState({ kind: "idle" });
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

	const busy = state.kind === "recording" || state.kind === "saving";
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
					{state.kind === "saving"
						? "保存しています…"
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
			{state.kind === "failed" && <p role="alert">{state.message}</p>}
			{queue.pending > 0 && (
				<p className="pending" role="status">
					送信待ち {queue.pending} 件
					{queue.sending ? "。送っています…" : "。電波が戻ったら送ります。"}
				</p>
			)}
			{queue.sent.map((sent) => (
				<SentResult key={sent.record.recordId} sent={sent} />
			))}
		</section>
	);
}

/** 送れた記録 1 件の即時応答。新しく送れたものから上に並ぶ。 */
function SentResult({ sent: { record, response } }: { sent: SentRecord }) {
	return (
		<article className="sent-record">
			<p className="recorded-at">{timeOf(record.recordedAt)} の記録</p>
			{record.photos.length > 0 && <Photos photos={record.photos} />}
			{response.status === "summarized" ? (
				<>
					<Summary summary={response.summary} />
					<Related recordId={record.recordId} />
				</>
			) : (
				<p>記録は保存しました。要約は作れませんでした。</p>
			)}
		</article>
	);
}

type RelatedState =
	| { kind: "loading" }
	| { kind: "loaded"; related: RelatedRecords }
	| { kind: "failed" };

/** 要約の後に、直近の記録と去年の同じ時期の記録を読んで表示する（要約を待たせないよう、要約が出てから読む）。 */
function Related({ recordId }: { recordId: string }) {
	const [state, setState] = useState<RelatedState>({ kind: "loading" });
	useEffect(() => {
		let active = true;
		loadRelatedRecords(supabase, recordId).then(
			(related) => active && setState({ kind: "loaded", related }),
			() => active && setState({ kind: "failed" }),
		);
		return () => {
			active = false;
		};
	}, [recordId]);

	if (state.kind === "loading")
		return <p className="related-status">過去の記録を読み込んでいます…</p>;
	if (state.kind === "failed")
		return <p className="related-status">過去の記録を読み込めませんでした。</p>;
	return (
		<>
			<RelatedList
				title="直近の記録"
				records={state.related.recent}
				empty="同じ圃場・作目の記録はまだありません。"
			/>
			<RelatedList
				title="去年の同じ時期の記録"
				records={state.related.lastYear}
				empty="去年の同じ時期の記録はありません。"
			/>
		</>
	);
}

function RelatedList({
	title,
	records,
	empty,
}: {
	title: string;
	records: RelatedRecord[];
	empty: string;
}) {
	return (
		<section className="related">
			<h2>{title}</h2>
			{records.length === 0 ? (
				<p className="related-status">{empty}</p>
			) : (
				records.map((r) => (
					<div key={r.recordId} className="related-record">
						<p className="recorded-at">
							{timeOf(r.recordedAt)}・{r.recorder.name}
						</p>
						<Summary summary={r.summary} />
					</div>
				))
			)}
		</section>
	);
}

/** 記録日時を「10月24日 17:30」の形にする（端末の時刻で）。 */
function timeOf(dateTime: string) {
	return new Date(dateTime).toLocaleString("ja-JP", {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
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
