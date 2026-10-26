// @ts-nocheck
import {TAbstractFile} from "obsidian";
import Utils from "../libs/Utils";
import AnySocket from "anysocket/dist/anysocket.browser.js";

/**
 * Sync with a 1.5.x server (the protocol before 1.6.0), kept as it was in 1.5.0.
 * Only used until that server is updated; a 1.5.x server also pushes its own plugin
 * version, so this mostly runs for the moment before the plugin is replaced.
 */
export default class LegacySync {
	xSync: any;
	deleteQueue: Record<string, any> = {}; // path -> delete event
	isProcessingDeleteQueue: boolean = false;
	unsentSessionEvents: Record<string, any> = {};
	isSyncing = false;
	running = false;

	constructor(xSync) {
		this.xSync = xSync;
	}

	get anysocket() {
		return this.xSync.anysocket;
	}

	get storage() {
		return this.xSync.storage;
	}

	get plugin() {
		return this.xSync.plugin;
	}

	get xTimeouts() {
		return this.xSync.xTimeouts;
	}

	get debug() {
		return this.plugin.settings.debug;
	}

	get status() {
		return this.xSync.status;
	}

	async start(peer) {
		this.running = true;
		this.deleteQueue = await this.storage.loadDeleteQueue();

		// a 1.5.x server disconnects a device that never says its name
		await peer.rpc.setDeviceId(this.plugin.settings.deviceName || "Unknown device");
		if(!this.plugin.settings.autoSync) {
			await peer.rpc.autoSync(this.plugin.settings.autoSync);
		}

		if(Object.keys(this.deleteQueue).length > 0) {
			await this.processDeleteQueue();
		}

		if(this.plugin.settings.autoSync) {
			await this.sync();
		}
		else {
			this.status.set("paused", { pending: Object.keys(this.unsentSessionEvents).length });
		}
	}

	async stop() {
		this.running = false;
		this.isSyncing = false;
	}

	syncNow() {
		return this.sync();
	}

	onMessage(packet) {
		switch (packet.msg.type) {
			case "file_data":
				this.onFileData(packet.msg.data, packet.peer);
				break;
			case "sync_complete":
				this.onSyncCompleted(packet.peer);
				break;
		}
	}

	onLocalEvent(type, file, args) {
		return this.processLocalEvent(type, file, args);
	}

	request(packet) {
		return this.anysocket.request(packet);
	}

	async listVersions(path) {
		return await this.request({
			type: "file_history",
			data: {
				type: "list_versions",
				path: path,
			}
		});
	}

	async readVersion(path, timestamp) {
		const isBinary = Utils.isBinary(path);
		const data = await this.request({
			type: "file_history",
			data: {
				type: "read",
				binary: isBinary,
				path: path,
				timestamp: timestamp
			}
		});
		if (data == null) {
			return null;
		}
		return isBinary ? AnySocket.Packer.unpack(data) : new TextEncoder().encode(data);
	}

	async listFiles(deletedOnly) {
		return await this.request({
			type: "file_history",
			data: {
				type: "list_files",
				mode: deletedOnly ? "deleted": "all"
			}
		});
	}

	async restore(path, bytes) {
		const isBinary = Utils.isBinary(path);
		const data = isBinary ? bytes : new TextDecoder().decode(bytes);
		let metadata = await this.getMetadata("restore", { path, data });
		// force an update
		metadata.sha1 = null;
		if (isBinary) {
			await this.storage.writeBinary(path, bytes, metadata);
		} else {
			await this.storage.write(path, data, metadata);
		}
	}

