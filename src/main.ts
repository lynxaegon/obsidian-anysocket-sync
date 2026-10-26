import {
	Platform,
	Plugin,
	PluginSettingTab,
	Setting
} from 'obsidian';
import XSync from './XSync';
import {VersionHistoryModal} from "./libs/modals/VersionHistoryModal";
import {hostname} from "os";
import {FilesHistoryModal} from "./libs/modals/FilesHistoryModal";
import {SyncPanelModal} from "./libs/modals/SyncPanelModal";
import Utils from "./libs/Utils";
import {UAParser} from "ua-parser-js";
// @ts-ignore
import AnySocket from "anysocket/dist/anysocket.browser.js";

interface AnySocketSyncSettings {
	host: string;
	port: string;
	password: string;
	syncEnabled: boolean;
	delayedSync: number;
	autoSync: boolean;
	notifications: number;
	deviceName: string;
	debug: boolean;
}

let deviceInfo = (new UAParser(navigator.userAgent)).getDevice();

function getDefaultDeviceName() {
	if (Platform.isDesktop) {
		return hostname();
	}
	if (deviceInfo.model) {
		return deviceInfo.model;
	}
	// @ts-ignore
	if (Platform.isIosApp) {
		// @ts-ignore
		return Platform.isTablet ? "iPad" : "iPhone";
	}
	// @ts-ignore
	if (Platform.isAndroidApp) {
		// @ts-ignore
		return Platform.isTablet ? "Android tablet" : "Android phone";
	}
	return "Mobile";
}

const DEFAULT_SETTINGS: AnySocketSyncSettings = {
	host: '127.0.0.1',
	port: "3000",
	password: "",
	syncEnabled: false,
	delayedSync: 3,
	autoSync: true,
	notifications: 1,
	deviceName: getDefaultDeviceName(),
	debug: false,
}

export default class AnySocketSyncPlugin extends Plugin {
	VERSION = "__anysocketsync_version__";
	BUILD = "__anysocketsync_build__";
	settings: AnySocketSyncSettings;
	xSync: XSync;
	isReady: boolean = false;
	panel: SyncPanelModal | null = null;

	async onload() {
		await this.loadSettings();
		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
			// @ts-ignore
			// if folder, return
			if (!file.stat) {
				return;
			}

			// binary files have history too on a 1.6.0+ server
			if (!Utils.isBinary(file.path) || this.xSync.protocol >= 2) {
				menu.addItem((item) => {
					item
						.setTitle("Version history")
						.setIcon("history")
						.onClick(async () => {
							new VersionHistoryModal(this, file.path);
						});
				});
			}
			menu.addItem((item) => {
				item
					.setTitle("Deleted files history")
					.setIcon("history")
					.onClick(async () => {
						new FilesHistoryModal(this, true);
					});
			});
		}));

		this.addCommand({
			id: "files-version-history",
			name: "Version history",
			callback: async () => {
				new FilesHistoryModal(this, false);
			}
		});

		this.addCommand({
			id: "sync-now",
			name: "Sync Now",
			callback: async () => {
				await this.xSync.sync();
			}
		});

		this.addCommand({
			id: "deleted-version-history",
			name: "Deleted files history",
			callback: async () => {
				new FilesHistoryModal(this, true);
			}
		});

		this.addCommand({
			id: "open-sync-panel",
			name: "Open sync panel (status, devices, activity)",
			callback: () => this.openSyncPanel()
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AnySocketSyncSettingTab(this));

		this.xSync = new XSync(this);
		this.xSync.makeStatusBarItem(this.addStatusBarItem());

		// startup
		// @ts-ignore
		if(!app.workspace.layoutReady) {
			// @ts-ignore
			this.registerEvent(this.app.workspace.on("layout-ready", async () => {
				await this.ready();
			}));
		}
		else {
			await this.ready();
		}
	}

	async ready() {
		this.isReady = true;
		await this.xSync.enabled(true);
	}

	async onunload() {
		await this.xSync.enabled(false);
		this.xSync.destroy();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (!this.settings.deviceName || this.settings.deviceName === "Unknown") {
			this.settings.deviceName = getDefaultDeviceName();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// a removed device tries again once its settings change
		this.xSync.revoked = false;
		this.xSync.anysocket.attempts = 0;
		this.xSync.reload(0);
	}

	openSyncPanel() {
		if (this.panel) {
			return;
		}
		this.panel = new SyncPanelModal(this);
		this.panel.onClose = () => {
			this.panel?.cleanup();
			this.panel = null;
		};
		this.panel.open();
	}
}

class AnySocketSyncSettingTab extends PluginSettingTab {
	plugin: AnySocketSyncPlugin;
	statusEl: HTMLElement;
	onStatus: any;

	constructor(plugin: AnySocketSyncPlugin) {
		// @ts-ignore
		super(app, plugin);
		this.plugin = plugin;
	}

