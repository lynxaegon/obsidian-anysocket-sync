// @ts-nocheck
import {Platform, Plugin} from "obsidian";
import Utils from "./Utils";
import XSync from "../XSync";
import EventEmitter from "./Events";
import AnySocket from "anysocket/dist/anysocket.browser.js";

// anysocket 1.0 drops a silent peer, ~60s budget (same as the server)
// (no connectTimeout: anysocket 1.0.1 hands it to the browser's WebSocket as a subprotocol,
// which refuses to connect at all; the browser times out a dial on its own)
const CONNECT_OPTIONS = {
	heartbeatInterval: 10 * 1000,
	heartbeatsMaxMissed: 5
};

// waits between reconnects, so a server that is down does not drain a phone's battery
const BACKOFF = [1000, 2000, 5000, 10000, 30000];

/**
 * The connection: connect, encrypt, check the plugin version (the server may hand us
 * another version of the plugin), then "ready". Everything after that is the sync engine's.
 *
 * events: "ready" (peer, versionCheck), "failed" (reason), "disconnected" (reason), "reload"
 */
export default class AnysocketManager extends EventEmitter {
	plugin: Plugin;
	xSync: XSync;
	anysocket: any;
	isBackground: boolean = false;
	isConnected: boolean = false;
	isUpdating: boolean = false;
	isEnabled: boolean = false;
	peer = null;
	attempts = 0;
	refusals = 0;
	lastFailure: string = null;

	constructor(xSync: XSync) {
		super();

		this.xSync = xSync;
		this.plugin = xSync.plugin;
		this.anysocket = this.createAnySocket();

		console.log("AnySocket Sync (" + this.plugin.VERSION + ") - Enabled");
		if (Platform.isMobile) {
			// called directly rather than through this emitter, whose listeners
			// "unload" removes
			this.onVisibility = () => {
				this.isBackground = document.hidden;
				if (!this.isBackground) {
					this.attempts = 0;
				}
				this.xSync.onBackground(this.isBackground);
			};
			document.addEventListener("visibilitychange", this.onVisibility);
		}
	}

	destroy() {
		if (this.onVisibility) {
			document.removeEventListener("visibilitychange", this.onVisibility);
		}
		this.removeAllListeners();
		this.stop();
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

	async getTime() {
		return Date.now();
	}

	// how long to wait before the next reconnect
	nextDelay() {
		return BACKOFF[Math.min(this.attempts, BACKOFF.length - 1)];
	}

	async init() {
		this.anysocket.removeAllListeners();
		this.anysocket.stop().catch(() => {});
		// a fresh instance (and id) per connection, so a reconnect is never
		// refused as a duplicate of a link the server hasn't dropped yet
		this.anysocket = this.createAnySocket();
		this.getTime = async () => Date.now();

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
		this.anysocket.on("disconnected", (peer: any, reason: any) => {
			const wasConnected = this.isConnected;
			this.isConnected = false;
			this.peer = null;
			this.emit("disconnected", reason, wasConnected);
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
			this.attempts = 0;
			this.refusals = 0;
			this.lastFailure = null;
			this.emit("ready", peer, result);
		} else if (result.type == "update") {
			this.isUpdating = true;
			this.xSync.status.set("updating");
			await this.xSync.storage.updatePlugin(result.files);
			// ignore disconnected message
			this.anysocket.removeAllListeners("disconnected");
			this.anysocket.stop().catch(() => {});

			const downgrade = this.plugin.BUILD >= result.build;
			// shown by the new version too, so remember it across the reload
			window.localStorage.setItem("anysocket-sync-updated", JSON.stringify({
				from: this.plugin.VERSION,
				to: result.version,
				downgrade
			}));
			app.plugins.disablePlugin("anysocket-sync");
			this.xSync.status.notify(downgrade ?
				"your server runs an older version, switched from " + this.plugin.VERSION + " to " + result.version :
				"updated to version " + result.version);
			app.plugins.enablePlugin("anysocket-sync");
		} else {
			this.anysocket.removeAllListeners();
			this.emit("unload");
			this.xSync.status.set("error", { message: "this plugin version (" + this.plugin.VERSION + ") doesn't work with the server" });
		}
	}

	connect() {
		if(!this.isEnabled) {
			return;
		}

		if(!this.plugin.settings.password || !this.plugin.settings.host) {
			console.log("AnySocket Sync - Requires setup");
			this.xSync.status.set("setup");
			this.emit("unload");
			return;
		}

		this.xSync.status.set("connecting");
		this.anysocket.connect("ws", this.plugin.settings.host, this.plugin.settings.port, CONNECT_OPTIONS).then(async (peer: any) => {
			Promise.resolve(peer.e2e()).catch((e) => {
				console.error("AnySocket Sync - Encryption failed", e);
				peer.disconnect("e2e failed");
			});
		}).catch((e) => {
			console.error("AnySocket Sync - Connect error", e);
			this.attempts++;
			this.isConnected = false;
			if (!this.isUpdating) {
				// a proxy whose backend is down closes the same way once; a wrong password does it every time
				this.refusals = AnysocketManager.classify(e) === "auth_failed" ? this.refusals + 1 : 0;
				this.lastFailure = this.refusals >= 2 ? "auth_failed" : "unreachable";
				this.emit("failed", this.lastFailure);
			}
			this.emit("reload");
		});
	}

	// why a connection attempt failed: the server closed it while we authenticated
	// (the password), or we never reached it
	static classify(e) {
		if (e && e.code === "ECONNFAILED") {
			return "auth_failed";
		}
		return "unreachable";
	}

	// a message, and its reply (legacy protocol)
	request(packet) {
		if (!this.peer) {
			return Promise.reject(new Error("Not connected"));
		}
		return this.peer.send(packet, true).then(reply => reply.msg);
	}

	async send(packet, onReply) {
		if(!this.peer)
			return;

		if(onReply) {
			try {
				packet = await this.peer.send(packet, true);
			} catch (e) {
				console.error("AnySocket Sync - No reply from server", e);
				this.xSync.status.notify("the server did not respond, try again");
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
