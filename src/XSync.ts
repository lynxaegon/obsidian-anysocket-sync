// @ts-nocheck
import {
	TAbstractFile,
	Plugin, Notice,
} from "obsidian";
import AnysocketManager from "./libs/AnysocketManager";
import Utils from "./libs/Utils";
import Storage from "./libs/fs/Storage";

const DEBUG = true;

// TODO: implement storage tree compaction (both server&client)
export default class XSync {
	plugin: Plugin;
	isEnabled = false;
	eventRefs: any = {};
	anysocket: any;
	storage: Storage = new Storage();
	reloadTimeout = null;

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

	async sync() {
		DEBUG && console.log("sync");
		let data = [];
		await this.storage.iterate(async (item: any) => {
			let result = await this.getMetadata("sync", item, item.stat.mtime);
			data.push({
				path: item.path,
				metadata: result.metadata
			});
		});

		this.anysocket.broadcast({
			type: "sync",
			data: data
		});
	}

	// create, modify, delete, rename
	async processLocalEvent(action: string, file: TAbstractFile, args: any) {
		if(action == "rename") {
			await this.processLocalEvent("delete", {path: args[0]})
			await this.processLocalEvent("create", file);
			return;
		}
		DEBUG && console.log("event", action, file.path);

		try {
			let result = await this.getMetadata(action, file);
			if(!result.changed)
				return;

			if (!this.anysocket.isConnected) {
				return;
			}

			result.metadata.path = file.path;
			this.anysocket.broadcast({
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

		this.anysocket.on("connected", async () => {
			new Notice("🟢 AnySocket Sync - Connected");
			this.plugin.ribbonIcon.style.color = "";

			await this.sync();
		});
		this.anysocket.on("message", this.onMessage.bind(this));
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

	async onMessage(packet: any) {
		switch (packet.msg.type) {
			case "file_data":
				return this.onFileData(packet.peer, packet.msg.data);
		}
	}

	async onFileData(peer, data) {
		DEBUG && console.log("FileData:", data);
		if (data.type == "send") {
			this.anysocket.broadcast({
				type: "file_data",
				data: {
					type: "apply",
					data: await this.storage.read(data.path),
					path: data.path,
					metadata: await this.storage.readMetadata(data.path)
				}
			});
		}
		else if (data.type == "apply") {
			switch (data.metadata.action) {
				case "created":
					await this.storage.write(data.path, data.data, data.metadata);
					break;
				case "deleted":
					await this.storage.delete(data.path, data.metadata);
					break;
			}
		} else if (data.type == "sync") {
			DEBUG && console.log("sync", data);
		}
	}

	private async getMetadata(action, file, itemTime) {
		let typeToAction = {
			"sync": "created",
			"create": "created",
			"modify": "created",
			"rename": "created",
			"delete": "deleted"
		}
		let metadata = {
			action: typeToAction[action],
			sha1: await Utils.getSHA(await this.storage.read(file.path)),
			mtime: itemTime || await this.anysocket.getTime(),
			type: file.children === undefined ? "file" : "folder"
		};

		// if the storedMetadata (sha1( is the same as the current one
		// this means that we just wrote this file, so we skip
		let storedMetadata = await this.storage.readMetadata(file.path);
		if(storedMetadata && metadata.action == storedMetadata.action && metadata.sha1 == storedMetadata.sha1) {
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
