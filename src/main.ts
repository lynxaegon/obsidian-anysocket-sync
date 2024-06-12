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
	isLoading = false;

	async onload() {
		await this.loadSettings();

		this.ribbonIcon = this.addRibbonIcon('paper-plane', 'AnySocket Sync', async (evt: MouseEvent) => {
			// do nothing
			if (this.isLoading) {
				return;
			}
			this.isLoading = true;
			await this.xSync.enabled(!this.xSync.isEnabled);
			this.isLoading = false;
		});
		this.ribbonIcon.style.color = "red";

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

		containerEl.createEl('h2', {text: 'Settings'});

		new Setting(containerEl)
			.setName('Host')
			.addText(text => text
				.setPlaceholder('127.0.0.1')
				.setValue(this.plugin.settings.host)
				.onChange(async (value) => {
					this.plugin.settings.host = value;
				}));
		new Setting(containerEl)
			.setName('Port')
			.addText(text => text
				.setPlaceholder('3000')
				.setValue(this.plugin.settings.port)
				.onChange(async (value) => {
					this.plugin.settings.port = value;
				}));
		new Setting(containerEl)
			.setName('Password')
			.addText(text => {
					text
						.setPlaceholder('pass')
						.setValue(this.plugin.settings.password)
						.onChange(async (value) => {
							this.plugin.settings.password = value;
						});
					text.inputEl.type = "password";
				}
			)
		new Setting(containerEl)
			.addButton((button) =>
				button.setButtonText("Save").onClick(async () => {
					await this.plugin.saveSettings();
					this.plugin.xSync.reload();
				})
			);
	}
}
