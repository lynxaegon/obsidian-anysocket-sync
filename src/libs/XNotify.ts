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

	// Notification state tracking
	lastNotification: string | null = null;
	lastNotificationTime: number = 0;
	notificationTimeout: any = null;
	connectionLostShown: boolean = false;
	isFromBackground: boolean = false;

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
		let notice = (new Notice()).noticeEl;
		let container = notice.createEl('span');
		container.style.verticalAlign = "middle";
		container.style.display = "inline-flex";
		container.style.alignItems = "center";

		let icon = container.createEl('span');
		icon.style.paddingRight = "4px";
		icon.style.color = color;
		icon.innerHTML = this.xSync.plugin.getSVGIcon();
		container.createEl('span', { text: text });
	}

	setFromBackground(value: boolean) {
		this.isFromBackground = value;
		this.xSync.debug && console.log("XNotify: isFromBackground =", value);
	}

	notifyStatus(type: string) {
		this.xSync.debug && console.log("XNotify: notifyStatus", type, {
			lastNotification: this.lastNotification,
			connectionLostShown: this.connectionLostShown,
			isFromBackground: this.isFromBackground
		});

		const now = Date.now();
		const notifications = this.xSync.plugin.settings.notifications;

		// Handle connection state notifications specially
		if (type === NotifyType.CONNECTION_LOST) {
			this.handleConnectionLost(now, notifications);
			return;
		}

		if (type === NotifyType.NOT_CONNECTED) {
			this.handleNotConnected(now, notifications);
			return;
		}

		if (type === NotifyType.CONNECTED) {
			this.handleConnected(now, notifications);
			return;
		}

		// Handle other notifications normally
		this.lastNotification = type;
		this.lastNotificationTime = now;

		switch (type) {
			case NotifyType.PLUGIN_DISABLED:
				if (notifications > 0) {
					this.makeNotice(STATUS_ERROR, NotifyType.PLUGIN_DISABLED);
				}
				if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_ERROR;
				if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_ERROR;
				this.setStatusMessage(NotifyType.PLUGIN_DISABLED, false);
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

	handleConnectionLost(now: number, notifications: number) {
		// Cancel any pending notifications
		this.cancelPendingNotification();

		// Update status bar immediately
		if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_ERROR;
		this.setStatusMessage(NotifyType.CONNECTION_LOST, false);

		// Only show notification after 2 seconds if still disconnected
		this.notificationTimeout = setTimeout(() => {
			if (!this.xSync.anysocket.isConnected && notifications > 0) {
				this.makeNotice(STATUS_ERROR, NotifyType.CONNECTION_LOST);
				this.connectionLostShown = true;
			}
			this.notificationTimeout = null;
		}, 2000);

		this.lastNotification = NotifyType.CONNECTION_LOST;
		this.lastNotificationTime = now;
	}

	handleNotConnected(now: number, notifications: number) {
		// Only show on initial connection failure (not during reconnection)
		const isInitialConnection = this.lastNotification === null || 
			this.lastNotification === NotifyType.PLUGIN_DISABLED;

		// DON'T cancel pending CONNECTION_LOST notifications during reconnection attempts!
		// Only cancel and schedule new notification for initial connection
		if (isInitialConnection) {
			this.cancelPendingNotification();
			
			this.notificationTimeout = setTimeout(() => {
				if (!this.xSync.anysocket.isConnected && notifications > 0) {
					this.makeNotice(STATUS_ERROR, NotifyType.NOT_CONNECTED);
					this.connectionLostShown = true;
				}
				this.notificationTimeout = null;
			}, 2000);
		}

		// Update status bar immediately
		if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_ERROR;
		if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_ERROR;
		this.setStatusMessage(NotifyType.NOT_CONNECTED, false);

		this.lastNotification = NotifyType.NOT_CONNECTED;
		this.lastNotificationTime = now;
	}

	handleConnected(now: number, notifications: number) {
		// Cancel any pending notifications
		this.cancelPendingNotification();

		// Update status bar immediately
		if (this.statusBarIcon) this.statusBarIcon.style.color = STATUS_OK;
		if (this.mobileIndicatorIcon) this.mobileIndicatorIcon.style.color = STATUS_OK;
		this.setStatusMessage(NotifyType.CONNECTED, false);

		// Show "Connected" notification only if:
		// 1. Connection lost was actually shown to user
		// 2. NOT from background resume
		// 3. Notifications enabled
		const shouldShowConnected = this.connectionLostShown && 
			!this.isFromBackground && 
			notifications > 0;

		this.xSync.debug && console.log("XNotify: CONNECTED", {
			connectionLostShown: this.connectionLostShown,
			isFromBackground: this.isFromBackground,
			shouldShowConnected: shouldShowConnected
		});

		if (shouldShowConnected) {
			this.makeNotice(STATUS_OK, NotifyType.CONNECTED);
		}

		// Reset state
		this.connectionLostShown = false;
		this.isFromBackground = false;
		this.lastNotification = NotifyType.CONNECTED;
		this.lastNotificationTime = now;
	}

	cancelPendingNotification() {
		if (this.notificationTimeout) {
			clearTimeout(this.notificationTimeout);
			this.notificationTimeout = null;
			// If we cancel a pending notification, it was never shown
			this.connectionLostShown = false;
			this.xSync.debug && console.log("XNotify: Cancelled pending notification");
		}
	}

	cleanup() {
		clearTimeout(this.timeoutStatusMessage);
		this.cancelPendingNotification();
	}
}
