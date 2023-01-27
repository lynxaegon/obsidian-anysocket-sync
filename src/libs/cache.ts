import {TFile} from "obsidian";

export default class XCache {
	constructor() {
	}

	getFile(path: string) {
		return app.vault.getAbstractFileByPath(path);
	}

	async iterateFiles(callback: any) {
		let files = app.vault.getFiles();
		for(let file of files) {
			await callback(file);
		}
	}

	async read(path: string) {
		let file: TFile | undefined = this.getFile(path);
		if(file) {
			return await app.vault.cachedRead(file);
		}
		return null;
	}

	async write(path: any, data: string, mtime: number) {
		let file = this.getFile(path);
		if(file) {
			await app.vault.modify(file, data, {
				mtime: mtime
			});
		} else {
			let folder = path.split("/").slice(0, -1).join("/");
			if(folder) {
				await app.vault.createFolder(folder).catch(() => {
					// ignored
				});
			}
			await app.vault.create(path, data, {
				mtime: mtime
			});
		}

		return true;
	}

	async delete(path: any) {
		await app.vault.delete(this.getFile(path), true);
	}
}
