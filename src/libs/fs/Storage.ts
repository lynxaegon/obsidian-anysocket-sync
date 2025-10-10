// @ts-nocheck
import FSAdapter from "./FSAdapter";
import {normalizePath} from "obsidian";

export default class Storage {
	static tree: any = null;
	fsVault: FSAdapter;
	fsInternal: FSAdapter;
	private inited = false;
	private deleteQueueFile = "sync-delete-queue.json";

	constructor(plugin) {
		this.fsVault = new FSAdapter(normalizePath("/"));
		this.fsInternal = new FSAdapter(plugin.manifest.dir + "/");
	}

	async init() {
		if(this.inited)
			return;

		this.tree = {};
		this.inited = true;
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

	async clearDeleteQueue() {
		try {
			await this.fsInternal.write(this.deleteQueueFile, JSON.stringify({}, null, 2));
		} catch(e) {
			console.error("Failed to clear delete queue:", e);
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

	async writeMetadata(path: string, metadata: any) {
		if(!this.tree[path]) {
			this.tree[path] = {};
		}
		for(let key in metadata) {
			this.tree[path][key] = metadata[key];
		}

		return this.tree[path];
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
}
