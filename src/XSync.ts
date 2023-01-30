// @ts-nocheck
import {
	TAbstractFile,
	Plugin, TFile, Notice,
} from "obsidian";
import AnySocketLoader from "./libs/AnySocketLoader";
import XCache from "./libs/cache";

// TODO: VALIDATE THAT EVERYHING WORKS ON MOBILE
export default class XSync {
	plugin: Plugin;
	isEnabled = false;
	eventRefs: any = {};
	anysocket: any;
	anysocketEnabled: boolean = false;
	isAnySocketConnected: boolean = false;
	xCache: XCache = new XCache();
	reloadTimeout = null;
	notifiedOfConnectError = false;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		AnySocketLoader.load();
		this.anysocket = new AnySocket();

		if(app.isMobile) {
			activeWindow.onblur = () => {
				this.unload(true);
				clearTimeout(this.reloadTimeout);
			};
			activeWindow.onfocus = () => {
				this.reload();
			};
		}
	}

	async getTime() {
		// replaced on connect
	}

	anysocketConnect() {
		if(!this.anysocketEnabled) {
			return;
		}
		
		if(!this.plugin.settings.password) {
			console.log("AnySocket Sync - Requires setup");
			new Notice("🟡 AnySocket Sync - Requires setup");
			this.unload(true);
			return;
		}

		// Used only to keep the same AnySocket ID after hot reload
		if(window._anysocketID) {
			this.anysocket.id = window._anysocketID;
			delete window._anysocketID;
		}
		this.anysocket.connect("ws", this.plugin.settings.host, this.plugin.settings.port).then(async (peer: any) => {
			peer.e2e();
			this.notifiedOfConnectError = false;
		}).catch((e) => {
			console.error("AnySocket Connect Error", e);
			this.isAnySocketConnected = false;
			if(!this.notifiedOfConnectError) {
				this.notifiedOfConnectError = true;
				new Notice("🟡 AnySocket Sync - Could not connect to the server");
			}
			this.reload();
		});
	}

	async getSHA1(data: any) {
		if(!data)
			return null;

		let sha = await crypto.subtle.digest("SHA-1", new TextEncoder("utf-8").encode(data));
		return Array.prototype.map.call(new Uint8Array(sha), x=>(('00'+x.toString(16)).slice(-2))).join('');
	}

	async sync() {
		let data: any = [];
		await this.xCache.iterateFiles(async (item: TFile) => {
			data.push({
				folder: !!item.children,
				path: item.path,
				mtime: item.stat?.mtime,
				sha1: await this.getSHA1(await this.xCache.read(item.path))
			});
		});
		this.anysocket.broadcast({
			type: "sync",
			data: data
		});
	}

	async processLocalEvent(type: string, file: TAbstractFile, args: any) {
		let path = file.path;

		try {
			let sha1 = await this.getSHA1(await this.xCache.read(path));
			this.anysocket.broadcast({
				type: "file_event",
				data: {
					type: type,
					folder: !!file.children,
					path: path,
					mtime: file.stat?.mtime,
					args: args ? args[0] : undefined,
					sha1: sha1
				}
			});
		}
		catch(e) {
			console.error(e);
		}
	}

	registerEvent(type: any) {
		this.eventRefs[type] = app.vault.on(type, async (file, ...args) => {
			await this.processLocalEvent(type, file, args);
		});
	}

	unregisterEvent(type: any) {
		app.vault.offref(this.eventRefs[type])
	}

	async load(internal) {
		if(!this.isEnabled)
			return;

		if(!internal) {
			console.log("AnySocket Sync ("+ this.plugin.VERSION +") - Enabled");
		}

		this.anysocketEnabled = true;
		this.anysocket.removeAllListeners();

		this.registerEvent("create");
		this.registerEvent("modify");
		this.registerEvent("delete");
		this.registerEvent("rename");

		let password = await this.getSHA1(this.anysocket.id.substring(0, 16) +
			this.plugin.settings.password +
			this.anysocket.id.substring(16))

		this.anysocket.authPacket = () => {
			return password;
		}
		this.anysocket.onAuth = (packet) => {
			return true;
		}

		this.anysocket.on("message", async (packet: any) => {
			if(packet.msg.type == "upload") {
				this.anysocket.broadcast({
					type: "upload",
					data: {
						path: packet.msg.path,
						file: await this.xCache.read(packet.msg.path),
						mtime: this.xCache.getFile(packet.msg.path).stat.mtime
					},
				});
			} else if(packet.msg.type == "download") {
				console.log("recv:", packet.msg.data.path, packet.msg.data.mtime);
				await this.xCache.write(packet.msg.data.path, packet.msg.data.file, packet.msg.data.mtime);
			} else if(packet.msg.type == "delete") {
				await this.xCache.delete(packet.msg.path);
			} else if(packet.msg.type == "rename") {
				await this.xCache.rename(packet.msg.data.oldPath, packet.msg.data.newPath);
			}
		});

		this.anysocket.on("e2e", async (peer: any) => {
			this.isAnySocketConnected = true;
			this.getTime = peer.getSyncedTime.bind(peer);
			await this.getTime();

			app.workspace.onLayoutReady(async () => {
				peer.send({
					type: "version",
					version: this.plugin.VERSION,
					build: this.plugin.BUILD
				}, true).then(async packet => {
					if(packet.msg.type == "ok") {
						this.notifyConnectionStatus();
						await this.sync();

					} else if (packet.msg.type == "update") {
						const BASE = ".obsidian/plugins/obsidian-anysocket-sync/";
						for(let item of packet.msg.files) {
							await app.vault.adapter.write(BASE + item.path, item.data);
						}

						window._anysocketID = this.anysocket.id;
						// ignore disconnected message
						this.anysocket.removeAllListeners("disconnected");
						app.plugins.disablePlugin("obsidian-anysocket-sync");
						new Notice("🟡 AnySocket Sync - Updated to version: " + packet.msg.version);
						app.plugins.enablePlugin("obsidian-anysocket-sync");
					} else {
						this.anysocket.removeAllListeners();
						this.unload(true);
						new Notice("🟡 AnySocket Sync - Incompatible client version " + this.plugin.VERSION);
					}
				});
			});
		});
		this.anysocket.on("disconnected", (peer: any) => {
			this.isAnySocketConnected = false;
			this.notifyConnectionStatus();
			this.reload();
		});

		this.anysocketConnect();
	}

	unload(internal) {
		this.anysocketEnabled = false;

		this.unregisterEvent("create");
		this.unregisterEvent("modify");
		this.unregisterEvent("delete");
		this.unregisterEvent("rename");

		this.anysocket.stop();

		this.anysocket.removeAllListeners();

		if(!internal) {
			console.log("AnySocket Sync ("+ this.plugin.VERSION +") - Disabled");
		}
		this.plugin.ribbonIcon.style.color = "red";
	}

	reload() {
		this.unload(true);
		clearTimeout(this.reloadTimeout);
		this.reloadTimeout = setTimeout(() => {
			this.load(true);
		}, 1000);
	}

	notifyConnectionStatus() {
		if(this.isAnySocketConnected) {
			new Notice("🟢 AnySocket Sync - Connected");
			this.plugin.ribbonIcon.style.color = "";
		}
		else {
			new Notice("🔴 AnySocket Sync - Lost connection");
			this.plugin.ribbonIcon.style.color = "red";

			this.reload();
		}
	}
}
