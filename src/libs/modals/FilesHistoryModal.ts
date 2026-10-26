//@ts-nocheck
import {Notice, SuggestModal} from "obsidian";
import AnySocketSyncPlugin from "../../main";
import {VersionHistoryModal} from "./VersionHistoryModal";
import Utils from "../Utils";

interface DeletedFile {
	path: string;
	mtime: number;
}

export class FilesHistoryModal extends SuggestModal<DeletedFile> {
	plugin: AnySocketSyncPlugin;
	data: any;

	constructor(plugin: AnySocketSyncPlugin, deletedOnly = false) {
		super(app);
		this.plugin = plugin;
		this.data = [];
		this.deletedOnly = deletedOnly;

		if(this.deletedOnly) {
			this.setPlaceholder("Search for deleted files...");
		}
		else {
			this.setPlaceholder("Search for files...");
		}
		this.emptyStateText = this.deletedOnly ? "No deleted files on the server" : "No files on the server";

		this.engine = plugin.xSync.historyEngine();
		if (!this.engine) {
			return;
		}
		this.engine.listFiles(this.deletedOnly).then((data: any) => {
			this.data = (data || []).sort((a, b) => b.mtime - a.mtime);
			this.open();
		}).catch((e) => {
			new Notice("AnySocket Sync: couldn't load the files (" + (e.message || e.error || e) + ")");
		});
		this.containerEl.addClass("anysocket-files-history");
	}

	getSuggestions(query: string): DeletedFile[] | Promise<DeletedFile[]> {
		return this.data.filter(item => item.path.toLowerCase().includes(query.toLowerCase()))
	}

	async onChooseSuggestion(item: DeletedFile, evt: MouseEvent | KeyboardEvent) {
		// images and other binary files: bring back the newest version
		if(Utils.isBinary(item.path) && this.plugin.xSync.protocol < 2) {
			let name = item.path.split("/").pop();
			try {
				const versions = await this.engine.listVersions(item.path);
				if (!versions || !versions.data || !versions.data.length) {
					new Notice("No versions of " + name + " on the server");
					return;
				}
				const bytes = await this.engine.readVersion(item.path, versions.data[0]);
				await this.engine.restore(item.path, bytes);
				new Notice("Restored - " + name);
			} catch (e) {
				new Notice("AnySocket Sync: couldn't restore " + name + " (" + (e.message || e.error || e) + ")");
			}
		}
		else {
			new VersionHistoryModal(this.plugin, item.path);
		}
	}

	renderSuggestion(value: DeletedFile, el: HTMLElement): any {
		el.createEl("div", { text: value.path }).addClass("item-path");

		let prefix = "Modified: ";
		if(this.deletedOnly) {
			prefix = "Deleted: ";
		}
		el.createEl("div", { text: prefix + new Date(value.mtime).toLocaleString(undefined, {
			year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
		}) }).addClass("item-metadata");
	}
}