	async processDeleteQueue() {
		if(!this.anysocket.isConnected) return;

		if(this.isProcessingDeleteQueue) {
			return;
		}

		const queuedPaths = Object.keys(this.deleteQueue);
		if(queuedPaths.length === 0) return;

		this.isProcessingDeleteQueue = true;

		const itemsToProcess = {...this.deleteQueue};
		const processedPaths: string[] = [];

		try {
			for(let path of queuedPaths) {
				const deleteEvent = itemsToProcess[path];
				try {
					// Safety check: verify file is actually still deleted
					const file = app.vault.getAbstractFileByPath(path);
					if (file) {
						// File exists again - check if it's newer than our queued deletion
						const currentMetadata = await this.storage.readMetadata(path);
						if (currentMetadata && currentMetadata.mtime > deleteEvent.metadata.mtime) {
							processedPaths.push(path); // Remove from queue
							continue;
						}
					}

					this.anysocket.peer.send({
						type: "file_event",
						data: {
							...deleteEvent.metadata,
							path: path
						}
					});
					processedPaths.push(path);
				} catch(e) {
					console.error("Failed to send deletion event:", path, e);
				}
			}

			for(let path of processedPaths) {
				delete this.deleteQueue[path];
			}

			await this.storage.saveDeleteQueue(this.deleteQueue);
		} finally {
			this.isProcessingDeleteQueue = false;

			if(Object.keys(this.deleteQueue).length > 0) {
				this.processDeleteQueue().catch(e => {
					console.error("Error in follow-up delete queue processing:", e);
				});
			}
		}
	}

	async sync() {
		if(!this.anysocket.isConnected) return;
		if(this.isSyncing) return;

		for(let key in this.unsentSessionEvents) {
			let event = this.unsentSessionEvents[key];
			await this._processLocalEvent(event.action, event.file, event.metadata, false);
		}
		this.unsentSessionEvents = {};

		this.isSyncing = true;
		this.status.set("syncing", { done: 0, total: 0 });
		this.debug && console.log("sync");

		await this.storage.computeTree();

		let data = [];
		for (const path in this.storage.tree) {
			const metadata = this.storage.tree[path];
			data.push({
				path,
				metadata
			});
		}

		this.anysocket.send({
			type: "sync",
			data: data
		});
	}

	async onSyncCompleted(peer) {
		this.isSyncing = false;
		this.status.set("synced", { at: Date.now() });
	}

	// create, modify, delete, rename
	async processLocalEvent(action: string, file: TAbstractFile, args: any, forceChanged: boolean = false) {
		if ((action == "create" || action == "modify") && this.deleteQueue[file.path]) {
			delete this.deleteQueue[file.path];
			await this.storage.saveDeleteQueue(this.deleteQueue);
		}

		if (action == "rename") {
			const oldPath = args[0];
			const oldMetadata = await this.storage.readMetadata(oldPath);

			if (oldMetadata) {
				this.deleteQueue[oldPath] = {
					action: "delete",
					path: oldPath,
					metadata: {
						action: "deleted",
						sha1: oldMetadata.sha1,
						mtime: await this.anysocket.getTime(),
						type: oldMetadata.type
					},
					timestamp: Date.now()
				};
			} else {
				this.deleteQueue[oldPath] = {
					action: "delete",
					path: oldPath,
					metadata: {
						action: "deleted",
						sha1: null,
						mtime: await this.anysocket.getTime(),
						type: "file"
					},
					timestamp: Date.now()
				};
			}

			await this.storage.saveDeleteQueue(this.deleteQueue);

			if(this.anysocket.isConnected) {
				this.processDeleteQueue().catch(e => {
					console.error("Error processing delete queue:", e);
				});
			}

			await this.processLocalEvent("create", file, null, true);
			return;
		}

		let metadata = await this.getMetadata(action, file);
		if (action == "delete") {
			this.deleteQueue[file.path] = {
				action: action,
				path: file.path,
				metadata: metadata.metadata,
				timestamp: Date.now()
			};

			await this.storage.saveDeleteQueue(this.deleteQueue);

			if(this.anysocket.isConnected) {
				this.processDeleteQueue().catch(e => {
					console.error("Error processing delete queue:", e);
				});
			}

			return;
		}

		// Queue events if autoSync is disabled or not connected
		if(!this.plugin.settings.autoSync || !this.anysocket.isConnected) {
			this.unsentSessionEvents[file.path] = {
				action: action,
				file: file,
				metadata: metadata
			};
			return;
		}

		if(action == "modify" && this.plugin.settings.delayedSync > 0) {
			this.xTimeouts.set(file.path, this.plugin.settings.delayedSync * 1000, async () => {
				await this._processLocalEvent(action, file, metadata, forceChanged);
			});
		}
		else {
			await this._processLocalEvent(action, file, metadata, forceChanged);
		}
	}

