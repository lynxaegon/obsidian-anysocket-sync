// @ts-nocheck
import {Notice, Platform} from "obsidian";

const STATUS_OK = "#339933";
const STATUS_SYNC = "#9900ff";
const STATUS_WARN = "#ffaa00";
const STATUS_ERROR = "#cc0000";

export const NotifyType = {
	PLUGIN_DISABLED: "Disabled",
	NOT_CONNECTED: "Not connected",
	SYNCING: "Syncing...",
	SYNC_COMPLETED: "Sync completed",
	AUTO_SYNC_DISABLED: "Auto Sync disabled",
	CONNECTION_LOST: "Connection lost",
	CONNECTED: "Connected"
}

export default class XNotify {
	xSync: any;
	statusBarItem: any = null;
	statusBarIcon: any = null;
	statusBarMessage: any = null;
	timeoutStatusMessage: any = null;
	mobileIndicator: any = null;
	mobileIndicatorIcon: any = null;

	current: any = null;
	lastNotificationType: string | null = null;
	pendingNotificationTimeout: any = null;

	constructor(xSync: any) {
		this.xSync = xSync;
	}

	makeStatusBarItem(statusbar: any) {
		this.statusBarItem = statusbar;
		let container = this.statusBarItem.createEl('span');
		container.style.verticalAlign = "middle";
		container.style.display = "inline-flex";
		container.style.alignItems = "center";

		this.statusBarIcon = container.createEl('span');
		this.statusBarIcon.style.paddingRight = "4px";
		this.statusBarIcon.style.color = STATUS_ERROR;
		this.statusBarIcon.innerHTML = this.xSync.plugin.getSVGIcon();
		this.statusBarMessage = container.createEl('span');

		if(Platform.isMobile) {
			this.mobileIndicator = document.querySelector(".app-container").createEl('div');
			this.mobileIndicator.addClass('anysocket-mobile-indicator');
			this.mobileIndicatorIcon = this.mobileIndicator.createEl('span');
			this.mobileIndicatorIcon.style.color = STATUS_ERROR;
			this.mobileIndicatorIcon.innerHTML = this.xSync.plugin.getSVGIcon();
		}
	}

	setStatusMessage(message: string, keep: boolean = false) {
		if (!this.statusBarMessage) return;
		
		this.statusBarMessage.innerText = message;

		clearTimeout(this.timeoutStatusMessage);
		if (!keep) {
			this.timeoutStatusMessage = setTimeout(() => {
				this.statusBarMessage.innerText = "";
			}, 2000);
		}
	}

	makeNotice(color: string, text: string) {
		if(this.lastNotificationType == text && this.pendingNotificationTimeout != null)
			return;

		this.showNotification(color, text, 2000);
	}

	public showNotification(color: string, text: string, delay: number = 0) {
		this.lastNotificationType = text;
		clearTimeout(this.pendingNotificationTimeout);
		this.pendingNotificationTimeout = setTimeout(() => {
			let notice = (new Notice()).noticeEl;
			let container = notice.createEl('span');
			container.style.verticalAlign = "middle";
			container.style.display = "inline-flex";
			container.style.alignItems = "center";

			let icon = container.createEl('span');
			icon.style.paddingRight = "4px";
			icon.style.color = color;
			icon.innerHTML = this.xSync.plugin.getSVGIcon();
			container.createEl('span', {text: text});

			this.pendingNotificationTimeout = null;
		}, delay);
	}

	notifyStatus(type: string) {
		const notifications = this.xSync.plugin.settings.notifications;

		switch (type) {
			case NotifyType.PLUGIN_DISABLED:
				if (notifications > 0) {
					this.makeNotice(STATUS_ERROR, NotifyType.PLUGIN_DISABLED);
				}
				if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_ERROR;
				if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_ERROR;
				this.setStatusMessage(NotifyType.PLUGIN_DISABLED, false);
				break;
			case NotifyType.CONNECTION_LOST:
				if (notifications > 0) {
					this.makeNotice(STATUS_ERROR, NotifyType.CONNECTION_LOST);
				}
				if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_ERROR;
				if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_ERROR;
				this.setStatusMessage(NotifyType.CONNECTION_LOST, false);
				break;
			case NotifyType.NOT_CONNECTED:
				if (notifications > 0) {
					this.makeNotice(STATUS_ERROR, NotifyType.NOT_CONNECTED);
				}
				if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_ERROR;
				if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_ERROR;
				this.setStatusMessage(NotifyType.NOT_CONNECTED, false);
				break;
			case NotifyType.CONNECTED:
				if (notifications > 0) {
					this.makeNotice(STATUS_OK, NotifyType.CONNECTED);
				}
				if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_OK;
				if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_OK;
				this.setStatusMessage(NotifyType.CONNECTED, false);
				break;
			case NotifyType.SYNCING:
				if (notifications > 1) {
					this.makeNotice(STATUS_SYNC, NotifyType.SYNCING);
				}
				if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_SYNC;
				if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_SYNC;
				this.setStatusMessage(NotifyType.SYNCING, true);
				break;
			case NotifyType.SYNC_COMPLETED:
				if (notifications > 1) {
					this.makeNotice(STATUS_OK, NotifyType.SYNC_COMPLETED);
				}
				if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_OK;
				if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_OK;
				this.setStatusMessage(NotifyType.SYNC_COMPLETED, false);
				break;
			case NotifyType.AUTO_SYNC_DISABLED:
				if (notifications > 1) {
					this.makeNotice(STATUS_WARN, NotifyType.AUTO_SYNC_DISABLED);
				}
				if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_WARN;
				if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_WARN;
				this.setStatusMessage(NotifyType.AUTO_SYNC_DISABLED, false);
				break;
		}
	}

	cleanup() {
		clearTimeout(this.timeoutStatusMessage);
		if (this.pendingNotificationTimeout) {
			clearTimeout(this.pendingNotificationTimeout);
			this.pendingNotificationTimeout = null;
		}
		this.cancelPendingNotification();
	}
}
