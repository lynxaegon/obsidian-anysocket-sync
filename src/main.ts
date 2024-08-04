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
import Utils from "./libs/Utils";
import {UAParser} from "ua-parser-js";

interface AnySocketSyncSettings {
	host: string;
	port: string;
	password: string;
	syncEnabled: boolean;
	deviceName: string;
	debug: boolean;
}

let deviceInfo = (new UAParser(navigator.userAgent)).getDevice();
function getDefaultDeviceName() {
	return Platform.isDesktop ? hostname() : deviceInfo.model || "Unknown";
}

const DEFAULT_SETTINGS: AnySocketSyncSettings = {
	host: '127.0.0.1',
	port: "3000",
	password: "",
	syncEnabled: false,
	deviceName: getDefaultDeviceName(),
	debug: false,
}

export default class AnySocketSyncPlugin extends Plugin {
	VERSION = "__anysocketsync_version__";
	BUILD = "__anysocketsync_build__";
	settings: AnySocketSyncSettings;
	xSync: XSync;
	ribbonIcon: HTMLElement;
	isLoading = false;

	async onload() {
		await this.loadSettings();

		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
			// @ts-ignore
			// if folder, return

			if(!file.stat) {
				return;
			}

			if(!Utils.isBinary(file.path)) {
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
			id: "command-files-version-history",
			name: "Version history",
			callback: async () => {
				new FilesHistoryModal(this, false);
			}
		});

		this.addCommand({
			id: "command-deleted-files-version-history",
			name: "Deleted files history",
			callback: async () => {
				new FilesHistoryModal(this, true);
			}
		});


		this.ribbonIcon = this.addRibbonIcon('paper-plane', 'AnySocket Sync', () => {});
		this.ribbonIcon.addClass("anysocket-ribbon-icon");
		this.ribbonIcon.addClass("offline");

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AnySocketSyncSettingTab(this));

		this.xSync = new XSync(this);
		await this.xSync.enabled(true);
	}

	async onunload() {
		await this.xSync.enabled(false);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.xSync.reload();
	}
}

class AnySocketSyncSettingTab extends PluginSettingTab {
	plugin: AnySocketSyncPlugin;

	constructor(plugin: AnySocketSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Device name')
			.addText(text => text
				.setPlaceholder(getDefaultDeviceName())
				.setValue(this.plugin.settings.deviceName)
				.onChange(async (value) => {
					if(value == "") {
						value = getDefaultDeviceName();
					}
					this.plugin.settings.deviceName = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Host')
			.addText(text => text
				.setPlaceholder('127.0.0.1')
				.setValue(this.plugin.settings.host)
				.onChange(async (value) => {
					this.plugin.settings.host = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Port')
			.addText(text => text
				.setPlaceholder('3000')
				.setValue(this.plugin.settings.port)
				.onChange(async (value) => {
					this.plugin.settings.port = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Password')
			.addText(text => {
					text
						.setPlaceholder('pass')
						.setValue(this.plugin.settings.password)
						.onChange(async (value) => {
							this.plugin.settings.password = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.type = "password";
				}
			);
		new Setting(containerEl)
			.setName('Sync')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.syncEnabled)
					.onChange(async (value) => {
						this.plugin.settings.syncEnabled = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Debug')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debug)
					.onChange(async (value) => {
						this.plugin.settings.debug = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