	async _processLocalEvent(action: string, file: TAbstractFile, metadata: any, forceChanged: boolean = false) {
		try {
			let result = metadata || await this.getMetadata(action, file);
			// Skip change detection if forceChanged is true (e.g., rename)
			if (!forceChanged && !result.changed) {
				return;
			}

			if (!this.anysocket.isConnected) {
				return;
			}

			this.debug && console.log("Sending file event:", action, file.path);
			result.metadata.path = file.path;
			this.anysocket.peer.send({
				type: "file_event",
				data: result.metadata
			}).catch(e => {
				console.error("Failed to send file event:", file.path, e);
			});
		} catch (e) {
			console.error("Error in _processLocalEvent:", e);
		}
	}

	async onFileData(data, peer) {
		this.debug && console.log("FileData:", data);

		if(!this.plugin.settings.autoSync && !this.isSyncing) {
			return;
		}

		if(!Utils.isSafePath(data.path)) {
			console.error("AnySocket Sync - Rejected unsafe path from server:", data.path);
			return;
		}

		if (data.type == "send") {
			let isBinary = Utils.isBinary(data.path);
			const fileData = isBinary ?
				await this.storage.readBinary(data.path) :
				await this.storage.read(data.path);
			const metadata = await this.storage.readMetadata(data.path);

			this.anysocket.send({
				type: "file_data",
				data: {
					type: "apply",
					binary: isBinary,
					data: isBinary ? AnySocket.Packer.pack(fileData) : fileData,
					path: data.path,
					metadata: metadata
				}
			});
		} else if (data.type == "apply") {
			switch (data.metadata.action) {
				case "created":
					if (data.metadata.type == "folder") {
						await this.storage.makeFolder(data.path, data.metadata);
					} else {
						if(data.binary) {
							await this.storage.writeBinary(data.path, AnySocket.Packer.unpack(data.data), data.metadata);
						}
						else {
							await this.storage.write(data.path, data.data, data.metadata);
						}
					}
					this.xSync.activity.add("downloaded", data.path);
					break;
				case "deleted":
					await this.storage.delete(data.path, data.metadata);
					this.xSync.activity.add("deleted", data.path);
					break;
			}
		}
		return true;
	}

	async getMetadata(action, file, itemTime) {
		let isBinary = Utils.isBinary(file.path);

		let typeToAction = {
			"sync": "created",
			"restore": "created",
			"create": "created",
			"modify": "created",
			"rename": "created",
			"delete": "deleted"
		}

		// Get stored metadata first (needed for deletions)
		let storedMetadata = await this.storage.readMetadata(file.path);

		let itemType;
		let itemData;
		let sha1;

		if (action == "restore") {
			itemData = file.data;
			itemType = "file";
			sha1 = isBinary ? await Utils.getSHABinary(itemData) : await Utils.getSHA(itemData);
		} else if (action == "delete") {
			// File is already deleted, can't read it
			// Preserve the last known SHA1 from stored metadata
			itemType = file.stat ? "file" : (storedMetadata ? storedMetadata.type : "file");
			sha1 = storedMetadata ? storedMetadata.sha1 : null;
		} else {
			itemData = isBinary ? await this.storage.readBinary(file.path) : await this.storage.read(file.path);
			itemType = file.stat ? "file" : "folder";
			sha1 = isBinary ? await Utils.getSHABinary(itemData) : await Utils.getSHA(itemData);
		}

		let metadata = {
			action: typeToAction[action],
			sha1: sha1,
			mtime: itemTime || await this.anysocket.getTime(),
			type: itemType
		};

		if(action == "restore") {
			return metadata;
		}

		// if the storedMetadata (sha1) is the same as the current one
		// this means that we just wrote this file, so we skip
		if (storedMetadata && metadata.action == storedMetadata.action && metadata.sha1 == storedMetadata.sha1) {
			return {
				changed: false,
				metadata: storedMetadata
			};
		}

		await this.storage.writeMetadata(file.path, metadata);

		return {
			changed: true,
			metadata: metadata
		};
	}
}
