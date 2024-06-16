// @ts-nocheck
import {MarkdownPreviewView, Modal, Notice} from "obsidian";
import AnySocketSyncPlugin from "../../main";

export class VersionHistoryModal extends Modal {
	plugin: AnySocketSyncPlugin;
	markdownView: MarkdownPreviewView;
	versions: any;

	constructor(plugin: AnySocketSyncPlugin, path: string) {
		super(app);
		this.plugin = plugin;
		this.path = path;
		this.name = "Unknown";
		this.versions = [];
		this.type = "created";

		this.open();

		this.setup();
	}

	setup() {
		this.modalEl.addClass("anysocket-version-history");

		let elList = this.contentEl.createDiv("history-list");
		let elContainer = this.contentEl.createDiv("version-container");
		let elContent = elContainer.createDiv("version-content");

		// Titlebar setup
		let elTitle = elContent.createDiv("version-titlebar");
		let parts = this.path.split("/");
		this.name = parts[parts.length - 1];
		let fileName = elTitle.createDiv("version-filename").textContent = this.name;
		let actions = elTitle.createDiv("version-actions");
		this.buttonRestore = actions.createEl("button", {text: "Restore", onclick: this.onRestore.bind(this)});
		this.buttonRestore.disabled = true;

		////// Content Setup
		// hack for markdown preview
		let _originalContentEl = this.contentEl;
		this.contentEl = elContent;
		this.markdownView = new MarkdownPreviewView(this);
		this.contentEl = _originalContentEl;


		// show version content
		this.plugin.xSync.listVersionHistory(this.path, (data: any) => {
			this.versions = [];
			if (data && data.data.length <= 0) {
				return;
			}
			if(data.deleted) {
				this.type = "deleted";
			}

			for(let timestamp of data.data) {
				let item = elList.createDiv("version-timestamp");
				let versionItem = {
					timestamp: timestamp,
					el: item
				};
				item.textContent = this.formatTimestamp(timestamp);
				item.onclick = () => {
					this.internalItemSelect(versionItem);
				};
				this.versions.push(versionItem);
			}
			this.internalItemSelect(this.versions[0]);
		});
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

	private internalItemSelect(item) {
		this.versions.map(v => v.el.removeClass("active"));
		item.el.addClass("active");

		this.plugin.xSync.readVersionHistory(this.path, item.timestamp, (data: any) => {
			this.markdownView.set(data, true);
			this.markdownView.applyScroll(0);
		});
		this.selectedVersion = item;

		this.buttonRestore.textContent = "Restore"
		this.buttonRestore.disabled = false;

		if(this.type == "created") {
			if (this.selectedVersion.timestamp == this.versions[0].timestamp) {
				this.buttonRestore.textContent = "Current"
				this.buttonRestore.disabled = true;
			} else {
				this.buttonRestore.textContent = "Restore"
				this.buttonRestore.disabled = false;
			}
		}
	}

	private async onRestore() {
		let data = this.markdownView.get();
		let metadata = await this.plugin.xSync.getMetadata(
			"restore",
			data
		);
		// force an update
		metadata.sha1 = null;

		await this.plugin.xSync.storage.write(this.path, data, metadata);
		new Notice("Restored - " + this.name + " ("+ this.formatTimestamp(this.selectedVersion.timestamp) +")")
		this.close();
	}
}
