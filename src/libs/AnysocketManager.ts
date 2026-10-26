// @ts-nocheck
import {Platform, Plugin} from "obsidian";
import Utils from "./Utils";
import XSync from "../XSync";
import {NotifyType} from "./XNotify";
import EventEmitter from "./Events";
import AnySocket from "anysocket/dist/anysocket.browser.js";

const NOTICE_COLOR = "#ffaa00";

// anysocket 1.0 drops a silent peer, ~60s budget (same as the server)
const CONNECT_OPTIONS = {
	heartbeatInterval: 10 * 1000,
	heartbeatsMaxMissed: 5
};

export default class AnysocketManager extends EventEmitter {
	plugin: Plugin;
	xSync: XSync;
	eventRefs: any = {};
	anysocket: any;
	isBackground: boolean = false;
	isConnected: boolean = false;
	isUpdating: boolean = false;
	notifiedOfConnectError = false;
	peer = null;

	constructor(xSync: XSync) {
		super();

		this.xSync = xSync;
		this.plugin = xSync.plugin;
		this.anysocket = this.createAnySocket();

		console.log("AnySocket Sync (" + this.plugin.VERSION + ") - Enabled");
		if (Platform.isMobile) {
			document.addEventListener("visibilitychange", () => {
				this.isBackground = document.hidden;
				if (this.isBackground) {
					this.emit("unload");
				} else {
					this.emit("reload");
				}
			});
		}
	}

	async getTime() {
		return Date.now();
	}

	createAnySocket() {
		return new AnySocket({
			// anysocket 1.0 mutual auth, optional so that servers <= 1.5.x (anysocket 0.4) still work
			auth: {
				secret: this.plugin.settings.password,
				optional: true
			}
		});
	}

	async init() {
		this.anysocket.removeAllListeners();
		this.anysocket.stop().catch(() => {});
		// a fresh instance (and id) per connection, so a reconnect is never
		// refused as a duplicate of a link the server hasn't dropped yet
		this.anysocket = this.createAnySocket();

		// don't connect when in background
		if(this.isBackground) return;

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

			// anysocket 1.0 no longer drops the link when a reply times out,
			// so a failed handshake step disconnects explicitly (and retries)
			try {
				await this.getTime();
			} catch (e) {
				console.error("AnySocket Sync - Time sync failed", e);
				return peer.disconnect("Time sync failed");
			}

			app.workspace.onLayoutReady(async () => {
				try {
					await this.checkForUpdates(peer);
				} catch (e) {
					console.error("AnySocket Sync - Version check failed", e);
					peer.disconnect("Version check failed");
				}
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
		this.isUpdating = false;
		let result = await peer.rpc.onVersionCheck(this.plugin.VERSION, this.plugin.BUILD);
		if(result.type == "ok") {
			this.peer = peer;
			this.isConnected = true;
			this.isUpdating = false;
			this.emit("connected", peer);
		} else if (result.type == "update") {
			this.isUpdating = true;
			await this.xSync.storage.updatePlugin(result.files);
			// ignore disconnected message
			this.anysocket.removeAllListeners("disconnected");
			this.anysocket.stop().catch(() => {});

			app.plugins.disablePlugin("anysocket-sync");
			if(this.plugin.BUILD >= result.build) {
				this.xSync.xNotify.showNotification(NOTICE_COLOR, "Your version is ahead of the server. Downgraded fom " + this.plugin.VERSION + " to " + result.version);
			}
			else {
				this.xSync.xNotify.showNotification(NOTICE_COLOR, "Updated to version: " + result.version);
			}
			app.plugins.enablePlugin("anysocket-sync");
		} else {
			this.anysocket.removeAllListeners();
			this.emit("unload");
			this.xSync.xNotify.showNotification(NOTICE_COLOR, "Incompatible client version " + this.plugin.VERSION);
		}
	}

	connect() {
		if(!this.isEnabled) {
			return;
		}

		if(!this.plugin.settings.password) {
			console.log("AnySocket Sync - Requires setup");
			this.xSync.xNotify.showNotification(NOTICE_COLOR, "AnySocket Sync - Requires setup");
			this.emit("unload");
			return;
		}

		this.anysocket.connect("ws", this.plugin.settings.host, this.plugin.settings.port, CONNECT_OPTIONS).then(async (peer: any) => {
			this.notifiedOfConnectError = false;
			Promise.resolve(peer.e2e()).catch((e) => {
				console.error("AnySocket Sync - Encryption failed", e);
				peer.disconnect("e2e failed");
			});
		}).catch((e) => {
			try {
				console.error("AnySocket Connect Error", e);
				if (!this.notifiedOfConnectError && !this.isUpdating) {
					this.notifiedOfConnectError = true;
					this.xSync.xNotify.notifyStatus(NotifyType.NOT_CONNECTED);
				}
			}
			catch(e) {
				console.log("Error", e);
			}
			this.isConnected = false;
			this.emit("reload");
		});
	}

	async send(packet, onReply) {
		if(!this.peer)
			return;

		if(onReply) {
			try {
				packet = await this.peer.send(packet, true);
			} catch (e) {
				console.error("AnySocket Sync - No reply from server", e);
				this.xSync.xNotify.showNotification(NOTICE_COLOR, "The server did not respond, try again");
				return;
			}
			onReply(packet);
		}
		else {
			return await this.peer.send(packet);
		}
	}

	stop() {
		this.anysocket.stop().catch(() => {});
	}
}
