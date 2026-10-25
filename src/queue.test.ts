import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { openRecordQueue, type RecordQueue, type Sender } from "./queue";
import { type NewRecord, RecordRejected, type RecordResponse } from "./record";

function newRecord(recordedAt: string, text = recordedAt): NewRecord {
	return {
		recordId: crypto.randomUUID(),
		recordedAt,
		audio: new Blob([`audio ${text}`], { type: "audio/webm" }),
		photos: [new Blob([`photo ${text}`], { type: "image/jpeg" })],
		location: { latitude: 34.7, longitude: 135.5, accuracyMeters: 20 },
	};
}

function saved(record: NewRecord): RecordResponse {
	return { status: "saved", recordId: record.recordId };
}

/** 送られた記録を残す偽物の送り先。fail が true の間は送信に失敗する。 */
function fakeSender() {
	const sent: NewRecord[] = [];
	const sender = {
		sent,
		fail: false,
		send: (async (record) => {
			sent.push(record);
			if (sender.fail) throw new Error("圏外");
			return saved(record);
		}) as Sender,
	};
	return sender;
}

describe("送信待ちの列", () => {
	let indexedDB: IDBFactory;
	const opened: RecordQueue[] = [];

	async function open(
		options: Partial<Parameters<typeof openRecordQueue>[0]> & {
			send: Sender;
		},
	) {
		const queue = await openRecordQueue({ indexedDB, ...options });
		opened.push(queue);
		return queue;
	}

	// 端末の再起動に相当する。開いていた列を閉じて、同じ保存場所で開き直す。
	async function restart(queue: RecordQueue, send: Sender) {
		queue.close();
		return open({ send });
	}

	indexedDB = new IDBFactory();
	afterEach(() => {
		for (const queue of opened.splice(0)) queue.close();
		indexedDB = new IDBFactory();
	});

	it("列に入れた記録は、送れないまま列を開き直しても残っていて、中身も同じまま古い順に送られる", async () => {
		const offline = fakeSender();
		offline.fail = true;
		const queue = await open({ send: offline.send });
		const first = newRecord("2026-10-24T08:00:00.000Z", "1件目");
		const second = newRecord("2026-10-24T08:05:00.000Z", "2件目");
		await queue.add(first);
		await queue.add(second);
		await queue.flush();

		const online = fakeSender();
		const reopened = await restart(queue, online.send);
		expect(await reopened.count()).toBe(2);
		await reopened.flush();

		expect(online.sent.map((r) => r.recordId)).toEqual([
			first.recordId,
			second.recordId,
		]);
		const resent = online.sent[0];
		expect(resent?.recordedAt).toBe("2026-10-24T08:00:00.000Z");
		expect(await resent?.audio?.text()).toBe("audio 1件目");
		expect(await resent?.photos[0]?.text()).toBe("photo 1件目");
		expect(resent?.photos[0]?.type).toBe("image/jpeg");
		expect(resent?.location).toEqual(first.location);
		expect(await reopened.count()).toBe(0);
	});

	it("送信に失敗した記録は列に残り、その後ろの記録も送らず、次の機会に同じ記録 ID で古い順に送り直される", async () => {
		const sender = fakeSender();
		sender.fail = true;
		const queue = await open({ send: sender.send });
		const first = newRecord("2026-10-24T08:00:00.000Z");
		const second = newRecord("2026-10-24T08:05:00.000Z");
		await queue.add(first);
		await queue.flush();
		await queue.add(second);
		await queue.flush();

		expect(sender.sent.map((r) => r.recordId)).toEqual([
			first.recordId,
			first.recordId,
		]);
		expect(await queue.count()).toBe(2);

		sender.fail = false;
		await queue.flush();

		expect(sender.sent.map((r) => r.recordId).slice(2)).toEqual([
			first.recordId,
			second.recordId,
		]);
		expect(await queue.count()).toBe(0);
	});

	it("サーバーが受け付けない記録は列に残すが、その後ろの記録は止めずに送る", async () => {
		const rejected = newRecord("2026-10-24T08:00:00.000Z");
		const next = newRecord("2026-10-24T08:05:00.000Z");
		const sent: string[] = [];
		const send: Sender = async (record) => {
			sent.push(record.recordId);
			if (record.recordId === rejected.recordId) throw new RecordRejected(409);
			return saved(record);
		};
		const queue = await open({ send });
		await queue.add(rejected);
		await queue.add(next);
		await queue.flush();

		expect(sent).toContain(next.recordId);
		expect(await queue.count()).toBe(1);
	});

	it("応答が時間内に返らなければ、送信をあきらめて列に残す", async () => {
		const hanging: Sender = () => new Promise(() => {});
		const queue = await open({ send: hanging, timeoutMs: 50 });
		const record = newRecord("2026-10-24T08:00:00.000Z");

		await queue.add(record);
		await queue.flush();

		expect(await queue.count()).toBe(1);
	});

	it("送信待ちの件数が、開いたとき・入れたとき・送れたときに知らされ、送れた記録ごとに応答が知らされる", async () => {
		const sender = fakeSender();
		sender.fail = true;
		const offline = await open({ send: sender.send });
		const first = newRecord("2026-10-24T08:00:00.000Z");
		const second = newRecord("2026-10-24T08:05:00.000Z");
		await offline.add(first);
		await offline.add(second);
		await offline.flush();
		offline.close();

		const counts: number[] = [];
		const responses: [string, RecordResponse][] = [];
		sender.fail = false;
		const queue = await open({
			send: sender.send,
			onPendingChange: (pending) => counts.push(pending),
			onSent: (record, response) => responses.push([record.recordId, response]),
		});
		await queue.flush();

		expect(counts).toEqual([2, 1, 0]);
		expect(responses).toEqual([
			[first.recordId, saved(first)],
			[second.recordId, saved(second)],
		]);
	});

	it("送っている間かどうかが、送り始めと送り終わり（失敗しても）に知らされる", async () => {
		const sender = fakeSender();
		const activity: boolean[] = [];
		const queue = await open({
			send: sender.send,
			onSending: (sending) => activity.push(sending),
		});

		await queue.add(newRecord("2026-10-24T08:00:00.000Z"));
		await queue.flush();
		sender.fail = true;
		await queue.add(newRecord("2026-10-24T08:05:00.000Z"));
		await queue.flush();

		expect(activity).toEqual([true, false, true, false]);
	});

	it("同じ記録 ID の記録を 2 度入れても、列には 1 件だけ入り、1 度だけ送られる", async () => {
		const sender = fakeSender();
		sender.fail = true;
		const queue = await open({ send: sender.send });
		const record = newRecord("2026-10-24T08:00:00.000Z");
		await queue.add(record);
		await queue.add(record);
		await queue.flush();

		expect(await queue.count()).toBe(1);
		sender.fail = false;
		sender.sent.length = 0;
		await queue.flush();
		expect(sender.sent.map((r) => r.recordId)).toEqual([record.recordId]);
	});

	it("送っている途中に入れた記録も、その送信の続きで、1 度ずつ古い順に送られる", async () => {
		const sent: string[] = [];
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const slow: Sender = async (record) => {
			sent.push(record.recordId);
			await gate;
			return saved(record);
		};
		const queue = await open({ send: slow });
		const first = newRecord("2026-10-24T08:00:00.000Z");
		const second = newRecord("2026-10-24T08:05:00.000Z");

		await queue.add(first);
		await queue.add(second);
		const flushing = queue.flush();
		release();
		await flushing;

		expect(sent).toEqual([first.recordId, second.recordId]);
		expect(await queue.count()).toBe(0);
	});
});
