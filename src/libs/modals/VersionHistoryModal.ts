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

		// Get filename from path
		let parts = this.path.split("/");
		this.name = parts[parts.length - 1];
		this.titleEl.setText("Version History");

		// Create main layout
		this.elList = this.contentEl.createDiv("history-list");
		this.elContainer = this.contentEl.createDiv("version-container");
		let elContent = this.elContainer.createDiv("version-content");

		// Titlebar setup
		let elTitle = elContent.createDiv("version-titlebar");
		
		// Back button (mobile portrait only)
		if (this.app.isMobile) {
			this.backButton = elTitle.createEl("button", {
				cls: "clickable-icon",
				attr: { "aria-label": "Back to versions list" }
			});
			this.backButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
			this.backButton.onclick = this.onBack.bind(this);
			
			// Hide back button in landscape (both views visible)
			if (!this.isPortrait()) {
				this.backButton.hide();
			}
		}

		// Filename display
		let fileName = elTitle.createDiv("version-filename");
		fileName.textContent = this.name;

		// Actions
		let actions = elTitle.createDiv("version-actions");
		this.buttonRestore = actions.createEl("button", {
			text: "Restore",
			cls: "mod-cta"
		});
		this.buttonRestore.disabled = true;
		this.buttonRestore.onclick = this.onRestore.bind(this);

		// Markdown preview setup (hack for MarkdownPreviewView)
		let _originalContentEl = this.contentEl;
		this.contentEl = elContent;
		this.markdownView = new MarkdownPreviewView(this);
		this.contentEl = _originalContentEl;

		// Hide container on mobile portrait initially (landscape shows both)
		if (this.app.isMobile && this.isPortrait()) {
			this.elContainer.hide();
		}

		// Load version history
		this.plugin.xSync.listVersionHistory(this.path, (data: any) => {
			this.versions = [];
			if (!data || data.data.length <= 0) {
				this.elList.createDiv({
					text: "No version history found",
					cls: "version-timestamp"
				}).style.opacity = "0.5";
				return;
			}

			if (data.deleted) {
				this.type = "deleted";
			}

			// Create version items
			for (let timestamp of data.data) {
				let item = this.elList.createDiv("version-timestamp");
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

			// Auto-select first item on desktop or mobile landscape
			if (this.versions.length > 0 && (!this.app.isMobile || !this.isPortrait())) {
				this.internalItemSelect(this.versions[0]);
			}
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
		// Update active state
		this.versions.forEach(v => v.el.removeClass("active"));
		item.el.addClass("active");

		// Load version content
		this.plugin.xSync.readVersionHistory(this.path, item.timestamp, (data: any) => {
			if (typeof data !== "string") {
				data = "";
			}
			this.markdownView.set(data, true);
			this.markdownView.applyScroll(0);
		});

		this.selectedVersion = item;

		// Update restore button state
		const isCurrentVersion = this.type === "created" && 
			this.versions.length > 0 && 
			this.selectedVersion.timestamp === this.versions[0].timestamp;

		if (isCurrentVersion) {
			this.buttonRestore.textContent = "Current";
			this.buttonRestore.disabled = true;
		} else {
			this.buttonRestore.textContent = "Restore";
			this.buttonRestore.disabled = false;
		}

		// Mobile Portrait: Show content view (slide over)
		// Mobile Landscape: Both views visible (no action needed)
		if (this.app.isMobile && this.isPortrait()) {
			this.elContainer.show();
			this.elList.hide();
		}
	}

	private isPortrait(): boolean {
		return window.innerHeight > window.innerWidth;
	}

	private async onBack() {
		if (this.app.isMobile) {
			this.elContainer.hide();
			this.elList.show();
		}
	}

	private async onRestore() {
		let data = this.markdownView.get();
		let metadata = await this.plugin.xSync.getMetadata(
			"restore",
			{
				path: this.path,
				data: data
			}
		);
		// force an update
		metadata.sha1 = null;

		await this.plugin.xSync.storage.write(this.path, data, metadata);
		new Notice("Restored - " + this.name + " ("+ this.formatTimestamp(this.selectedVersion.timestamp) +")")
		this.close();
	}
}
