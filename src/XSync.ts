import {
	App,
	TAbstractFile,
	Plugin, TFile,
} from "obsidian";
import * as crypto from "crypto";
import AnySocketLoader from "./libs/AnySocketLoader";
import XCache from "./libs/cache";

// TODO: On Plugin Enabled or on AnySocket ip change, force a check, events registered won't run automatically
export default class XSync {
	plugin: Plugin;
	eventRefs: any = {};
	anysocket: any;
	anysocketEnabled: boolean = true;
	xCache: XCache = new XCache();

	constructor(plugin: Plugin) {
		console.log("welcome to anysocket sync")
		this.plugin = plugin;
		AnySocketLoader.load();

		// @ts-ignore
		this.anysocket = new AnySocket();
		this.anysocket.authPacket = () => {
			return "asd";
		}

		this.anysocket.on("e2e", async (peer: any) => {
			// @ts-ignore
			this.getTime = peer.getSyncedTime.bind(peer);
			await this.getTime();

			if(app.workspace.layoutReady) {
				await this.init();
			} else {
				app.workspace.on("layout-ready", this.init.bind(this));
			}
		});
		this.anysocket.on("disconnected", (peer: any) => {
			console.log("disconnected");
			this.anysocketRetry();
		});
	}

	async getTime() {
		// replaced on connect
	}

	anysocketConnect() {
		if(!this.anysocketEnabled) {
			return;
		}

		console.log("trying to connect...");
		this.anysocket.connect("ws", "10.10.0.17",3000).then(async (peer: any) => {
			peer.e2e();
		}).catch(() => {
			console.log("couldn't connect");
			this.anysocketRetry();
		});
	}

	anysocketRetry() {
		console.log("retrying in 1s");
		setTimeout(this.anysocketConnect.bind(this), 1000);
	}

	getSHA1(data: any) {
		if(!data)
			return null;

		let sha = crypto.createHash('sha1');
		sha.update(data)
		return sha.digest('hex');
	}

	async init() {
		// @ts-ignore
		let data: any = [];
		await this.xCache.iterateFiles(async (item: TFile) => {
			data.push({
				folder: !!item.children,
				path: item.path,
				mtime: item.stat?.mtime,
				sha1: this.getSHA1(await this.xCache.read(item.path))
			});
		});
		this.anysocket.broadcast({
			type: "init",
			data: data
		});
	}

	async process(type: string, file: TAbstractFile, args: any) {
		let path = file.path;

		// @ts-ignore
		try {
			// modify supports mtime
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
			console.log(e);
		}
	}

	registerEvent(type: any) {
		this.eventRefs[type] = app.vault.on(type, async (file, ...args) => {
			await this.process(type, file, args);
		});
	}

	unregisterEvent(type: any) {
		app.vault.offref(this.eventRefs[type])
	}

	load() {
		this.anysocketEnabled = true;

		this.registerEvent("create");
		this.registerEvent("modify");
		this.registerEvent("delete");
		this.registerEvent("rename");

		app.workspace.on("file-open", this.onFileOpen.bind(this));
		this.anysocket.on("message", async (packet: any) => {
			console.log(packet.msg);
			if(packet.msg.type == "upload") {
				this.anysocket.broadcast({
					type: "upload",
					data: {
						path: packet.msg.path,
						file: await this.xCache.read(packet.msg.path),
						// @ts-ignore
						mtime: this.xCache.getFile(packet.msg.path).stat.mtime
					},
				});
			} else if(packet.msg.type == "download") {
				console.log("recv:", packet.msg.data.path, packet.msg.data.mtime);
				this.xCache.write(packet.msg.data.path, packet.msg.data.file, packet.msg.data.mtime);
			} else if(packet.msg.type == "delete") {
				this.xCache.delete(packet.msg.path);
			}
		});

		this.anysocketConnect();
	}

	onFileOpen(file: TFile) {
		console.log("file-open", file);
	}

	unload() {
		this.anysocketEnabled = false;

		this.unregisterEvent("create");
		this.unregisterEvent("modify");
		this.unregisterEvent("delete");
		this.unregisterEvent("rename");

		this.anysocket.stop();
	}
}
