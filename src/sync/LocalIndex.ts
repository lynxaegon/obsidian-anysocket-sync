// @ts-nocheck

/**
 * What this device knows about every path, for sync protocol v2 (1.6.0+):
 *   - the local state (type, action, sha1, lmtime = the file's mtime on disk)
 *   - `synced`: the server state we last agreed on, or null if never
 * A path whose local state differs from `synced` has a change to upload.
 *
 * Kept in its own file (index-v2.json), so a downgrade to 1.5.x finds its own
 * metadata.json untouched.
 */
export interface SyncedState {
	sha1: string | null;
	action: "created" | "deleted";
	seq?: number;
}

export interface IndexEntry {
	type: "file" | "folder";
	action: "created" | "deleted";
	sha1: string | null;
	// the mtime on disk when we last hashed it (to skip unchanged files)
	lmtime: number;
	// the mtime sent to the server (server time)
	mtime: number;
	synced: SyncedState | null;
	// set on a path that was renamed while offline, to try a history-keeping rename later
	from?: string;
}

const FILE = "index-v2.json";

export function sameState(a, b) {
	return !!a && !!b && a.action === b.action &&
		(a.action === "deleted" || a.type === "folder" || b.type === "folder" || a.sha1 === b.sha1);
}

export function isDirty(entry: IndexEntry) {
	if (!entry) {
		return false;
	}
	if (!entry.synced) {
		// never synced: a delete of something the server never had is no change
		return entry.action === "created";
	}
	return !sameState({ type: entry.type, action: entry.action, sha1: entry.sha1 }, Object.assign({ type: entry.type }, entry.synced));
}

export default class LocalIndex {
	fs: any;
	entries: Record<string, IndexEntry> = {};
	epoch: string | null = null;
	cursor: number | null = null;
	loaded = false;
	// whether index-v2.json existed when it was loaded (false on a device's first 1.6.0 sync)
	existed = false;
	saveTimeout: any = null;

	constructor(fsInternal) {
		this.fs = fsInternal;
	}

	async load() {
		if (this.loaded) {
			return this.existed;
		}
		this.loaded = true;
		try {
			const raw = await this.fs.read(FILE);
			if (raw) {
				const data = JSON.parse(raw);
				if (data && data.version === 2 && data.entries) {
					this.entries = data.entries;
					this.epoch = data.epoch || null;
					this.cursor = typeof data.cursor === "number" ? data.cursor : null;
					this.existed = true;
					return true;
				}
			}
		} catch (e) {
			console.error("AnySocket Sync - index unreadable, rebuilding it", e);
		}
		this.entries = {};
		this.epoch = null;
		this.cursor = null;
		return false;
	}

	get(path: string): IndexEntry | null {
		return this.entries[path] || null;
	}

	set(path: string, entry: IndexEntry) {
		this.entries[path] = entry;
		this.scheduleSave();
	}

	remove(path: string) {
		delete this.entries[path];
		this.scheduleSave();
	}

	paths() {
		return Object.keys(this.entries);
	}

	dirtyPaths() {
		return this.paths().filter(path => isDirty(this.entries[path]));
	}

	setCursor(epoch, cursor) {
		this.epoch = epoch;
		this.cursor = cursor;
		this.scheduleSave();
	}

	// forget where we were with the server, but keep what we know (next sync is a full one)
	resetCursor() {
		this.setCursor(null, null);
	}

	scheduleSave() {
		if (this.saveTimeout) {
			return;
		}
		this.saveTimeout = setTimeout(() => {
			this.saveTimeout = null;
			this.save();
		}, 500);
	}

	async save() {
		clearTimeout(this.saveTimeout);
		this.saveTimeout = null;
		try {
			await this.fs.write(FILE, JSON.stringify({
				version: 2,
				epoch: this.epoch,
				cursor: this.cursor,
				entries: this.entries
			}));
		} catch (e) {
			console.error("AnySocket Sync - could not save the index", e);
		}
	}

	async drop() {
		this.entries = {};
		this.epoch = null;
		this.cursor = null;
		await this.fs.forceDelete(FILE).catch(() => {});
	}
}
