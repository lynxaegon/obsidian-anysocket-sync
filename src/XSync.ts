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
				await this.load(false);
			} else {
				// Full cleanup when disabling
				this.unload(true);
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

	async sync() {
		if(!this.anysocket.isConnected) return;
		if(this.isSyncing) return;

		for(let key in this.unsentSessionEvents) {
			let event = this.unsentSessionEvents[key];
			await this.processLocalEvent(event.action, event.file, event.args, true);
		}
		this.unsentSessionEvents = {};

		this.isSyncing = true;
		this.xNotify.notifyStatus(NotifyType.SYNCING);
		this.debug && console.log("sync");
		let data = [];
		await this.storage.iterate(async (item: any) => {
			let mtime = null;
			if (item.children === undefined) {
				mtime = item.stat.mtime;
			}
			else {
				mtime = await this.getFolderMtime(item);
				// skip empty folders
				if(mtime === false) {
					return;
				}
			}

			let result = await this.getMetadata("sync", item, mtime);
			data.push({
				path: item.path,
				metadata: result.metadata
			});
		});

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
	async processLocalEvent(action: string, file: TAbstractFile, args: any, fromUnsent: boolean = false) {
		if(!this.anysocket.isConnected) {
			return;
		}

		if(!this.plugin.settings.autoSync && !fromUnsent) {
			this.unsentSessionEvents[file.path] = {
				action: action,
				file: file,
				args: args
			};
			return;
		}

		if (action == "rename") {
			await this.processLocalEvent("delete", {path: args[0]}, null, fromUnsent)
			await this.processLocalEvent("create", file, null, fromUnsent);
			return;
		}

		let metadata = await this.getMetadata(action, file);
		if(action == "modify" && this.plugin.settings.delayedSync > 0) {
			this.xTimeouts.set(file.path, this.plugin.settings.delayedSync * 1000, async () => {
				await this._processLocalEvent(action, file, metadata);
			});
		}
		else {
			await this._processLocalEvent(action, file, metadata);
		}
	}

	async _processLocalEvent(action: string, file: TAbstractFile, metadata: any) {
		this.debug && console.log("anysocket sync event", action, file.path, metadata);
		try {
			let result = metadata || await this.getMetadata(action, file);
			if (!result.changed || !this.anysocket.isConnected) {
				return;
			}
			result.metadata.path = file.path;
			this.anysocket.send({
				type: "file_event",
				data: result.metadata
			});
		} catch (e) {
			console.error(e);
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
		this.anysocket.on("focus", () => {
			// Mark that we're resuming from background
			this.xNotify.setFromBackground(true);
		});
		this.anysocket.on("reload", this.reload.bind(this));
		this.anysocket.on("unload", this.unload.bind(this));
		this.anysocket.on("disconnected", () => {
			this.xNotify.notifyStatus(NotifyType.CONNECTION_LOST);
			this.debug && console.log("disconnected");
		});

		this.anysocket.init();
	}

	unload(cleanup = true) {
		clearTimeout(this.reloadTimeout);
		
		// Only cleanup notifications on full unload, not on reload
		// Notification timeouts check connection state anyway
		if (cleanup) {
			this.xNotify.cleanup();
		}

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
		// Don't cleanup notifications on reload - let them run
		this.unload(false);
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
			this.anysocket.send({
				type: "file_data",
				data: {
					type: "apply",
					binary: isBinary,
					data: isBinary ?
						AnySocket.Packer.pack(await this.storage.readBinary(data.path)) :
						await this.storage.read(data.path),
					path: data.path,
					metadata: await this.storage.readMetadata(data.path)
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

		let itemType;
		let itemData;
		if (action == "restore") {
			itemData = file.data;
			itemType = "file";
		} else {
			itemData = isBinary ? await this.storage.readBinary(file.path) : await this.storage.read(file.path);
			itemType = file.stat ? "file" : "folder";
		}

		let metadata = {
			action: typeToAction[action],
			sha1: isBinary ?
				await Utils.getSHABinary(itemData) :
				await Utils.getSHA(itemData),
			mtime: itemTime || await this.anysocket.getTime(),
			type: itemType
		};

		if(action == "restore") {
			return metadata;
		}

		// if the storedMetadata (sha1) is the same as the current one
		// this means that we just wrote this file, so we skip
		let storedMetadata = await this.storage.readMetadata(file.path);
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

	async getFolderMtime(file) {
		if(file.stat) {
			return file.stat.mtime;
		}

		if(file.children.length <= 0) {
			return false;
		}

		let hasValue = false;
		let minMtime = await this.anysocket.getTime();
		for(let child of file.children) {
			let mtime = await this.getFolderMtime(child);
			if(mtime == false) {
				continue;
			}

			if(minMtime > mtime) {
				hasValue = true;
				minMtime = mtime;
			}
		}

		return hasValue ? minMtime : false;
	}

	makeStatusBarItem(statusbar: any) {
		this.xNotify.makeStatusBarItem(statusbar);
	}
}
