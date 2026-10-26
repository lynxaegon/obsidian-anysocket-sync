// @ts-nocheck
import {Modal, Notice, setIcon, TFile} from "obsidian";
import Utils from "../Utils";
import Activity from "../Activity";
import {KEPT_COPY} from "../../sync/SyncV2";

// "Note (iPhone's version, Oct 26).md" -> "Note.md"
function originalOf(copy: string) {
	return copy.replace(/ \(.+'s version, [A-Z][a-z]{2} \d{1,2}( \d+)?\)(\.[^./]+)?$/, "$2");
}

/**
 * Everything about sync in one place: what it is doing, what needs a look,
 * the devices that sync this vault, and what happened recently.
 */
export class SyncPanelModal extends Modal {
	plugin: any;
	refresh: any;
	devicesEl: HTMLElement;
	devices: any[] = null;
	devicesError: string = null;

	constructor(plugin) {
		super(app);
		this.plugin = plugin;
		this.refresh = Utils.debounce(() => this.render(), 150);
		this.onDevices = () => this.loadDevices();
	}

	get xSync() {
		return this.plugin.xSync;
	}

	onOpen() {
		this.modalEl.addClass("anysocket-panel");
		this.titleEl.setText("AnySocket Sync");
		this.xSync.status.on("change", this.refresh);
		this.xSync.status.on("devices", this.onDevices);
		this.xSync.activity.on("change", this.refresh);
		this.render();
		this.loadDevices();
	}

	cleanup() {
		this.xSync.status.off("change", this.refresh);
		this.xSync.status.off("devices", this.onDevices);
		this.xSync.activity.off("change", this.refresh);
	}

	async loadDevices() {
		if (this.xSync.protocol < 2 || !this.xSync.engine) {
			this.devices = null;
			this.devicesError = this.xSync.protocol === 1 ?
				"Update your server to 1.6.0 to manage devices." :
				"Connect to see your devices.";
			return this.render();
		}
		try {
			this.devices = await this.xSync.listDevices();
			this.devicesError = null;
		} catch (e) {
			this.devices = null;
			this.devicesError = "Couldn't load devices: " + (e.message || e.error || e);
		}
		this.render();
	}

	render() {
		const el = this.contentEl;
		el.empty();
		const status = this.xSync.status;

		// ---- status ----
		const head = el.createDiv({ cls: "anysocket-panel-status" });
		head.setAttr("data-tone", status.statusBarEl ? status.statusBarEl.getAttr("data-tone") : "");
		const icon = head.createDiv({ cls: "anysocket-panel-status-icon" });
		setIcon(icon, { synced: "check-circle", syncing: "refresh-cw", connecting: "refresh-cw" }[status.state] || "info");
		const text = head.createDiv({ cls: "anysocket-panel-status-text" });
		text.createDiv({ cls: "anysocket-panel-status-title", text: status.shortText() });
		text.createDiv({ cls: "anysocket-panel-status-desc", text: status.sentence() });
		const actions = head.createDiv({ cls: "anysocket-panel-status-actions" });
		if (this.xSync.engine) {
			actions.createEl("button", { text: "Sync now", cls: "mod-cta" }).addEventListener("click", () => this.xSync.sync());
		} else {
			actions.createEl("button", { text: "Settings" }).addEventListener("click", () => {
				this.close();
				app.setting.open();
				app.setting.openTabById("anysocket-sync");
			});
		}

		// ---- needs attention ----
		const copies = this.xSync.keptCopies();
		if (copies.length > 0) {
			this.section(el, "Needs your attention", "alert-triangle");
			const list = el.createDiv({ cls: "anysocket-panel-list" });
			for (const copy of copies) {
				const original = originalOf(copy);
				const row = list.createDiv({ cls: "anysocket-panel-item is-attention" });
				const body = row.createDiv({ cls: "anysocket-panel-item-body" });
				body.createDiv({ text: original.split("/").pop() + " was changed on two devices", cls: "anysocket-panel-item-title" });
				body.createDiv({
					text: "Both versions were kept. The other one is \"" + copy.split("/").pop() + "\". Look at both, keep what you need, then remove the extra copy.",
					cls: "anysocket-panel-item-desc"
				});
				const buttons = row.createDiv({ cls: "anysocket-panel-item-actions" });
				buttons.createEl("button", { text: "Open both" }).addEventListener("click", () => this.openBoth(original, copy));
				buttons.createEl("button", { text: "Done, remove the copy" }).addEventListener("click", async () => {
					const file = app.vault.getAbstractFileByPath(copy);
					if (file) {
						await app.fileManager.trashFile(file);
						new Notice("Removed \"" + copy.split("/").pop() + "\"");
					}
					this.render();
				});
			}
		}

		// ---- too large for this device ----
		const skipped = this.xSync.v2.skipped;
		if (skipped.size > 0) {
			this.section(el, "Not synced on this device", "file-x");
			const list = el.createDiv({ cls: "anysocket-panel-list" });
			const limit = this.plugin.settings.maxFileSize;
			const row = list.createDiv({ cls: "anysocket-panel-item" });
			const body = row.createDiv({ cls: "anysocket-panel-item-body" });
			body.createDiv({
				cls: "anysocket-panel-item-title",
				text: skipped.size + (skipped.size === 1 ? " file is" : " files are") + " larger than " + (limit >= 1000 ? (limit / 1000) + " GB" : limit + " MB")
			});
			const names = [...skipped.entries()].slice(0, 5).map(([p, size]) => p.split("/").pop() + " (" + Math.round(size / 1048576) + " MB)");
			body.createDiv({
				cls: "anysocket-panel-item-desc",
				text: names.join(", ") + (skipped.size > 5 ? ", …" : "") + ". They stay on the devices that have them. Change \"Largest file to sync\" in the settings to include them."
			});
		}

		// ---- devices ----
		this.section(el, "Devices", "monitor-smartphone");
		const devicesEl = el.createDiv({ cls: "anysocket-panel-list" });
		if (this.devicesError) {
			devicesEl.createDiv({ cls: "anysocket-panel-empty", text: this.devicesError });
		} else if (!this.devices) {
			devicesEl.createDiv({ cls: "anysocket-panel-empty", text: "Loading…" });
		} else {
			const order = { pending: 0, approved: 1, revoked: 2 };
			const devices = this.devices.slice().sort((a, b) => order[a.status] - order[b.status] || (b.last_online || 0) - (a.last_online || 0));
			for (const device of devices) {
				this.renderDevice(devicesEl, device);
			}
		}

		// ---- activity ----
		this.section(el, "Recent activity", "history");
		const activityEl = el.createDiv({ cls: "anysocket-panel-list is-compact" });
		const items = this.xSync.activity.items.slice(0, 20);
		if (items.length === 0) {
			activityEl.createDiv({ cls: "anysocket-panel-empty", text: "Nothing yet in this session." });
		}
		for (const item of items) {
			const described = Activity.describe(item);
			const row = activityEl.createDiv({ cls: "anysocket-panel-activity" + (item.type === "failed" || item.type === "kept_both" ? " is-warn" : "") });
			setIcon(row.createSpan({ cls: "anysocket-panel-activity-icon" }), described.icon);
			const label = row.createSpan({ cls: "anysocket-panel-activity-text", text: described.text });
			label.setAttr("aria-label", item.path);
			row.createSpan({ cls: "anysocket-panel-activity-time", text: Utils.ago(item.at) });
			if (app.vault.getAbstractFileByPath(item.path) instanceof TFile) {
				row.addClass("is-clickable");
				row.addEventListener("click", () => {
					this.close();
					app.workspace.openLinkText(item.path, "", false);
				});
			}
		}

		// ---- about ----
		const about = el.createDiv({ cls: "anysocket-panel-about" });
		const settings = this.plugin.settings;
		const parts = ["This device: " + settings.deviceName, "Server: " + settings.host + ":" + settings.port];
		if (this.xSync.server && this.xSync.server.version) {
			parts.push("server version " + this.xSync.server.version);
		}
		const peer = this.xSync.anysocket.peer;
		const info = peer && peer.e2eInfo && peer.e2eInfo();
		if (info && info.cipher) {
			parts.push("encrypted (" + info.cipher.toUpperCase() + ")");
		}
		parts.push("plugin " + this.plugin.VERSION);
		about.setText(parts.join(" · "));
	}

	section(el: HTMLElement, title: string, icon: string) {
		const header = el.createDiv({ cls: "anysocket-panel-section" });
		setIcon(header.createSpan(), icon);
		header.createSpan({ text: title });
	}

	renderDevice(el: HTMLElement, device) {
		const isMe = this.xSync.device && device.id === this.xSync.device.id;
		const row = el.createDiv({ cls: "anysocket-panel-item" + (device.status === "pending" ? " is-attention" : "") + (device.status === "revoked" ? " is-muted" : "") });
		const iconEl = row.createDiv({ cls: "anysocket-panel-item-icon" });
		setIcon(iconEl, ["ios", "android", "mobile"].indexOf(device.platform) !== -1 ? "smartphone" : "monitor");

		const body = row.createDiv({ cls: "anysocket-panel-item-body" });
		body.createDiv({ cls: "anysocket-panel-item-title", text: device.name + (isMe ? " (this device)" : "") });
		let desc = "";
		if (device.status === "pending") {
			desc = "Wants to sync with this vault. Approve it only if it's your device.";
		} else if (device.status === "revoked") {
			desc = "Removed, can't sync";
		} else {
			desc = device.online ? "Online" : "Last seen " + (Utils.ago(device.last_online) || "never");
		}
		body.createDiv({ cls: "anysocket-panel-item-desc", text: desc });

		const buttons = row.createDiv({ cls: "anysocket-panel-item-actions" });
		const act = (label: string, cta: boolean, fn: () => Promise<any>, confirm?: string) => {
			const button = buttons.createEl("button", { text: label, cls: cta ? "mod-cta" : "" });
			button.addEventListener("click", async () => {
				if (confirm && button.getAttr("data-confirm") !== "1") {
					button.setAttr("data-confirm", "1");
					button.setText(confirm);
					button.addClass("mod-warning");
					return;
				}
				button.setDisabled(true);
				try {
					await fn();
				} catch (e) {
					new Notice("AnySocket Sync: " + (e.message || e.error || e));
				}
				await this.loadDevices();
			});
		};
		if (device.status === "pending") {
			act("Approve", true, () => this.xSync.approveDevice(device.id));
			act("Decline", false, () => this.xSync.declineDevice(device.id));
		} else if (device.status === "revoked") {
			act("Approve again", false, () => this.xSync.approveDevice(device.id));
		} else if (!isMe) {
			act("Remove", false, () => this.xSync.revokeDevice(device.id), "Really remove?");
		}
	}

	async openBoth(original: string, copy: string) {
		this.close();
		const first = app.vault.getAbstractFileByPath(original);
		const second = app.vault.getAbstractFileByPath(copy);
		if (first instanceof TFile) {
			await app.workspace.getLeaf("tab").openFile(first);
		}
		if (second instanceof TFile) {
			await app.workspace.getLeaf("split").openFile(second);
		}
	}
}

export { KEPT_COPY };