	// a text field that saves when you leave it (or press enter), not on every keystroke
	textSetting(name: string, desc: string, key: string, placeholder: string, options: { password?: boolean, fallback?: () => string } = {}) {
		return new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText(text => {
				// @ts-ignore
				text.setPlaceholder(placeholder).setValue(this.plugin.settings[key]);
				if (options.password) {
					text.inputEl.type = "password";
				}
				text.inputEl.addEventListener("change", async () => {
					let value = text.getValue().trim();
					if (!value && options.fallback) {
						value = options.fallback();
						text.setValue(value);
					}
					// @ts-ignore
					if (this.plugin.settings[key] !== value) {
						// @ts-ignore
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings();
					}
				});
			});
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.addClass("anysocket-settings");

		// what is going on, in one line
		const summary = new Setting(containerEl)
			.setName("Status")
			.addButton(button => button
				.setButtonText("Open sync panel")
				.onClick(() => this.plugin.openSyncPanel()));
		this.statusEl = summary.descEl;
		const update = () => this.statusEl.setText(this.plugin.xSync.status.sentence());
		update();
		this.onStatus = update;
		(this.plugin.xSync.status as any).on("change", this.onStatus);

		new Setting(containerEl)
			.setName("Connection")
			.setHeading();

		this.textSetting("Device name", "How this device appears to your other devices.", "deviceName", getDefaultDeviceName(), {
			fallback: getDefaultDeviceName
		});
		this.textSetting("Host", "Your server's address, e.g. sync.example.com or 192.168.1.10", "host", "127.0.0.1");
		this.textSetting("Port", "", "port", "3000");
		this.textSetting("Password", "The \"password\" from the server's config.js", "password", "password", { password: true });

		const test = new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Checks the address and password above.");
		test.addButton(button => button
			.setButtonText("Test")
			.onClick(async () => {
				button.setDisabled(true);
				test.setDesc("Testing…");
				test.setDesc(await testConnection(this.plugin.settings));
				button.setDisabled(false);
			}));

		new Setting(containerEl)
			.setName('Enable connection')
			.setDesc("Connect to the server and sync this vault.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.syncEnabled)
					.onChange(async (value) => {
						this.plugin.settings.syncEnabled = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Sync")
			.setHeading();

		new Setting(containerEl)
			.setName('Auto sync')
			.setDesc("Sync changes as they happen. When off, use the \"Sync now\" command.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoSync)
					.onChange(async (value) => {
						this.plugin.settings.autoSync = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Delayed sync')
			.setDesc("Wait this long after you stop typing before sending a change (or until you switch notes).")
			.addDropdown((dropdown) => {
				dropdown.addOption("0", "Instant");
				dropdown.addOption("3", "3s");
				dropdown.addOption("4", "4s");
				dropdown.addOption("5", "5s");
				dropdown.addOption("10", "10s");
				dropdown.addOption("15", "15s");
				dropdown.addOption("20", "20s");
				dropdown.addOption("25", "25s");
				dropdown.addOption("30", "30s");
				dropdown.addOption("60", "1m");
				dropdown.addOption("300", "5m");
				dropdown.addOption("600", "10m");
				dropdown.addOption("900", "15m");

				dropdown.setValue(this.plugin.settings.delayedSync.toString())
					.onChange(async (value) => {
						this.plugin.settings.delayedSync = parseInt(value);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Notifications')
			.setDesc("Pop-ups. The status bar always shows what is going on.")
			.addDropdown((dropdown) => {
				dropdown.addOption("0", "Off");
				dropdown.addOption("1", "Important only");
				dropdown.addOption("2", "Everything");

				dropdown.setValue(this.plugin.settings.notifications.toString())
					.onChange(async (value) => {
						this.plugin.settings.notifications = parseInt(value);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Advanced")
			.setHeading();

		new Setting(containerEl)
			.setName('Debug')
			.setDesc("Log what sync does to the developer console.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debug)
					.onChange(async (value) => {
						this.plugin.settings.debug = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Rebuild index')
			.setDesc("Forget what this device knows about synced files and compare everything with the server again. Nothing is deleted; if a file differs, both versions are kept.")
			.addButton(button => button
				.setButtonText('Rebuild')
				.onClick(async () => {
					await this.plugin.xSync.storage.dropMetadata();
					await this.plugin.xSync.v2.index.drop();
					this.plugin.xSync.reload(0);
					this.plugin.xSync.status.notify("rebuilding the index");
				})
			);
	}

	hide() {
		if (this.onStatus) {
			(this.plugin.xSync.status as any).off("change", this.onStatus);
			this.onStatus = null;
		}
	}
}

// connects with these settings once, without syncing, and says what happened
async function testConnection(settings: AnySocketSyncSettings): Promise<string> {
	if (!settings.host || !settings.password) {
		return "Enter the host and the password first.";
	}
	const anysocket = new AnySocket({ auth: { secret: settings.password, optional: true } });
	const password = await Utils.getSHA(anysocket.id.substring(0, 16) + settings.password + anysocket.id.substring(16));
	anysocket.authPacket = () => password;
	anysocket.onAuth = async (packet: any) => await Utils.getSHA(packet.id.substring(0, 16) + settings.password + packet.id.substring(16)) == packet.auth;
	try {
		const peer = await anysocket.connect("ws", settings.host, settings.port, { connectTimeout: 10000 });
		await peer.e2e();
		const info = peer.e2eInfo && peer.e2eInfo();
		const modern = peer.protocolVersion && peer.protocolVersion() >= 1;
		return "✓ Connected, encrypted" + (info && info.cipher ? " (" + info.cipher.toUpperCase() + ")" : "") +
			(modern ? "." : ". The server runs an older version (before 1.6.0); updating it is recommended.");
	} catch (e) {
		if (e && e.code === "ECONNFAILED") {
			return "✗ The server refused the connection: the password is most likely wrong.";
		}
		return "✗ Can't reach " + settings.host + ":" + settings.port + ". Check the address, the port, and that the server is running.";
	} finally {
		anysocket.stop().catch(() => {});
	}
}
