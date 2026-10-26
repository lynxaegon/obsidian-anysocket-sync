// @ts-nocheck
import {MarkdownPreviewView, Modal, Notice} from "obsidian";
import AnySocketSyncPlugin from "../../main";
import Utils from "../Utils";

const IMAGES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif" };

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
		this.binary = Utils.isBinary(path);
		this.selectedData = null;
		this.objectUrl = null;

		this.engine = plugin.xSync.historyEngine();
		if (!this.engine) {
			return;
		}

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

		if (this.binary) {
			this.previewEl = elContent.createDiv("version-binary-preview");
		} else {
			// Markdown preview setup (hack for MarkdownPreviewView)
			let _originalContentEl = this.contentEl;
			this.contentEl = elContent;
			this.markdownView = new MarkdownPreviewView(this);
			this.contentEl = _originalContentEl;
		}

		// Hide container on mobile portrait initially (landscape shows both)
		if (this.app.isMobile && this.isPortrait()) {
			this.elContainer.hide();
		}

		const loading = this.elList.createDiv({ text: "Loading…", cls: "version-timestamp version-message" });

		// Load version history
		this.engine.listVersions(this.path).then((data: any) => {
			loading.remove();
			this.versions = [];
			if (!data || !data.data || data.data.length <= 0) {
				this.elList.createDiv({
					text: "No versions on the server yet",
					cls: "version-timestamp version-message"
				});
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
		}).catch((e) => {
			loading.setText("Couldn't load the history: " + (e.message || e.error || e));
		});
	}

	private formatTimestamp(timestamp) {
		return new Date(timestamp).toLocaleString(undefined, {
			year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
		});
	}

	private internalItemSelect(item) {
		// Update active state
		this.versions.forEach(v => v.el.removeClass("active"));
		item.el.addClass("active");
		this.selectedVersion = item;
		this.selectedData = null;
		this.buttonRestore.disabled = true;

		// Load version content
		this.engine.readVersion(this.path, item.timestamp).then((bytes: Uint8Array) => {
			if (this.selectedVersion !== item) {
				return;
			}
			this.selectedData = bytes;
			if (this.binary) {
				this.showBinary(bytes);
			} else {
				this.markdownView.set(bytes ? new TextDecoder().decode(bytes) : "", true);
				this.markdownView.applyScroll(0);
			}
			this.updateRestoreButton();
		}).catch((e) => {
			new Notice("AnySocket Sync: couldn't load this version (" + (e.message || e.error || e) + ")");
		});

		// Mobile Portrait: Show content view (slide over)
		// Mobile Landscape: Both views visible (no action needed)
		if (this.app.isMobile && this.isPortrait()) {
			this.elContainer.show();
			this.elList.hide();
		}
	}

	private updateRestoreButton() {
		const isCurrentVersion = this.type === "created" &&
			this.versions.length > 0 &&
			this.selectedVersion.timestamp === this.versions[0].timestamp;

		if (isCurrentVersion) {
			this.buttonRestore.textContent = "Current";
			this.buttonRestore.disabled = true;
		} else {
			this.buttonRestore.textContent = "Restore";
			this.buttonRestore.disabled = this.selectedData == null;
		}
	}

	private showBinary(bytes: Uint8Array) {
		this.previewEl.empty();
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
		const ext = this.path.split(".").pop().toLowerCase();
		if (bytes && IMAGES[ext]) {
			this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: IMAGES[ext] }));
			this.previewEl.createEl("img", { attr: { src: this.objectUrl } });
		} else {
			this.previewEl.createDiv({
				cls: "version-message",
				text: bytes ? "No preview for this file type (" + Math.max(1, Math.round(bytes.length / 1024)) + " KB)" : "This version is not available"
			});
		}
	}

	onClose() {
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
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
		if (this.selectedData == null) {
			return;
		}
		try {
			await this.engine.restore(this.path, this.selectedData);
			new Notice("Restored " + this.name + " (" + this.formatTimestamp(this.selectedVersion.timestamp) + ")");
			this.close();
		} catch (e) {
			new Notice("AnySocket Sync: couldn't restore (" + (e.message || e.error || e) + ")");
		}
	}
}
