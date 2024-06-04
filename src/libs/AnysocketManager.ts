// @ts-nocheck
import {Notice, Plugin} from "obsidian";
import AnySocketLoader from "./AnySocketLoader";
import Utils from "./Utils";
import XSync from "../XSync";
const EventEmitter = require('events');

export default class AnysocketManager extends EventEmitter {
	plugin: Plugin;
	xSync: XSync;
	eventRefs: any = {};
	anysocket: any;
	isConnected: boolean = false;
	notifiedOfConnectError = false;

	constructor(xSync: XSync) {
		super();
		this.xSync = xSync;
		this.plugin = xSync.plugin;
		AnySocketLoader.load();
		this.anysocket = new AnySocket();

		console.log("AnySocket Sync ("+ this.plugin.VERSION +") - Enabled");
		// console.log("AnySocket Sync ("+ this.plugin.VERSION +") - Disabled");
		// TODO: implement this
		if(app.isMobile) {
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
			this.isConnected = true;
			this.getTime = async () => {
				return Math.round((await peer.getSyncedTime()).time);
			}
			await this.getTime();

			app.workspace.onLayoutReady(async () => {
				this.checkForUpdates(peer);
			});
		});
		this.anysocket.on("disconnected", (peer: any) => {
			this.emit("disconnected");
			this.emit("reload");
		});

		this.connect();
	}

	checkForUpdates(peer) {
		peer.send({
			type: "version",
			version: this.plugin.VERSION,
			build: this.plugin.BUILD
		}, true).then(async packet => {
			if(packet.msg.type == "ok") {
				this.emit("connected");
			} else if (packet.msg.type == "update") {
				await this.xSync.storage.updatePlugin(packet.msg.files);
				window._anysocketID = this.anysocket.id;
				// ignore disconnected message
				this.anysocket.removeAllListeners("disconnected");
				app.plugins.disablePlugin("obsidian-anysocket-sync");
				new Notice("🟡 AnySocket Sync - Updated to version: " + packet.msg.version);
				app.plugins.enablePlugin("obsidian-anysocket-sync");
			} else {

				this.anysocket.removeAllListeners();
				this.emitthis.emit("unload");
				new Notice("🟡 AnySocket Sync - Incompatible client version " + this.plugin.VERSION);
			}
		});
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
			console.log(peer);
			peer.e2e();
			this.notifiedOfConnectError = false;
		}).catch((e) => {
			console.error("AnySocket Connect Error", e);
			this.isConnected = false;
			if(!this.notifiedOfConnectError) {
				this.notifiedOfConnectError = true;
				new Notice("🟡 AnySocket Sync - Could not connect to the server");
			}
			this.emit("reload");
		});
	}

	broadcast(...args) {
		this.anysocket.broadcast(...args);
	}

	stop() {
		this.anysocket.stop();
	}
}
