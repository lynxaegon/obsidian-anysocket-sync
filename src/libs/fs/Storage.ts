// @ts-nocheck
import FSAdapter from "./FSAdapter";
import {normalizePath} from "obsidian";
import Utils from "../Utils";

export default class Storage {
	static tree: any = null;
	fsVault: FSAdapter;
	fsInternal: FSAdapter;
	private inited = false;
	private deleteQueueFile = "sync-delete-queue.json";
	private metadataFile = "metadata.json";
	private throttledWriteTimeout: any = null;
	private lastWriteTime: number = 0;
	getTime: () => Promise<number>;

	constructor(plugin, getTime?: () => Promise<number>) {
		this.fsVault = new FSAdapter(normalizePath("/"));
		this.fsInternal = new FSAdapter(plugin.manifest.dir + "/");
		this.getTime = getTime || (async () => Date.now());
	}

	async init() {
		if(this.inited)
			return;

		this.tree = {};
		this.inited = true;

		try {
			const metaJson = await this.fsInternal.read(this.metadataFile);
			if(metaJson) {
				this.tree = JSON.parse(metaJson);
			}
		} catch(e) {
			// Ignore if not found/corrupted
		}
	}

	async loadDeleteQueue() {
		try {
			const queueJson = await this.fsInternal.read(this.deleteQueueFile);
			if(queueJson) {
				return JSON.parse(queueJson);
			}
		} catch(e) {
			// Queue doesn't exist or is corrupted
		}
		return {};
	}

	async saveDeleteQueue(queue: Record<string, any>) {
		try {
			await this.fsInternal.write(this.deleteQueueFile, JSON.stringify(queue, null, 2));
		} catch(e) {
			console.error("Failed to save delete queue:", e);
		}
	}

	async write(path: string, data: string, metadata: any) {
		await this.writeMetadata(path, metadata);
		return await this.fsVault.write(path, data, metadata.mtime);
	}

	async writeBinary(path: string, data: Uint8Array, metadata: any) {
		await this.writeMetadata(path, metadata);
		return await this.fsVault.write(path, data, metadata.mtime, true);
	}

	async makeFolder(path: string, metadata: any) {
		await this.writeMetadata(path, metadata);
		return await this.fsVault.makeFolder(path);
	}

	async read(path: string) {
		return await this.fsVault.read(path);
	}

	async readBinary(path: string) {
		return await this.fsVault.read(path, true);
	}

	async delete(path: string, metadata: any) {
		await this.writeMetadata(path, metadata);
		return await this.fsVault.delete(path);
	}

	async exists(path: string) {
		return await this.fsVault.exists(path);
	}

	async iterate(callback: any) {
		await this.fsVault.iterate(async (item) => {
			// skip root
			if(item.path == "/")
				return;
			await callback(item);
		});
	}

	async readMetadata(path: string) {
		if(!this.tree[path]) {
			return null;
		}

		return this.tree[path];
	}

	private scheduleThrottledWrite() {
		const now = Date.now();
		if (now - this.lastWriteTime < 500) {
			clearTimeout(this.throttledWriteTimeout);
			this.throttledWriteTimeout = setTimeout(() => {
				this.writeMetadataFile();
			}, 500 - (now - this.lastWriteTime));
		} else {
			this.writeMetadataFile();
		}
	}

	private async writeMetadataFile() {
		try {
			await this.fsInternal.write(this.metadataFile, JSON.stringify(this.tree, null, 2));
			this.lastWriteTime = Date.now();
		} catch(e) {
			console.error("Failed to write metadata.json:", e);
		}
	}

	public async dropMetadata() {
		try {
			await this.fsInternal.forceDelete(this.metadataFile);
		} catch(e) {
			console.error("Failed to drop metadata.json:", e);
		}
	}

	async writeMetadata(path: string, metadata: any) {
		this.tree[path] = metadata;
		this.scheduleThrottledWrite();
	}

	async computeTree() {
		const seenPaths = new Set<string>();
		const offset = (await this.getTime()) - Date.now();
		await this.fsVault.iterate(async (item) => {
			if(item.path == "/") return;
			seenPaths.add(item.path);
			const stat = item.stat;
			const stored = this.tree[item.path];
			let meta: any = { type: stat ? "file" : "folder" };
			if (meta.type === "folder") {
				const mtime = await this.getFolderMTime(item, offset);
				if (mtime === false) return; // skip empty folders
				meta.mtime = mtime;
				if (stored && stored.mtime === mtime) return; // unchanged folder
			} else {
				if (stored && stored.mtime === stat.mtime + offset) return; // unchanged file
				try {
					const isBinary = Utils.isBinary(item.path);
					const data = isBinary ? await this.fsVault.read(item.path, true) : await this.fsVault.read(item.path);
					meta.sha1 = isBinary ? await Utils.getSHABinary(data) : await Utils.getSHA(data);
					meta.mtime = stat.mtime + offset; // adjust local mtime to server time
				} catch(e) {
					console.error("Failed to update metadata for", item.path, e);
					return;
				}
			}
			meta.action = "created";
			this.tree[item.path] = meta;
			this.scheduleThrottledWrite();
		});
		for (const path in this.tree) {
			if (!seenPaths.has(path)) {
				delete this.tree[path];
				this.scheduleThrottledWrite();
			}
		}
	}

	async updatePlugin(files) {
		for(let item of files) {
			await this.fsInternal.write(item.path, item.data);
		}
	}

	getFileByPath(path) {
		if(path.substring(0, 1) == "/") {
			path = path.substring(1);
		}
		return this.fsVault.getFile(path);
	}

	async getFolderMTime(file, offset = 0) {
		if (file.stat) {
			return file.stat.mtime + offset;
		}
		if (!file.children || file.children.length <= 0) {
			return false;
		}
		let hasValue = false;
		let minMtime = Infinity;
		for (let child of file.children) {
			let mtime = await this.getFolderMTime(child, offset);
			if (mtime === false) {
				continue;
			}
			if (minMtime > mtime) {
				hasValue = true;
				minMtime = mtime;
			}
		}
		return hasValue ? minMtime : false;
	}
}
