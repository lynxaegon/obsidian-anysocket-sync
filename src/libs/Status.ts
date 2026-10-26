// @ts-nocheck
import {Notice, Platform, setIcon} from "obsidian";
import EventEmitter from "./Events";
import Utils from "./Utils";

export type State =
	"disabled" | "setup" | "connecting" | "offline" | "auth_failed" | "unreachable" |
	"updating" | "waiting_approval" | "revoked" | "syncing" | "synced" | "paused" | "error";

const LOOK = {
	disabled: { icon: "cloud-off", tone: "muted" },
	setup: { icon: "settings", tone: "warn" },
	connecting: { icon: "refresh-cw", tone: "busy", spin: true },
	offline: { icon: "cloud-off", tone: "error" },
	unreachable: { icon: "cloud-off", tone: "error" },
	auth_failed: { icon: "key", tone: "error" },
	updating: { icon: "download", tone: "busy", spin: false },
	waiting_approval: { icon: "lock", tone: "warn" },
	revoked: { icon: "ban", tone: "error" },
	syncing: { icon: "refresh-cw", tone: "busy", spin: true },
	synced: { icon: "check", tone: "ok" },
	paused: { icon: "pause", tone: "warn" },
	error: { icon: "alert-triangle", tone: "error" }
};

// notification levels (the "Notifications" setting)
export const NOTIFY = { OFF: 0, IMPORTANT: 1, EVERYTHING: 2 };

/**
 * What the plugin is doing, in one place: the status bar, the mobile indicator,
 * the sync panel and the notices all read from here.
 */
export default class Status extends EventEmitter {
	plugin: any;
	state: State = "disabled";
	info: any = {};
	lastSync = 0;
	pending = 0;
	attention = 0;
	statusBarEl: HTMLElement = null;
	iconEl: HTMLElement = null;
	textEl: HTMLElement = null;
	mobileEl: HTMLElement = null;
	tick: any = null;
	recentNotices = new Map<string, number>();

	constructor(plugin) {
		super();
		this.plugin = plugin;
	}

	mount(statusBarEl: HTMLElement, onClick: () => void) {
		this.statusBarEl = statusBarEl;
		statusBarEl.addClass("anysocket-status", "mod-clickable");
		statusBarEl.addEventListener("click", onClick);
		this.iconEl = statusBarEl.createSpan({ cls: "anysocket-status-icon" });
		this.textEl = statusBarEl.createSpan({ cls: "anysocket-status-text" });

		if (Platform.isMobile) {
			const container = document.querySelector(".app-container") || document.body;
			this.mobileEl = container.createDiv({ cls: "anysocket-mobile-indicator" });
			this.mobileEl.addEventListener("click", onClick);
		}

		// keeps "Synced 5 min ago" current
		this.tick = window.setInterval(() => this.render(), 30 * 1000);
		this.render();
	}

	unmount() {
		window.clearInterval(this.tick);
		if (this.mobileEl) {
			this.mobileEl.remove();
			this.mobileEl = null;
		}
	}

	set(state: State, info: any = {}) {
		const previous = this.state;
		this.state = state;
		this.info = info;
		if (state === "synced") {
			this.lastSync = info.at || Date.now();
		}
		if (info.pending !== undefined) {
			this.pending = info.pending;
		}
		this.render();
		this.emit("change", state, previous);
	}

	pendingChanged(count: number) {
		this.pending = count;
		this.render();
		this.emit("change", this.state, this.state);
	}

	attentionChanged(count: number) {
		if (count !== this.attention) {
			this.attention = count;
			this.render();
			this.emit("change", this.state, this.state);
		}
	}

	// a short phrase for the status bar
	shortText() {
		const info = this.info || {};
		switch (this.state) {
			case "disabled": return "Sync off";
			case "setup": return "Set up sync";
			case "connecting": return "Connecting…";
			case "offline":
			case "unreachable": return this.pending > 0 ? "Offline · " + this.pending + " waiting" : "Offline";
			case "auth_failed": return "Wrong password";
			case "updating": return "Updating plugin…";
			case "waiting_approval": return "Waiting for approval";
			case "revoked": return info.declined ? "Request declined" : "Device removed";
			case "syncing": return info.total > 1 ? "Syncing " + Math.min(info.done, info.total) + "/" + info.total : "Syncing…";
			case "synced": {
				const ago = Date.now() - this.lastSync > 60 * 1000 ? " " + Utils.ago(this.lastSync) : "";
				return "Synced" + ago;
			}
			case "paused": return this.pending > 0 ? "Auto sync off · " + this.pending + " waiting" : "Auto sync off";
			case "error": return "Sync problem";
		}
		return "";
	}

