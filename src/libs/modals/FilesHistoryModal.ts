//@ts-nocheck
import {Notice, SuggestModal} from "obsidian";
import AnySocketSyncPlugin from "../../main";
import {VersionHistoryModal} from "./VersionHistoryModal";
import Utils from "../Utils";
import AnySocket from "anysocket/src/libs/AnySocket";

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

		this.plugin.xSync.listFilesHistory(this.deletedOnly,(data: any) => {
			this.data = data;
			this.open();
		});
		this.containerEl.addClass("anysocket-files-history");
	}

	getSuggestions(query: string): DeletedFile[] | Promise<DeletedFile[]> {
		return this.data.filter(item => item.path.toLowerCase().includes(query.toLowerCase()))
	}

	async onChooseSuggestion(item: DeletedFile, evt: MouseEvent | KeyboardEvent) {
		if(Utils.isBinary(item.path)) {
			let parts = item.path.split("/");

			await this.plugin.xSync.listVersionHistory(item.path, async (data: any) => {
				await this.plugin.xSync.readVersionHistory(item.path, data.data[0], async (data: any) => {
					data = AnySocket.Packer.unpack(data);
					let metadata = await this.plugin.xSync.getMetadata(
						"restore",
						{
							path: item.path,
							data: data
						}
					);
					// force an update
					metadata.sha1 = null;

					await this.plugin.xSync.storage.writeBinary(item.path, data, metadata);
					new Notice("Restored - " + parts[parts.length - 1]);
				});
			});
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
		el.createEl("div", { text: prefix + this.formatTimestamp(value.mtime) }).addClass("item-metadata");
	}

	private formatTimestamp(timestamp) {
		let date =  new Date(timestamp);

		let month = date.getMonth() + 1; // Months are zero-based in JavaScript
		let day = date.getDate();
		let year = date.getFullYear();
		let hours = date.getHours();
		let minutes = date.getMinutes();
		let ampm = hours >= 12 ? 'PM' : 'AM';

		hours = hours % 12;
		hours = hours ? hours : 12; // the hour '0' should be '12'
		minutes = minutes < 10 ? '0' + minutes : minutes; // zero-padding minutes

		return `${month}/${day}/${year} ${hours}:${minutes} ${ampm}`;
	}
}
