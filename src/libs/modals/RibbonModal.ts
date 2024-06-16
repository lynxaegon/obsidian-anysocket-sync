import {SuggestModal} from "obsidian";
import AnySocketSyncPlugin from "../../main";
import {FilesHistoryModal} from "./FilesHistoryModal";

interface Command {
	id: number
	name: string
	canShow?: (plugin: AnySocketSyncPlugin) => {};
}

const COMMAND_TYPES = {
	SETTINGS: 1,
	DELETED_FILES: 2,
	VERSION_HISTORY: 3,
	PLUGIN_STATE: 4
}
const commandList = [
	{
		id: COMMAND_TYPES.SETTINGS,
		name: "Settings",
		canShow: (plugin: AnySocketSyncPlugin) => {
			return true;
		}
	},
	{
		id: COMMAND_TYPES.DELETED_FILES,
		name: "Deleted Files",
		canShow: (plugin: AnySocketSyncPlugin) => {
			return plugin.xSync.anysocket.isConnected;
		}
	},
	{
		id: COMMAND_TYPES.VERSION_HISTORY,
		name: "Version History",
		canShow: (plugin: AnySocketSyncPlugin) => {
			return plugin.xSync.anysocket.isConnected;
		}
	},
	{
		id: COMMAND_TYPES.PLUGIN_STATE,
		name: "Enable Sync",
		canShow: (plugin: AnySocketSyncPlugin) => {
			return !plugin.xSync.isEnabled;
		}
	},
	{
		id: COMMAND_TYPES.PLUGIN_STATE,
		name: "Disable Sync",
		canShow: (plugin: AnySocketSyncPlugin) => {
			return plugin.xSync.isEnabled;
		}
	}
]

export class RibbonModal extends SuggestModal<Command> {
	plugin: AnySocketSyncPlugin;

	constructor(plugin: AnySocketSyncPlugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder("Type a command...");
	}

	getSuggestions(query: string): Command[] | Promise<Command[]> {
		return commandList.filter((item) => {
			if (item.canShow(this.plugin)) {
				return item.name.toLowerCase().includes(query.toLowerCase());
			}
		});
	}

	async onChooseSuggestion(item: Command, evt: MouseEvent | KeyboardEvent) {
		switch (item.id) {
			case COMMAND_TYPES.SETTINGS:
				const setting = (this.app as any).setting;
				await setting.open()
				setting.openTabById("anysocket-sync");
				break;
			case COMMAND_TYPES.VERSION_HISTORY:
				new FilesHistoryModal(this.plugin, false);
				break;
			case COMMAND_TYPES.DELETED_FILES:
				new FilesHistoryModal(this.plugin, true);
				break;
			case COMMAND_TYPES.PLUGIN_STATE:
				if (this.plugin.isLoading) {
					break;
				}
				this.plugin.isLoading = true;
				await this.plugin.xSync.enabled(!this.plugin.xSync.isEnabled);
				this.plugin.isLoading = false;
				break;
		}
	}

	renderSuggestion(value: Command, el: HTMLElement): any {
		el.createEl("div", { cls: "as-item", text: value.name });
	}
}