	// a full sentence, for tooltips and the sync panel
	sentence() {
		const s = this.plugin.settings;
		const info = this.info || {};
		switch (this.state) {
			case "disabled": return "Sync is turned off. Turn on \"Enable connection\" in the settings to start.";
			case "setup": return "Enter your server's address and password in the settings to start syncing.";
			case "connecting": return "Connecting to " + s.host + ":" + s.port + "…";
			case "offline": return "Connection lost. Your changes are kept and will sync when it's back.";
			case "unreachable": return "Can't reach the server at " + s.host + ":" + s.port + ". Your changes are kept and will sync when it's back.";
			case "auth_failed": return "The server didn't accept the password. Check it in the settings.";
			case "updating": return "Installing the server's version of the plugin…";
			case "waiting_approval": return "This device needs to be approved before it can sync. Approve it from a device that already syncs (AnySocket Sync → Devices), or on the server.";
			case "revoked": return info.declined ?
				"This device's request to sync was declined. It asks again the next time Obsidian starts, or when you change the settings." :
				"This device was removed from sync. Approve it again on the server or from another device to sync again.";
			case "syncing": return info.total > 1 ? "Syncing " + Math.min(info.done, info.total) + " of " + info.total + " changes…" : "Syncing…";
			case "synced": return "Everything is up to date" + (this.lastSync ? " (last synced " + Utils.ago(this.lastSync) + ")" : "") + ".";
			case "paused": return "Auto sync is off. Use \"Sync now\" to sync" + (this.pending > 0 ? " your " + this.pending + " waiting changes" : "") + ".";
			case "error": return "Something went wrong while syncing: " + (info.message || "unknown error") + ". It will try again.";
		}
		return "";
	}

	render() {
		const look = LOOK[this.state] || LOOK.disabled;
		const tone = this.attention > 0 && look.tone === "ok" ? "warn" : look.tone;
		let text = this.shortText();
		if (this.attention > 0) {
			text += " · " + this.attention + " to review";
		}
		const tooltip = this.sentence() + (this.attention > 0 ? "\n" + this.attention + " file(s) were changed on two devices; both versions were kept. Click to review." : "");

		for (const el of [this.statusBarEl, this.mobileEl]) {
			if (!el) continue;
			el.setAttr("data-tone", tone);
			el.setAttr("aria-label", tooltip);
			el.toggleClass("is-spinning", !!look.spin);
		}
		if (this.iconEl) {
			setIcon(this.iconEl, look.icon);
			this.textEl.setText(text);
		}
		if (this.mobileEl) {
			setIcon(this.mobileEl, look.icon);
		}
	}

	// a notice, at a level ("important" or "everything"), never the same one twice a minute
	notify(message: string, level: number = NOTIFY.IMPORTANT, duration?: number) {
		const setting = this.plugin.settings.notifications;
		if (setting < level || setting === NOTIFY.OFF) {
			return null;
		}
		const last = this.recentNotices.get(message) || 0;
		if (Date.now() - last < 60 * 1000) {
			return null;
		}
		this.recentNotices.set(message, Date.now());
		return new Notice("AnySocket Sync: " + message, duration);
	}

	// a notice with buttons; always shown unless notifications are off
	ask(message: string, actions: Array<{ label: string, cta?: boolean, run: () => any }>, duration = 0) {
		if (this.plugin.settings.notifications === NOTIFY.OFF) {
			return null;
		}
		const notice = new Notice("", duration);
		const el = notice.noticeEl;
		el.addClass("anysocket-notice");
		el.createDiv({ text: message, cls: "anysocket-notice-text" });
		const row = el.createDiv({ cls: "anysocket-notice-actions" });
		for (const action of actions) {
			const button = row.createEl("button", { text: action.label, cls: action.cta ? "mod-cta" : "" });
			button.addEventListener("click", (e) => {
				e.stopPropagation();
				notice.hide();
				action.run();
			});
		}
		return notice;
	}
}
