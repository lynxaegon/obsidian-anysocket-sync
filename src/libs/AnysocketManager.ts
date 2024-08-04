// @ts-nocheck
import {Notice, Plugin} from "obsidian";
import Utils from "./Utils";
import XSync from "../XSync";
import EventEmitter from "./Events";
import AnySocket from "anysocket";

export default class AnysocketManager extends EventEmitter {
	plugin: Plugin;
	xSync: XSync;
	eventRefs: any = {};
	anysocket: any;
	isConnected: boolean = false;
	notifiedOfConnectError = false;
	peer = null;

	constructor(xSync: XSync) {
		super();

		this.xSync = xSync;
		this.plugin = xSync.plugin;
		this.anysocket = new AnySocket();

		console.log("AnySocket Sync (" + this.plugin.VERSION + ") - Enabled");
		if (app.isMobile) {
			activeWindow.onblur = () => {
				this.emit("unload");
			};
			activeWindow.onfocus = () => {
				this.emit("reload");
			};
		}
	}

	async getTime() {
		return Date.now();
	}

	async init() {
		this.anysocket.removeAllListeners();

		let password = await Utils.getSHA(this.anysocket.id.substring(0, 16) +
			this.plugin.settings.password +
			this.anysocket.id.substring(16))

		this.anysocket.authPacket = () => {
			return password;
		}
		this.anysocket.onAuth = async (packet) => {
			return await Utils.getSHA(packet.id.substring(0, 16) +
				this.plugin.settings.password +
				packet.id.substring(16)) == packet.auth;
		}

		this.anysocket.on("message", async (packet: any) => {
			this.emit("message", packet);
		});

		this.anysocket.on("e2e", async (peer: any) => {
			this.getTime = async () => {
				return Math.round((await peer.getSyncedTime()).time);
			}
			await this.getTime();

			app.workspace.onLayoutReady(async () => {
				await this.checkForUpdates(peer);
			});
		});
		this.anysocket.on("disconnected", (peer: any) => {
			this.isConnected = false;
			this.peer = null;
			this.emit("disconnected");
			this.emit("reload");
		});

		this.connect();
	}

	async checkForUpdates(peer) {
		let result = await peer.rpc.onVersionCheck(this.plugin.VERSION, this.plugin.BUILD);
		if(result.type == "ok") {
			this.peer = peer;
			this.isConnected = true;
			this.emit("connected", peer);
		} else if (result.type == "update") {
			await this.xSync.storage.updatePlugin(result.files);
			window._anysocketID = this.anysocket.id;
			// ignore disconnected message
			this.anysocket.removeAllListeners("disconnected");
			app.plugins.disablePlugin("anysocket-sync");
			new Notice("🟡 AnySocket Sync - Updated to version: " + result.version);
			app.plugins.enablePlugin("anysocket-sync");
		} else {
			this.anysocket.removeAllListeners();
			this.emit("unload");
			new Notice("🟡 AnySocket Sync - Incompatible client version " + this.plugin.VERSION);
		}
	}

	connect() {
		if(!this.isEnabled) {
			return;
		}

		if(!this.plugin.settings.password) {
			console.log("AnySocket Sync - Requires setup");
			new Notice("🟡 AnySocket Sync - Requires setup");
			this.emit("unload");
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
			this.isConnected = false;
			if(!this.notifiedOfConnectError) {
				this.notifiedOfConnectError = true;
				new Notice("🟡 AnySocket Sync - Could not connect to the server", );
			}
			this.emit("reload");
		});
	}

	async send(packet, onReply) {
		if(!this.peer)
			return;

		if(onReply) {
			packet = await this.peer.send(packet, true);
			onReply(packet);
		}
		else {
			return await this.peer.send(packet);
		}
	}

	stop() {
		this.anysocket.stop();
	}
}
