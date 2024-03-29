import {
	Plugin,
	PluginSettingTab,
	Setting
} from 'obsidian';
import XSync from './XSync';

interface AnySocketSyncSettings {
	host: string;
	port: string;
	password: string;
}

const DEFAULT_SETTINGS: AnySocketSyncSettings = {
	host: '127.0.0.1',
	port: "3000",
	password: ""
}

export default class AnySocketSyncPlugin extends Plugin {
	VERSION = "__anysocketsync_version__";
	BUILD = "__anysocketsync_build__";
	settings: AnySocketSyncSettings;
	xSync: XSync;
	ribbonIcon: HTMLElement;

	async onload() {
		await this.loadSettings();

		this.ribbonIcon = this.addRibbonIcon('paper-plane', 'AnySocket Sync', (evt: MouseEvent) => {
			// do nothing
			this.xSync.notifyConnectionStatus();
		});
		this.ribbonIcon.style.color = "red";

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AnySocketSyncSettingTab(this));

		this.xSync = new XSync(this);
		this.xSync.isEnabled = true;
		this.xSync.load(false);
	}

	onunload() {
		this.xSync.isEnabled = false;
		this.xSync.unload(false);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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

		containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

		new Setting(containerEl)
			.setName('Server Host')
			.addText(text => text
				.setPlaceholder('host/ip')
				.setValue(this.plugin.settings.host)
				.onChange(async (value) => {
					this.plugin.settings.host = value;
				}))
			.addText(text => text
				.setPlaceholder('port')
				.setValue(this.plugin.settings.port)
				.onChange(async (value) => {
					this.plugin.settings.port = value;
				}))
			.addText(text => text
				.setPlaceholder('pass')
				.setValue(this.plugin.settings.password)
				.onChange(async (value) => {
					this.plugin.settings.password = value;
				}))
			.addButton((button) =>
				button.setButtonText("Save").onClick(async () => {
					await this.plugin.saveSettings();
					this.plugin.xSync.reload();
				})
			);
	}
}
