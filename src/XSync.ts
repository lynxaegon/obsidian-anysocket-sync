// @ts-nocheck
import {
	TAbstractFile,
	Plugin, Notice,
} from "obsidian";
import AnysocketManager from "./libs/AnysocketManager";
import Utils from "./libs/Utils";
import Storage from "./libs/fs/Storage";
import { inspect } from "util";

const DEBUG = true;


export default class XSync {
	plugin: Plugin;
	isEnabled = false;
	eventRefs: any = {};
	anysocket: any;
	storage: Storage = new Storage();
	reloadTimeout = null;
	deviceName: "Unknown";

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.anysocket = new AnysocketManager(this);

		/* realtime CRDT sync
		this.plugin.registerEditorExtension(
			EditorView.updateListener.of((update) => {
				if (update.changes) {
					// Iterate over the changes
					update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
						if (fromA === toA && fromB !== toB) {
							// This is an insertion
							console.log("Insertion detected from", fromB, "to", toB, ":", inserted.toString());
						} else if (fromA !== toA && fromB === toB) {
							// This is a deletion
							console.log("Deletion detected from", fromA, "to", toA);
						} else {
							// This is a replace (deletion followed by an insertion)
							console.log("Replace detected from", fromA, "to", toA, "with", inserted.toString());
						}
					});
				}
			})
		);
		 */
	}

	async enabled(value) {
		if (this.isEnabled !== value) {
			this.isEnabled = value;
			this.anysocket.isEnabled = value;
			if (this.isEnabled) {
				await this.load(false);
			} else {
				this.unload(false);
			}
		}
	}

	async listVersionHistory(path, callback) {
		if (!this.isEnabled) {
			return new Notice("🟡 AnySocket Sync - Plugin is disabled");
		}

		if (!this.anysocket.isConnected) {
			return new Notice("🟡 AnySocket Sync - Not Connected");
		}

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
		if (!this.isEnabled) {
			return new Notice("🟡 AnySocket Sync - Plugin is disabled");
		}

		if (!this.anysocket.isConnected) {
			return new Notice("🟡 AnySocket Sync - Not Connected");
		}

		this.anysocket.send({
			type: "file_history",
			data: {
				type: "read",
				path: path,
				timestamp: timestamp
			}
		}, (packet) => {
			callback(packet.msg);
		});
	}

	async listFilesHistory(deletedOnly, callback) {
		if (!this.isEnabled) {
			return new Notice("🟡 AnySocket Sync - Plugin is disabled");
		}

		if (!this.anysocket.isConnected) {
			return new Notice("🟡 AnySocket Sync - Not Connected");
		}

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
		DEBUG && console.log("sync");
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

	// create, modify, delete, rename
	async processLocalEvent(action: string, file: TAbstractFile, args: any) {
		if (action == "rename") {
			await this.processLocalEvent("delete", {path: args[0]})
			await this.processLocalEvent("create", file);
			return;
		}
		DEBUG && console.log("event", action, file.path);

		try {
			let result = await this.getMetadata(action, file);
			if (!result.changed)
				return;

			if (!this.anysocket.isConnected) {
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

		await this.storage.init();
		await (async () => {
			let loaded = 0;
			let times = 2;
			return new Promise((resolve) => {
				let interval = setInterval(() => {
					let current = app.vault.getAllLoadedFiles();
					if (loaded < current.length) {
						loaded = current.length;
					} else if (loaded == current.length && --times <= 0) {
						clearInterval(interval);
						resolve();
					}
				}, 500);
			});
		})();

		// wait for vault creation before registering to events
		this.registerEvent("create");
		this.registerEvent("modify");
		this.registerEvent("delete");
		this.registerEvent("rename");

		this.anysocket.on("connected", async (peer) => {
			new Notice("🟢 AnySocket Sync - Connected");
			this.plugin.ribbonIcon.style.color = "";

			let syncPlugin = app.internalPlugins.plugins["sync"].instance;
			let deviceName = syncPlugin.deviceName ? syncPlugin.deviceName : syncPlugin.getDefaultDeviceName();

			await peer.rpc.setDeviceId(deviceName);
			await this.sync();
		});

		this.anysocket.on("message", (packet) => {
			switch (packet.msg.type) {
				case "file_data":
					this.onFileData(packet.msg.data, packet.peer);
					break;
			}
		});
		this.anysocket.on("reload", this.reload.bind(this));
		this.anysocket.on("unload", this.unload.bind(this));
		this.anysocket.on("disconnected", () => {
			new Notice("🔴 AnySocket Sync - Lost connection");
			this.plugin.ribbonIcon.style.color = "red";

			DEBUG && console.log("disconnected");
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

		this.anysocket.stop();

		this.anysocket.removeAllListeners();
		this.plugin.ribbonIcon.style.color = "red";
	}

	reload() {
		DEBUG && console.log("reloaded");
		this.unload();
		this.reloadTimeout = setTimeout(() => {
			this.load();
		}, 1000);
	}

	async onFileData(data, peer) {
		DEBUG && console.log("FileData:", data);
		if (data.type == "send") {
			this.anysocket.send({
				type: "file_data",
				data: {
					type: "apply",
					data: await this.storage.read(data.path),
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
						await this.storage.write(data.path, data.data, data.metadata);
					}
					break;
				case "deleted":
					await this.storage.delete(data.path, data.metadata);
					break;
			}
		} else if (data.type == "sync") {
			DEBUG && console.log("sync", data);
		}
		return true;
	}

	async getMetadata(action, file, itemTime) {
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
			itemData = file;
			itemType = "file";
		} else {
			itemData = await this.storage.read(file.path);
			itemType = file.stat ? "file" : "folder";
		}

		let metadata = {
			action: typeToAction[action],
			sha1: await Utils.getSHA(itemData),
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
}
