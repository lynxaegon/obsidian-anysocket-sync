// @ts-nocheck
import {normalizePath, TFile, TFolder} from "obsidian";
import Utils from "../libs/Utils";
import LocalIndex, {IndexEntry, isDirty, sameState} from "./LocalIndex";

// matches the second file the server creates when two devices changed the same thing:
// "Note (iPhone's version, Oct 26).md", "Note (iPhone's version, Oct 26 2).md"
export const KEPT_COPY = /\(.+'s version, [A-Z][a-z]{2} \d{1,2}( \d+)?\)(\.[^./]+)?$/;

const LARGE_TIMEOUT = 10 * 60 * 1000;
// fatal: bytes that are not valid UTF-8 are written as bytes, never "repaired"
const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
// written as text, so Obsidian merges a change into a note that is open in the editor
const TEXT = new Set(["md", "txt", "canvas", "json", "css", "csv", "svg", "html", "htm", "xml", "yaml", "yml", "js", "ts", "tex", "bib", "org", "base"]);
const textEncoder = new TextEncoder();

function toUint8(data) {
	if (data == null) {
		return null;
	}
	if (data instanceof Uint8Array) {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}
	if (typeof data === "string") {
		return textEncoder.encode(data);
	}
	throw new Error("unexpected content");
}

function toArrayBuffer(bytes: Uint8Array) {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const depth = (path) => path.split("/").length;
const fileName = (path) => path.split("/").pop();

/**
 * Sync with a 1.6.0+ server (protocol v2).
 *
 * The device drives: it asks the server what changed since last time, downloads what it
 * needs, and uploads its own changes, saying which server version each one was based on.
 * The server decides what happens when two devices changed the same thing.
 * All work goes through one queue, so nothing runs concurrently.
 */
export default class SyncV2 {
	xSync: any;
	index: LocalIndex;
	peer: any = null;
	running = false;
	queue: Promise<any> = Promise.resolve();
	syncing = false;
	syncAgain = false;
	// renames we do ourselves, so their vault events are not uploaded again
	expectedRenames = new Set<string>();
	device: any = null;
	features: string[] = [];

	constructor(xSync) {
		this.xSync = xSync;
		this.index = new LocalIndex(xSync.storage.fsInternal);
	}

	get plugin() {
		return this.xSync.plugin;
	}

	get storage() {
		return this.xSync.storage;
	}

	get status() {
		return this.xSync.status;
	}

	get activity() {
		return this.xSync.activity;
	}

	rpc(timeout?: number) {
		if (!this.peer) {
			throw new Error("Not connected");
		}
		return timeout ? this.peer.rpcWith({ timeout }) : this.peer.rpc;
	}

	// runs fn after everything queued before it
	enqueue(fn: () => Promise<any>) {
		const run = this.queue.then(() => this.running ? fn() : null);
		this.queue = run.catch((e) => {
			if (this.running) {
				console.error("AnySocket Sync -", e);
			}
		});
		return run;
	}

	async start(peer, hello) {
		this.peer = peer;
		this.device = hello.device;
		this.features = hello.features || [];
		this.running = true;
		const existed = await this.index.load();
		if (!existed && !this.importedLegacy) {
			this.importedLegacy = true;
			await this.importLegacyDeletes();
		}
		if (this.plugin.settings.autoSync) {
			return this.syncNow();
		}
		await this.enqueue(() => this.scanLocal());
		this.status.set("paused", { pending: this.index.dirtyPaths().length });
	}

	async stop() {
		this.running = false;
		this.peer = null;
		await this.index.save();
	}

	// ---- local state ----

	async time() {
		return await this.xSync.anysocket.getTime();
	}

	// the server's idea of "now" minus ours
	async clockOffset() {
		return (await this.time()) - Date.now();
	}

	async hashFile(path: string) {
		const data = await this.storage.readBinary(path);
		if (data == null) {
			return null;
		}
		return { data: new Uint8Array(data), sha1: await Utils.getSHABinary(new Uint8Array(data)) };
	}

	// compares the vault with the index, marking what changed while we were not looking
	async scanLocal() {
		const offset = await this.clockOffset();
		const seen = new Set<string>();

		for (const file of app.vault.getAllLoadedFiles()) {
			if (file.path === "/" || !Utils.isSyncable(file.path)) {
				continue;
			}
			seen.add(file.path);
			const entry = this.index.get(file.path);

			if (file instanceof TFolder || !file.stat) {
				if (!entry || entry.action !== "created" || entry.type !== "folder") {
					this.index.set(file.path, {
						type: "folder",
						action: "created",
						sha1: null,
						lmtime: 0,
						mtime: entry && entry.mtime || Date.now() + offset,
						synced: entry ? entry.synced : null
					});
				}
				continue;
			}

			if (entry && entry.type === "file" && entry.action === "created" && entry.lmtime === file.stat.mtime) {
				continue;
			}
			const hashed = await this.hashFile(file.path);
			if (!hashed) {
				continue;
			}
			this.index.set(file.path, {
				type: "file",
				action: "created",
				sha1: hashed.sha1,
				lmtime: file.stat.mtime,
				mtime: file.stat.mtime + offset,
				synced: entry ? entry.synced : null,
				from: entry ? entry.from : undefined
			});
		}

		const now = Date.now() + offset;
		for (const path of this.index.paths()) {
			const entry = this.index.get(path);
			if (seen.has(path) || entry.action === "deleted") {
				continue;
			}
			if (!entry.synced) {
				// created and gone again before it ever synced
				this.index.remove(path);
				continue;
			}
			entry.action = "deleted";
			entry.mtime = now;
			this.index.set(path, entry);
		}
	}

	// deletes 1.5.x queued but never sent, so those files don't come back
	async importLegacyDeletes() {
		const queue = await this.storage.loadDeleteQueue();
		for (const path in queue) {
			const item = queue[path];
			if (!item || !item.metadata || !Utils.isSyncable(path) || app.vault.getAbstractFileByPath(path)) {
				continue;
			}
			this.index.set(path, {
				type: item.metadata.type === "folder" ? "folder" : "file",
				action: "deleted",
				sha1: item.metadata.sha1 || null,
				lmtime: 0,
				mtime: item.metadata.mtime || Date.now(),
				synced: { sha1: item.metadata.sha1 || null, action: "created" }
			});
		}
	}

	// ---- syncing ----

	syncNow(full = false) {
		if (this.syncing) {
			this.syncAgain = true;
			return this.queue;
		}
		return this.enqueue(async () => {
			this.syncing = true;
			try {
				do {
					this.syncAgain = false;
					await this.runSync(full);
					full = false;
				} while (this.syncAgain && this.running);
			} catch (e) {
				if (this.running && this.peer) {
					console.error("AnySocket Sync - sync failed", e);
					this.status.set("error", { message: e && (e.message || e.error) || String(e) });
				}
			} finally {
				this.syncing = false;
			}
		});
	}

	async runSync(full: boolean) {
		this.status.set("syncing", { done: 0, total: 0 });
		await this.scanLocal();
		if (full) {
			this.index.resetCursor();
		}

		// never null in an RPC argument: anysocket's browser build can't send one (1.0.1)
		const list = await this.rpc(LARGE_TIMEOUT).sync.list(
			this.index.cursor === null ? false : this.index.cursor,
			this.index.epoch || false
		);
		const remote = new Map<string, any>(list.entries);

		if (list.full) {
			// paths we agreed on with the server but it no longer has (its data was reset): upload them again
			for (const path of this.index.paths()) {
				const entry = this.index.get(path);
				if (entry.synced && !remote.has(path)) {
					entry.synced = null;
					this.index.set(path, entry);
				}
			}
		}

		const toApply = [];
		for (const [path, meta] of remote) {
			if (!Utils.isSyncable(path)) {
				continue;
			}
			const entry = this.index.get(path);
			if (entry && sameState(entry, meta)) {
				// same content on both sides (also how a first sync avoids re-uploading everything)
				entry.synced = { sha1: meta.sha1 || null, action: meta.action, seq: meta.seq };
				this.index.set(path, entry);
				continue;
			}
			if (entry && isDirty(entry)) {
				// our own change wins the right to go first; the server sorts it out
				continue;
			}
			toApply.push([path, meta]);
		}

		const dirty = this.index.dirtyPaths();
		const total = toApply.length + dirty.length;
		let done = 0;
		const progress = () => this.status.set("syncing", { done: ++done, total });

		await this.applyRemote(toApply, progress);
		await this.pushAll(progress);

		this.index.setCursor(list.epoch, list.cursor);
		await this.index.save();
		this.status.set("synced", { at: Date.now() });
	}

	// one file failing must not stop the others; a lost connection does
	async safely(path: string, fn: () => Promise<any>) {
		try {
			await fn();
		} catch (e) {
			if (!this.running || !this.peer) {
				throw e;
			}
			console.error("AnySocket Sync - " + path, e);
			this.activity.add("failed", path, e && (e.message || e.error) || String(e));
		}
	}

	// ---- downloads ----

	// renames first, then creates (parents before children), then deletes (children before parents)
	async applyRemote(entries: Array<[string, any]>, progress = () => {}) {
		const renamedTo = new Map<string, string>();
		for (const [path, meta] of entries) {
			if (meta.action === "deleted" && meta.renamed_to) {
				renamedTo.set(meta.renamed_to, path);
			}
		}

		const creates = entries.filter(e => e[1].action !== "deleted").sort((a, b) => depth(a[0]) - depth(b[0]));
		const deletes = entries.filter(e => e[1].action === "deleted").sort((a, b) => depth(b[0]) - depth(a[0]));

		for (const [path, meta] of creates) {
			if (!this.running) return;
			await this.safely(path, () => this.applyCreated(path, meta, renamedTo.get(path)));
			progress();
		}
		for (const [path, meta] of deletes) {
			if (!this.running) return;
			await this.safely(path, () => this.applyDeleted(path, meta));
			progress();
		}
	}

	synced(meta) {
		return { sha1: meta.sha1 || null, action: meta.action, seq: meta.seq };
	}

	/**
	 * Whether the local file is exactly what the index says (so it may be replaced). A file that
	 * changed on disk but whose event we did not handle yet counts as changed: it is never overwritten.
	 */
	async localUnchanged(path: string) {
		const local = app.vault.getAbstractFileByPath(path);
		if (!local) {
			return true;
		}
		const entry = this.index.get(path);
		if (!entry || isDirty(entry) || entry.action !== "created") {
			return false;
		}
		if (!(local instanceof TFile)) {
			return entry.type === "folder";
		}
		const hashed = await this.hashFile(path);
		return !!hashed && hashed.sha1 === entry.sha1;
	}

	// a local change found while applying a remote one: upload it, the server decides
	async keepLocal(path: string) {
		const local = app.vault.getAbstractFileByPath(path);
		const entry = this.index.get(path);
		if (local instanceof TFile) {
			const hashed = await this.hashFile(path);
			this.index.set(path, {
				type: "file", action: "created", sha1: hashed ? hashed.sha1 : null,
				lmtime: local.stat.mtime, mtime: local.stat.mtime + await this.clockOffset(),
				synced: entry ? entry.synced : null
			});
		}
		this.schedulePush(path, 0);
	}

	async applyCreated(path: string, meta, renamedFrom?: string) {
		const local = app.vault.getAbstractFileByPath(path);

		if (meta.type === "folder") {
			if (!local && renamedFrom && await this.renameLocal(renamedFrom, path, meta)) {
				return;
			}
			const existing = this.index.get(path);
			this.index.set(path, {
				type: "folder", action: "created", sha1: null, lmtime: 0,
				mtime: meta.mtime, synced: this.synced(meta)
			});
			if (!local) {
				await this.storage.fsVault.makeFolder(path);
			}
			return;
		}

		// moved here by another device: rename our copy instead of downloading it again
		if (!local && renamedFrom && await this.renameLocal(renamedFrom, path, meta)) {
			return;
		}

		if (local instanceof TFile) {
			const hashed = await this.hashFile(path);
			if (hashed && hashed.sha1 === meta.sha1) {
				this.index.set(path, {
					type: "file", action: "created", sha1: meta.sha1, lmtime: local.stat.mtime,
					mtime: meta.mtime, synced: this.synced(meta)
				});
				return;
			}
		}

		if (!await this.localUnchanged(path)) {
			return this.keepLocal(path);
		}
		await this.download(path, meta);
		this.activity.add("downloaded", path);
	}

	// writes the server's current version of a file
	async download(path: string, meta) {
		const bytes = toUint8(await this.rpc(LARGE_TIMEOUT).sync.content(path, false));
		if (bytes == null) {
			// gone on the server meanwhile; the next list says what happened
			return;
		}
		const sha1 = await Utils.getSHABinary(bytes);
		// in the index before it is on disk, so the vault event it fires is not uploaded back
		this.index.set(path, {
			type: "file", action: "created", sha1, lmtime: 0,
			mtime: meta.mtime, synced: { sha1, action: "created", seq: meta.seq }
		});
		await this.writeLocal(path, bytes, meta.mtime);
		const file = app.vault.getAbstractFileByPath(path);
		const entry = this.index.get(path);
		if (entry && file && file.stat) {
			entry.lmtime = file.stat.mtime;
			this.index.set(path, entry);
		}
	}

	async writeLocal(path: string, bytes: Uint8Array, mtime: number | null) {
		const ext = path.split("/").pop().split(".").pop().toLowerCase();
		if (TEXT.has(ext)) {
			let text = null;
			try {
				text = textDecoder.decode(bytes);
			} catch (e) {
				// not UTF-8 after all
			}
			if (text !== null) {
				return await this.storage.fsVault.write(path, text, mtime);
			}
		}
		return await this.storage.fsVault.write(path, toArrayBuffer(bytes), mtime, true);
	}

	async renameLocal(from: string, to: string, meta) {
		const source = app.vault.getAbstractFileByPath(from);
		const entry = this.index.get(from);
		if (!source || !entry || isDirty(entry) || app.vault.getAbstractFileByPath(to)) {
			return false;
		}
		if (meta.type === "file" && (!(source instanceof TFile) || entry.sha1 !== meta.sha1)) {
			return false;
		}

		this.index.set(to, Object.assign({}, entry, { synced: this.synced(meta), mtime: meta.mtime }));
		this.index.set(from, Object.assign({}, entry, { action: "deleted", synced: { sha1: entry.sha1, action: "deleted" } }));
		this.expectedRenames.add(from + "\n" + to);

		// a renamed folder takes its children along; their rename events are ours too
		if (source instanceof TFolder) {
			for (const path of this.index.paths()) {
				const child = this.index.get(path);
				if (path.startsWith(from + "/") && child.action === "created") {
					const moved = to + path.slice(from.length);
					// the device that renamed the folder renames each child right after it,
					// so both sides are taken as already moved (a full sync corrects it otherwise)
					const existing = this.index.get(moved);
					if (!existing || existing.action === "deleted") {
						this.index.set(moved, Object.assign({}, child));
					}
					this.index.set(path, Object.assign({}, child, {
						action: "deleted",
						synced: { sha1: child.sha1, action: "deleted" }
					}));
					this.expectedRenames.add(path + "\n" + moved);
				}
			}
		}

		const parent = to.split("/").slice(0, -1).join("/");
		if (parent && !app.vault.getAbstractFileByPath(parent)) {
			await this.storage.fsVault.makeFolder(parent);
		}
		// vault.rename, not fileManager.renameFile: links were already updated on the other
		// device, and those edits arrive as changes of their own
		await app.vault.rename(source, to);
		this.activity.add("renamed", to, from);
		return true;
	}

	async applyDeleted(path: string, meta) {
		const local = app.vault.getAbstractFileByPath(path);
		const entry = this.index.get(path);
		if (local instanceof TFile && !await this.localUnchanged(path)) {
			// changed here since: keep it (it goes back to the server, which brings it back)
			if (entry) {
				entry.synced = this.synced(meta);
				this.index.set(path, entry);
			}
			return this.keepLocal(path);
		}
		this.index.set(path, {
			type: meta.type === "folder" ? "folder" : "file",
			action: "deleted",
			sha1: meta.sha1 || (entry && entry.sha1) || null,
			lmtime: 0,
			mtime: meta.mtime,
			synced: this.synced(meta)
		});
		if (!local) {
			return;
		}
		// a folder only goes once it is empty: whatever is still in it is not synced yet
		if (local instanceof TFolder && local.children.length > 0) {
			return;
		}
		await app.fileManager.trashFile(local);
		this.activity.add("deleted", path);
	}

	// ---- uploads ----

	async pushAll(progress = () => {}) {
		const dirty = this.index.dirtyPaths();
		// renames first (they keep history), folders before their files, deletes last
		const rank = (e) => e.from ? 0
			: e.action === "created" ? (e.type === "folder" ? 1 : 2)
			: (e.type === "file" ? 3 : 4);
		dirty.sort((a, b) => {
			const ea = this.index.get(a), eb = this.index.get(b);
			return rank(ea) - rank(eb) || (ea.action === "deleted" ? depth(b) - depth(a) : depth(a) - depth(b));
		});
		for (const path of dirty) {
			if (!this.running) return;
			const entry = this.index.get(path);
			if (entry && isDirty(entry)) {
				await this.safely(path, () => this.push(path));
			}
			progress();
		}
	}

	async push(path: string) {
		let entry = this.index.get(path);
		if (!entry) {
			return;
		}

		// renamed while offline: try to move it on the server first, so it keeps its history
		if (entry.from) {
			const from = entry.from;
			delete entry.from;
			this.index.set(path, entry);
			const source = this.index.get(from);
			if (source && source.synced && source.action === "deleted" && source.synced.action === "created") {
				await this.renameRemote(from, path, source.synced);
				entry = this.index.get(path);
				if (!entry || !isDirty(entry)) {
					return;
				}
			}
		}

		const meta = { type: entry.type, action: entry.action, sha1: entry.sha1, mtime: entry.mtime };
		let data = null;
		if (entry.type === "file" && entry.action === "created") {
			const hashed = await this.hashFile(path);
			if (!hashed) {
				// gone meanwhile; its delete event comes next
				return;
			}
			data = hashed.data;
			meta.sha1 = entry.sha1 = hashed.sha1;
		}

		const result = await this.rpc(LARGE_TIMEOUT).sync.put(path, meta, entry.synced ? {
			sha1: entry.synced.sha1, action: entry.synced.action
		} : false, data || false);

		await this.handlePutResult(path, entry, result);
	}

	async handlePutResult(path: string, entry: IndexEntry, result) {
		const current = this.index.get(path) || entry;
		switch (result.result) {
			case "unchanged":
			case "applied":
				current.synced = this.synced(result.meta);
				this.index.set(path, current);
				if (result.result === "applied") {
					this.activity.add(entry.action === "deleted" ? "deleted_remote" : "uploaded", path);
				}
				break;

			case "merged":
				// both devices changed different parts: take the combined version
				await this.download(path, result.meta);
				this.activity.add("merged", path);
				break;

			case "kept_both":
				if (result.meta.sha1 !== entry.sha1) {
					// the other version kept the name; ours lives on in the copy
					await this.download(path, result.meta);
				} else {
					current.synced = this.synced(result.meta);
					this.index.set(path, current);
				}
				if (result.copy) {
					const copyMeta = await this.rpc().sync.meta(result.copy);
					if (copyMeta) {
						await this.applyCreated(result.copy, copyMeta);
					}
				}
				this.activity.add("kept_both", path, result.copy);
				this.xSync.onKeptBoth(path, result.copy);
				break;

			case "stale":
				// we deleted a version that was since changed elsewhere: bring the newer one back
				current.synced = null;
				this.index.set(path, current);
				await this.download(path, result.meta);
				this.activity.add("restored", path);
				this.xSync.onRestored(path);
				break;
		}
	}

	async renameRemote(from: string, to: string, base) {
		const result = await this.rpc().sync.rename(from, to, { sha1: base.sha1, action: base.action });
		if (result.result !== "renamed") {
			return false;
		}
		const source = this.index.get(from);
		const target = this.index.get(to);
		if (source) {
			source.synced = this.synced(result.tombstone);
			this.index.set(from, source);
		}
		if (target) {
			target.synced = this.synced(result.meta);
			this.index.set(to, target);
		}
		this.activity.add("renamed", to, from);
		return true;
	}

	// ---- vault events ----

	canUpload() {
		return this.running && this.peer && this.plugin.settings.autoSync;
	}

	async onLocalEvent(type: string, file, oldPath?: string) {
		if (!Utils.isSyncable(file.path)) {
			return;
		}

		if (type === "rename") {
			const key = oldPath + "\n" + file.path;
			if (this.expectedRenames.has(key)) {
				this.expectedRenames.delete(key);
				return;
			}
			return this.onLocalRename(file, oldPath);
		}

		const offset = await this.clockOffset();
		const entry = this.index.get(file.path);

		if (type === "delete") {
			if (!entry || entry.action === "deleted") {
				return;
			}
			if (!entry.synced) {
				this.index.remove(file.path);
				return;
			}
			entry.action = "deleted";
			entry.mtime = Date.now() + offset;
			this.index.set(file.path, entry);
			return this.schedulePush(file.path, 0);
		}

		// create / modify
		if (file instanceof TFolder || !file.stat) {
			if (entry && entry.action === "created") {
				return;
			}
			this.index.set(file.path, {
				type: "folder", action: "created", sha1: null, lmtime: 0,
				mtime: Date.now() + offset, synced: entry ? entry.synced : null
			});
			return this.schedulePush(file.path, 0);
		}

		const hashed = await this.hashFile(file.path);
		if (!hashed) {
			return;
		}
		if (entry && entry.action === "created" && entry.sha1 === hashed.sha1) {
			// our own download, or a save without changes
			if (entry.lmtime !== file.stat.mtime) {
				entry.lmtime = file.stat.mtime;
				this.index.set(file.path, entry);
			}
			return;
		}
		this.index.set(file.path, {
			type: "file", action: "created", sha1: hashed.sha1, lmtime: file.stat.mtime,
			mtime: file.stat.mtime + offset, synced: entry ? entry.synced : null,
			from: entry ? entry.from : undefined
		});
		const delay = type === "modify" ? this.plugin.settings.delayedSync * 1000 : 0;
		return this.schedulePush(file.path, delay);
	}

	async onLocalRename(file, oldPath: string) {
		const source = this.index.get(oldPath);
		const offset = await this.clockOffset();
		const now = Date.now() + offset;
		const isFolder = file instanceof TFolder || !file.stat;

		const moved: IndexEntry = source && source.action === "created" ? Object.assign({}, source, {
			synced: null,
			lmtime: isFolder ? 0 : file.stat.mtime
		}) : {
			type: isFolder ? "folder" : "file", action: "created", sha1: null,
			lmtime: 0, mtime: now, synced: null
		};
		if (source && source.synced && source.synced.action === "created") {
			// remembered, so the server can move it (and its history) when we get to it
			moved.from = oldPath;
		}
		this.index.set(file.path, moved);

		if (source) {
			if (source.synced) {
				source.action = "deleted";
				source.mtime = now;
				this.index.set(oldPath, source);
			} else {
				this.index.remove(oldPath);
			}
		}

		if (!isFolder) {
			const hashed = await this.hashFile(file.path);
			if (hashed) {
				moved.sha1 = hashed.sha1;
				this.index.set(file.path, moved);
			}
		}
		return this.schedulePush(file.path, 0);
	}

	schedulePush(path: string, delay: number) {
		if (!this.canUpload()) {
			this.status.pendingChanged(this.index.dirtyPaths().length);
			return;
		}
		const run = () => this.enqueue(async () => {
			const entry = this.index.get(path);
			if (!entry || !isDirty(entry) || !this.peer) {
				return;
			}
			this.status.set("syncing", { done: 0, total: 1 });
			try {
				// a rename leaves its source behind; send that one too
				if (entry.from) {
					const from = entry.from;
					await this.push(path);
					const source = this.index.get(from);
					if (source && isDirty(source)) {
						await this.push(from);
					}
				} else {
					await this.push(path);
				}
			} finally {
				this.status.set("synced", { at: Date.now() });
			}
		});
		if (delay > 0) {
			this.xSync.xTimeouts.set(path, delay, run);
		} else {
			this.xSync.xTimeouts.clear(path);
			return run();
		}
	}

	// a change notification from the server
	onRemoteChanged(message) {
		if (!this.running || !this.plugin.settings.autoSync) {
			return;
		}
		if (message.epoch !== this.index.epoch) {
			// the server restarted; a regular sync sorts it out
			return this.syncNow();
		}
		return this.enqueue(async () => {
			const toApply = [];
			for (const [path, meta] of message.entries || []) {
				if (!Utils.isSyncable(path)) continue;
				const entry = this.index.get(path);
				if (entry && sameState(entry, meta)) {
					entry.synced = this.synced(meta);
					this.index.set(path, entry);
					continue;
				}
				if (entry && isDirty(entry)) {
					// we changed it too: our upload (already queued) gets the server to decide
					this.schedulePush(path, 0);
					continue;
				}
				toApply.push([path, meta]);
			}
			if (toApply.length) {
				this.status.set("syncing", { done: 0, total: toApply.length });
				let done = 0;
				await this.applyRemote(toApply, () => this.status.set("syncing", { done: ++done, total: toApply.length }));
				this.status.set("synced", { at: Date.now() });
			}
		});
	}

	// ---- history ----

	async listVersions(path: string) {
		return await this.rpc().sync.versions(path);
	}

	async readVersion(path: string, timestamp: number) {
		return toUint8(await this.rpc(LARGE_TIMEOUT).sync.content(path, timestamp));
	}

	async listFiles(deletedOnly: boolean) {
		return await this.rpc().sync.files(deletedOnly ? "deleted" : "all");
	}

	// a restored version is a new local change like any other
	async restore(path: string, bytes: Uint8Array) {
		const parent = path.split("/").slice(0, -1).join("/");
		if (parent && !app.vault.getAbstractFileByPath(parent)) {
			await this.storage.fsVault.makeFolder(parent);
		}
		await this.writeLocal(path, bytes, null);
	}

	// ---- devices ----

	async listDevices() {
		return await this.rpc().devices.list();
	}

	async approveDevice(id: string) {
		return await this.rpc().devices.approve(id);
	}

	async declineDevice(id: string) {
		return await this.rpc().devices.remove(id);
	}

	async revokeDevice(id: string) {
		return await this.rpc().devices.revoke(id);
	}

	pendingCount() {
		return this.index.dirtyPaths().length;
	}

	keptCopies() {
		return app.vault.getFiles().filter(f => KEPT_COPY.test(f.name)).map(f => f.path);
	}
}

export { fileName, normalizePath };
