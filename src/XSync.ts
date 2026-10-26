// @ts-nocheck
import {Platform, Plugin, TAbstractFile} from "obsidian";
import AnysocketManager from "./libs/AnysocketManager";
import Utils from "./libs/Utils";
import Storage from "./libs/fs/Storage";
import XTimeouts from "./libs/XTimeouts";
import Status, {NOTIFY} from "./libs/Status";
import Activity from "./libs/Activity";
import SyncV2, {KEPT_COPY} from "./sync/SyncV2";
import LegacySync from "./sync/LegacySync";

const DEVICE_KEY = "anysocket-sync-device";
const PROTOCOL_KEY = "anysocket-sync-protocol";

/**
 * Ties it together: the connection, the device (and its approval), and the sync engine.
 * A 1.6.0+ server gets SyncV2; a 1.5.x server gets the 1.5.0 sync as it was (LegacySync).
 */
export default class XSync {
	plugin: Plugin;
	isEnabled = false;
	inited = false;
	eventRefs: any = {};
	anysocket: AnysocketManager;
	xTimeouts: XTimeouts;
	storage: Storage;
	status: Status;
	activity: Activity;
	reloadTimeout = null;
	attentionTimeout = null;
	v2: SyncV2;
	legacy: LegacySync;
	engine: any = null;
	protocol = 0;
	server: any = null;
	device: any = null;
	revoked = false;
	pendingNotice: any = null;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.status = new Status(plugin);
		this.activity = new Activity();
		this.storage = new Storage(plugin);
		this.xTimeouts = new XTimeouts();
		this.anysocket = new AnysocketManager(this);
		this.v2 = new SyncV2(this);
		this.legacy = new LegacySync(this);
	}

	get debug() {
		return this.plugin.settings.debug;
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

	// ---- this device ----

	// kept in this device's local storage (not in the vault), so copying a vault never copies it
	getDevice() {
		let device = null;
		try {
			device = JSON.parse(app.loadLocalStorage(DEVICE_KEY) || "null");
		} catch (e) {
			device = null;
		}
		if (!device || !device.id || !device.secret) {
			device = { id: Utils.randomId(16), secret: Utils.randomId(32) };
			app.saveLocalStorage(DEVICE_KEY, JSON.stringify(device));
		}
		return device;
	}

	platform() {
		if (Platform.isIosApp) return "ios";
		if (Platform.isAndroidApp) return "android";
		if (Platform.isMacOS) return "macos";
		if (Platform.isWin) return "windows";
		if (Platform.isLinux) return "linux";
		return Platform.isMobile ? "mobile" : "desktop";
	}

	// the protocol of the last server we talked to, so changes made offline are tracked the same way
	get lastProtocol() {
		return parseInt(app.loadLocalStorage(PROTOCOL_KEY) || "0") || 0;
	}

	set lastProtocol(value) {
		app.saveLocalStorage(PROTOCOL_KEY, String(value));
	}

	// ---- lifecycle ----

	async load() {
		if (!this.isEnabled || this.inited) {
			return;
		}
		this.inited = true;

		this.anysocket.isEnabled = this.plugin.settings.syncEnabled;
		await this.storage.init();
		if (this.lastProtocol >= 2) {
			await this.v2.index.load();
		}

		this.registerEvent("create");
		this.registerEvent("modify");
		this.registerEvent("delete");
		this.registerEvent("rename");

		let focusChanged = Utils.debounce(() => this.xTimeouts.executeAll(), 500);
		this.eventRefs["active-leaf-change"] = app.workspace.on('active-leaf-change', focusChanged);
		this.eventRefs["layout-change"] = app.workspace.on('layout-change', focusChanged);

		this.anysocket.on("ready", (peer, version) => this.onReady(peer, version).catch(e => {
			console.error("AnySocket Sync - start failed", e);
			peer.disconnect("start failed");
		}));
		this.anysocket.on("message", (packet) => this.onMessage(packet));
		this.anysocket.on("failed", (reason) => this.status.set(reason, { pending: this.pendingCount() }));
		this.anysocket.on("disconnected", (reason, wasConnected) => this.onDisconnected(reason, wasConnected));
		this.anysocket.on("reload", this.reload.bind(this));
		this.anysocket.on("unload", this.unload.bind(this));

		this.updateAttention();
		this.showUpdateNotice();

		if (!this.plugin.settings.syncEnabled) {
			this.status.set("disabled");
			return;
		}
		if (this.revoked) {
			this.status.set("revoked");
			return;
		}
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

		this.stopEngine();
		this.anysocket.stop();
		this.anysocket.removeAllListeners();
		if (this.v2.index.loaded) {
			this.v2.index.save();
		}
	}

	reload(delay?: number) {
		this.debug && console.log("reloaded");
		this.unload();
		clearTimeout(this.reloadTimeout);
		this.reloadTimeout = setTimeout(() => {
			this.load();
		}, delay === undefined ? this.anysocket.nextDelay() : delay);
	}

	destroy() {
		this.unload();
		this.anysocket.destroy();
		this.status.unmount();
	}

	// mobile: the app went to the background, or came back
	onBackground(hidden: boolean) {
		if (hidden) {
			this.unload();
		} else if (this.isEnabled) {
			this.reload(0);
		}
	}

	stopEngine() {
		if (this.engine) {
			this.engine.stop();
		}
		this.engine = null;
		this.xTimeouts.clearAll();
	}

	// ---- connection ----

	async onReady(peer, version) {
		this.server = { version: version.server || null, protocol: version.protocol || 1 };

		let hello = null;
		try {
			const device = this.getDevice();
			hello = await peer.rpc.hello({
				id: device.id,
				secret: device.secret,
				name: this.plugin.settings.deviceName || "Unknown device",
				platform: this.platform(),
				autoSync: this.plugin.settings.autoSync
			});
		} catch (e) {
			// a 1.5.x server doesn't know hello: sync the way 1.5.0 did
			if (!isMissingMethod(e)) {
				throw e;
			}
		}

		if (!hello) {
			this.protocol = 1;
			this.lastProtocol = 1;
			this.status.notify("connected", NOTIFY.EVERYTHING);
			this.engine = this.legacy;
			return this.legacy.start(peer);
		}

		this.protocol = hello.protocol || 2;
		this.lastProtocol = this.protocol;
		this.device = hello.device;
		if (hello.error) {
			this.status.set("error", { message: hello.error });
			return;
		}

		switch (hello.device.status) {
			case "approved":
				this.revoked = false;
				this.hidePendingNotice();
				this.status.notify("connected", NOTIFY.EVERYTHING);
				this.engine = this.v2;
				await this.v2.start(peer, hello);
				this.checkDeviceRequests();
				break;
			case "pending":
				this.status.set("waiting_approval");
				this.showPendingNotice();
				break;
			case "revoked":
				this.onRevoked();
				break;
		}
	}

	onDisconnected(reason, wasConnected) {
		this.stopEngine();
		if (this.revoked) {
			return;
		}
		if (wasConnected && this.status.state !== "updating") {
			this.status.set("offline", { pending: this.pendingCount() });
		}
	}

	onRevoked() {
		this.revoked = true;
		this.stopEngine();
		this.hidePendingNotice();
		this.status.set("revoked");
		this.status.notify("this device was removed from sync. Approve it again from another device or on the server to sync again.");
		// no reconnect loop; it tries again when the settings change or Obsidian restarts
		clearTimeout(this.reloadTimeout);
		this.anysocket.stop();
	}

	pendingCount() {
		if (this.lastProtocol >= 2 && this.v2.index.loaded) {
			return this.v2.pendingCount();
		}
		return Object.keys(this.legacy.unsentSessionEvents).length + Object.keys(this.legacy.deleteQueue).length;
	}

	onMessage(packet) {
		if (!packet.msg) {
			return;
		}
		switch (packet.msg.type) {
			case "changed":
				if (this.engine === this.v2) {
					this.v2.onRemoteChanged(packet.msg);
				}
				break;
			case "device_request":
				this.onDeviceRequest(packet.msg.device);
				break;
			case "devices_changed":
				this.status.emit("devices");
				break;
			case "device_status":
				if (packet.msg.status === "approved" && !this.engine) {
					this.status.notify("this device was approved, syncing now");
					this.reload(0);
				} else if (packet.msg.status === "revoked") {
					this.onRevoked();
				}
				break;
			default:
				if (this.engine === this.legacy) {
					this.legacy.onMessage(packet);
				}
		}
	}

	// ---- devices ----

	showPendingNotice() {
		if (this.pendingNotice) {
			return;
		}
		const name = this.plugin.settings.deviceName;
		this.pendingNotice = this.status.ask(
			"\"" + name + "\" is waiting to be approved.\n\nOn a device that already syncs, open AnySocket Sync and approve it, or run on the server:\nnode cli.js devices approve \"" + name + "\"",
			[{ label: "OK", run: () => {} }]
		);
	}

	hidePendingNotice() {
		if (this.pendingNotice) {
			this.pendingNotice.hide();
			this.pendingNotice = null;
		}
	}

	onDeviceRequest(device) {
		this.status.emit("devices");
		if (!device) {
			return;
		}
		this.status.ask(
			"\"" + device.name + "\" wants to sync with this vault. Is this your device?",
			[
				{ label: "Approve", cta: true, run: () => this.approveDevice(device.id) },
				{ label: "Decline", run: () => this.declineDevice(device.id) },
				{ label: "Later", run: () => {} }
			]
		);
	}

	// devices waiting while we were away
	async checkDeviceRequests() {
		try {
			const devices = await this.v2.listDevices();
			for (const device of devices.filter(d => d.status === "pending" && d.online)) {
				this.onDeviceRequest(device);
			}
		} catch (e) {
			// not important enough to fail anything
		}
	}

	async listDevices() {
		this.assertV2();
		return await this.v2.listDevices();
	}

	async approveDevice(id) {
		this.assertV2();
		const device = await this.v2.approveDevice(id);
		this.status.notify("approved \"" + device.name + "\"");
		this.status.emit("devices");
		return device;
	}

	async declineDevice(id) {
		this.assertV2();
		const device = await this.v2.declineDevice(id);
		this.status.emit("devices");
		return device;
	}

	async revokeDevice(id) {
		this.assertV2();
		const device = await this.v2.revokeDevice(id);
		this.status.emit("devices");
		return device;
	}

	assertV2() {
		if (this.engine !== this.v2) {
			throw new Error(this.protocol === 1 ? "Device management needs the 1.6.0 server" : "Not connected");
		}
	}

	// ---- sync ----

	connectionOK() {
		if (!this.isEnabled || !this.plugin.settings.syncEnabled) {
			this.status.notify("sync is turned off in the settings");
			return false;
		}
		if (!this.engine) {
			this.status.notify(this.status.sentence());
			return false;
		}
		return true;
	}

	async sync(full = false) {
		if (!this.connectionOK()) {
			return;
		}
		if (this.engine === this.v2) {
			return this.v2.syncNow(full);
		}
		return this.legacy.syncNow();
	}

	registerEvent(type: any) {
		this.eventRefs[type] = app.vault.on(type, async (file, ...args) => {
			if (!this.isEnabled)
				return;

			if (type !== "modify") {
				this.updateAttention();
			}
			try {
				if (this.engine) {
					await this.engine.onLocalEvent(type, file, type === "rename" ? args[0] : args);
				} else if (this.lastProtocol >= 2) {
					// offline: remember the change (renames too) for the next sync
					if (this.v2.index.loaded) {
						await this.v2.onLocalEvent(type, file, type === "rename" ? args[0] : args);
					}
				} else {
					await this.legacy.onLocalEvent(type, file, args);
				}
			} catch (e) {
				console.error("AnySocket Sync - local change", file && file.path, e);
			}
		});
	}

	unregisterEvent(type: any) {
		app.vault.offref(this.eventRefs[type])
	}

	// ---- history ----

	historyEngine() {
		if (!this.connectionOK()) {
			return null;
		}
		return this.engine;
	}

	// ---- both versions kept / restored ----

	updateAttention() {
		clearTimeout(this.attentionTimeout);
		this.attentionTimeout = setTimeout(() => {
			this.status.attentionChanged(this.keptCopies().length);
		}, 300);
	}

	keptCopies() {
		return app.vault.getFiles().filter(f => KEPT_COPY.test(f.name)).map(f => f.path);
	}

	onKeptBoth(path, copy) {
		const name = path.split("/").pop();
		this.updateAttention();
		this.status.ask(
			"\"" + name + "\" was changed on two devices at the same time. Both versions were kept, nothing was lost.",
			[
				{ label: "Review", cta: true, run: () => this.plugin.openSyncPanel() },
				{ label: "OK", run: () => {} }
			],
			15000
		);
	}

	onRestored(path) {
		this.status.notify("\"" + path.split("/").pop() + "\" was changed on another device, so it was kept instead of deleted.");
	}

	showUpdateNotice() {
		const raw = window.localStorage.getItem("anysocket-sync-updated");
		if (!raw) {
			return;
		}
		window.localStorage.removeItem("anysocket-sync-updated");
		try {
			const update = JSON.parse(raw);
			if (update.to === this.plugin.VERSION) {
				this.status.notify(update.downgrade ?
					"your server runs version " + update.to + ", so this device switched to it (from " + update.from + ")" :
					"updated to version " + update.to);
			}
		} catch (e) {
			// ignore
		}
	}

	makeStatusBarItem(statusbar: any) {
		this.status.mount(statusbar, () => this.plugin.openSyncPanel());
	}
}

function isMissingMethod(e) {
	return !!e && (e.code === "ENOMETHOD" || e.status === 404 || e.code === 404);
}
