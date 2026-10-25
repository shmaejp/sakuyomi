// 送信待ちの列（補助のシーム）。記録は電波の有無にかかわらず、いったん必ずここに入り、古い順に 1 件ずつ送られる（ADR 0003）。
// 端末の IndexedDB に置くので、アプリを閉じても端末を再起動しても残る。
// サーバーが受け取りを確認した（応答が返った）記録だけを列から消す。失敗・時間切れの記録は列に残し、次の機会に同じ記録 ID で送り直す。
// サーバーが受け付けなかった記録（RecordRejected）も消さずに残すが、それで後ろの記録を止めはしない。
// 送り先（記録処理関数を呼ぶ部分）は外から渡す。テストでは偽物を渡す。
import { type NewRecord, RecordRejected, type RecordResponse } from "./record";

/** 記録を送り、サーバーの応答を返す。受け取りを確認できなければ例外を投げる（受け付けられなければ RecordRejected）。 */
export type Sender = (record: NewRecord) => Promise<RecordResponse>;

export type RecordQueueOptions = {
	send: Sender;
	/** 使う IndexedDB。テストでは fake-indexeddb を渡す。 */
	indexedDB?: IDBFactory;
	/** 1 件の送信をあきらめるまでの時間。 */
	timeoutMs?: number;
	/** 送信待ちの件数が変わったとき（開いたときも）。 */
	onPendingChange?: (pending: number) => void;
	/** 送り始めたとき（true）と、送り終わったとき（false。失敗しても）。列が空なら知らせない。 */
	onSending?: (sending: boolean) => void;
	/** 記録を送れて、列から消したとき。 */
	onSent?: (record: NewRecord, response: RecordResponse) => void;
};

export type RecordQueue = {
	/** 記録を列に入れ、送り始める（送り終わるのは待たない）。同じ記録 ID の記録は 2 度入れない。 */
	add(record: NewRecord): Promise<void>;
	/** 列が空になるか、送信に失敗するまで、古い順に送る。送っている途中なら、その送信に合流する。 */
	flush(): Promise<void>;
	count(): Promise<number>;
	close(): void;
};

const DATABASE = "sakuyomi";
const STORE = "pending_records";

// 記録処理関数は同期で文字起こし・構造化までするので、ふつうは 10 秒ほどで返る。電波が弱いと写真の送信に時間がかかる。
const DEFAULT_TIMEOUT_MS = 60_000;

/** IndexedDB に置く形。Blob は端末によって IndexedDB にうまく置けないことがあるので、バイト列にして置く。 */
type Stored = Omit<NewRecord, "audio" | "photos"> & {
	seq?: number;
	audio: StoredBlob | null;
	photos: StoredBlob[];
};
type StoredBlob = { bytes: ArrayBuffer; type: string };

export async function openRecordQueue(
	options: RecordQueueOptions,
): Promise<RecordQueue> {
	const db = await openDatabase(options.indexedDB ?? indexedDB);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let running: Promise<void> | null = null;
	// 送り終える直前（列が空だと読んだ後）に足された記録を取りこぼさないための印。
	let addedWhileSending = false;

	const count = () => request(db, "readonly", (store) => store.count());
	const notify = async () => options.onPendingChange?.(await count());

	/** 列の古い順に送る。圏外・時間切れなら、古い順を守るため後ろの記録も今回は送らない。 */
	async function drain() {
		let sending = false;
		// 受け付けられなかった記録は飛ばして、その後ろから読む。
		let after: number | undefined;
		try {
			do {
				addedWhileSending = false;
				for (;;) {
					const oldest = await oldestAfter(db, after);
					if (!oldest) break;
					if (!sending) {
						sending = true;
						options.onSending?.(true);
					}
					const seq = oldest.seq as number;
					const record = fromStored(oldest);
					let response: RecordResponse;
					try {
						response = await withTimeout(options.send(record), timeoutMs);
					} catch (error) {
						if (!(error instanceof RecordRejected)) return;
						after = seq;
						continue;
					}
					await request(db, "readwrite", (store) => store.delete(seq));
					await notify();
					options.onSent?.(record, response);
				}
			} while (addedWhileSending);
		} finally {
			if (sending) options.onSending?.(false);
		}
	}

	function flush() {
		if (running) {
			// 送っている途中に足された記録も、この送信の続きで送る。
			addedWhileSending = true;
			return running;
		}
		running = drain().finally(() => {
			running = null;
		});
		return running;
	}

	await notify();
	return {
		async add(record) {
			const stored = await toStored(record);
			const exists = await request(db, "readonly", (store) =>
				store.index("recordId").count(record.recordId),
			);
			if (exists === 0)
				await request(db, "readwrite", (store) => store.add(stored));
			// ここからは記録が列に入った後。件数の知らせに失敗しても、入れられなかったことにはしない。
			await notify().catch(() => undefined);
			void flush();
		},
		flush,
		count,
		close: () => db.close(),
	};
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = factory.open(DATABASE, 1);
		opening.onupgradeneeded = () => {
			// seq は列に入れた順。古い順に送るのに使う。
			const store = opening.result.createObjectStore(STORE, {
				keyPath: "seq",
				autoIncrement: true,
			});
			store.createIndex("recordId", "recordId", { unique: true });
		};
		opening.onsuccess = () => resolve(opening.result);
		opening.onerror = () => reject(opening.error);
	});
}

/** 列に入れた順で after より後ろの、いちばん古い記録。after がなければ先頭の記録。 */
async function oldestAfter(
	db: IDBDatabase,
	after: number | undefined,
): Promise<Stored | undefined> {
	const seqs = await request(
		db,
		"readonly",
		(store) => store.getAllKeys() as IDBRequest<number[]>,
	);
	const next = seqs.find((seq) => after === undefined || seq > after);
	if (next === undefined) return undefined;
	return request(db, "readonly", (store) => store.get(next));
}

/** 1 つのトランザクションで 1 つの要求を出し、トランザクションが終わってから結果を返す。 */
function request<T>(
	db: IDBDatabase,
	mode: IDBTransactionMode,
	make: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE, mode);
		const req = make(transaction.objectStore(STORE));
		transaction.oncomplete = () => resolve(req.result);
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});
}

async function toStored(record: NewRecord): Promise<Stored> {
	const toStoredBlob = async (blob: Blob): Promise<StoredBlob> => ({
		bytes: await blob.arrayBuffer(),
		type: blob.type,
	});
	return {
		recordId: record.recordId,
		recordedAt: record.recordedAt,
		audio: record.audio && (await toStoredBlob(record.audio)),
		photos: await Promise.all(record.photos.map(toStoredBlob)),
		location: record.location,
	};
}

function fromStored(stored: Stored): NewRecord {
	const fromStoredBlob = ({ bytes, type }: StoredBlob) =>
		new Blob([bytes], { type });
	return {
		recordId: stored.recordId,
		recordedAt: stored.recordedAt,
		audio: stored.audio && fromStoredBlob(stored.audio),
		photos: stored.photos.map(fromStoredBlob),
		location: stored.location,
	};
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error("時間切れ")), ms);
		}),
	]).finally(() => clearTimeout(timer));
}
