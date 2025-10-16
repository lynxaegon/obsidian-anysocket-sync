// @ts-nocheck
import {
	TAbstractFile,
	Plugin,
} from "obsidian";
import AnysocketManager from "./libs/AnysocketManager";
import Utils from "./libs/Utils";
import Storage from "./libs/fs/Storage";
import AnySocket from "anysocket/src/libs/AnySocket";
import XTimeouts from "./libs/XTimeouts";
import XNotify, { NotifyType } from "./libs/XNotify";


export default class XSync {
	plugin: Plugin;
	isEnabled = false;
	eventRefs: any = {};
	anysocket: any;
	xTimeouts: XTimeouts;
	storage: Storage;
	reloadTimeout = null;
	xNotify: XNotify;
	deleteQueue: Record<string, any> = {}; // path -> delete event
	isProcessingDeleteQueue: boolean = false;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.unsentSessionEvents = {};
		this.anysocket = new AnysocketManager(this);
		this.storage = new Storage(plugin);
		this.xTimeouts = new XTimeouts();
		this.xNotify = new XNotify(this);
	}

	async enabled(value) {
		if (this.isEnabled !== value) {
			this.isEnabled = value;
			if (this.isEnabled) {
				await this.load();
			} else {
				this.unload();
			}
		}
	}

	connectionOK() {
		if (!this.isEnabled) {
			this.xNotify.notifyStatus(NotifyType.PLUGIN_DISABLED);
			return false;
		}

		if (!this.anysocket.isConnected) {
			this.xNotify.notifyStatus(NotifyType.NOT_CONNECTED);
			return false;
		}

		return true;
	}

	async listVersionHistory(path, callback) {
		this.anysocket.send({
			type: "file_history",
			data: {
				type: "list_versions",
				path: path,
			}
		}, (packet) => {
			callback(packet.msg);
		});
	}

	async readVersionHistory(path, timestamp, callback) {
		if(!this.connectionOK()) return;

		this.anysocket.send({
			type: "file_history",
			data: {
				type: "read",
				binary: Utils.isBinary(path),
				path: path,
				timestamp: timestamp
			}
		}, (packet) => {
			callback(packet.msg);
		});
	}

	async listFilesHistory(deletedOnly, callback) {
		if(!this.connectionOK()) return;

		this.anysocket.send({
			type: "file_history",
			data: {
				type: "list_files",
				mode: deletedOnly ? "deleted": "all"
			}
		}, (packet) => {
			callback(packet.msg);
		});
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
			
			const remaining = Object.keys(this.deleteQueue).length;
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
		this.xNotify.notifyStatus(NotifyType.SYNCING);
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
		this.xNotify.notifyStatus(NotifyType.SYNC_COMPLETED);
	}

	async onFocusChanged() {
		this.xTimeouts.executeAll();
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

	registerEvent(type: any) {
		this.eventRefs[type] = app.vault.on(type, async (file, ...args) => {
			if (!this.isEnabled)
				return;

			await this.processLocalEvent(type, file, args);
		});
	}

	unregisterEvent(type: any) {
		app.vault.offref(this.eventRefs[type])
	}

	async load() {
		if (!this.isEnabled)
			return;

		if (this.inited == true)
			return;
		this.inited = true;

		this.anysocket.isEnabled = this.plugin.settings.syncEnabled;
		this.debug = this.plugin.settings.debug;

		await this.storage.init();
		
		this.deleteQueue = await this.storage.loadDeleteQueue();

		this.registerEvent("create");
		this.registerEvent("modify");
		this.registerEvent("delete");
		this.registerEvent("rename");

		let focusChanged = Utils.debounce(this.onFocusChanged.bind(this), 500);
		this.eventRefs["active-leaf-change"] = app.workspace.on('active-leaf-change', focusChanged);
		this.eventRefs["layout-change"] = app.workspace.on('layout-change', focusChanged);

		this.anysocket.on("connected", async (peer) => {
			this.xNotify.notifyStatus(NotifyType.CONNECTED);

			let deviceName = this.plugin.settings.deviceName || null;
			if(deviceName != null && deviceName != "Unknown") {
				await peer.rpc.setDeviceId(deviceName);
			}
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
				this.xNotify.notifyStatus(NotifyType.AUTO_SYNC_DISABLED);
			}
		});

		this.anysocket.on("message", (packet) => {
			switch (packet.msg.type) {
				case "file_data":
					this.onFileData(packet.msg.data, packet.peer);
					break;
				case "sync_complete":
					this.onSyncCompleted(packet.peer);
					break;
			}
		});
		this.anysocket.on("reload", this.reload.bind(this));
		this.anysocket.on("unload", this.unload.bind(this));
		this.anysocket.on("disconnected", () => {
			this.xNotify.notifyStatus(NotifyType.CONNECTION_LOST);
			this.debug && console.log("disconnected");
		});

		this.anysocket.init();
	}

	unload() {
		clearTimeout(this.reloadTimeout);

		if (this.inited == false)
			return;
		this.inited = false;

		this.unregisterEvent("create");
		this.unregisterEvent("modify");
		this.unregisterEvent("delete");
		this.unregisterEvent("rename");
		app.workspace.offref(this.eventRefs["active-leaf-change"]);
		app.workspace.offref(this.eventRefs["layout-change"]);

		this.anysocket.stop();

		this.anysocket.removeAllListeners();
	}

	reload() {
		this.debug && console.log("reloaded");
		this.unload();
		this.reloadTimeout = setTimeout(() => {
			this.load();
		}, 1000);
	}

	async onFileData(data, peer) {
		this.debug && console.log("FileData:", data);

		if(!this.plugin.settings.autoSync && !this.isSyncing) {
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
					break;
				case "deleted":
					await this.storage.delete(data.path, data.metadata);
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

	makeStatusBarItem(statusbar: any) {
		this.xNotify.makeStatusBarItem(statusbar);
	}
}
