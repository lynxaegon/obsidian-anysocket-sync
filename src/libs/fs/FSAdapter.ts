// @ts-nocheck
import {normalizePath} from "obsidian";

export default class FSAdapter {
	constructor(basePath: string) {
		this.basePath = basePath;
	}

	async makeFolder(path: string) {
		await app.vault.createFolder(normalizePath(this.basePath + path)).catch(() => {
			// ignored
		});
	}

	async write(path: string, data: string, mtime: number) {
		if(!await this.exists(path)) {
			let folder = path.split("/").slice(0, -1).join("/");
			if(folder) {
				await this.makeFolder(folder);
			}
		}
		if(data != null) {
			let options = null;
			if(mtime) {
				options = {
					mtime: mtime
				};
			}
			await app.vault.adapter.write(normalizePath(this.basePath + path), data, options);
		}
		return data;
	}

	async read(path: string) {
		try {
			return await app.vault.adapter.read(normalizePath(this.basePath + path));
		}
		catch(e) {
			return null;
		}
	}

	async exists(path: string) {
		return await app.vault.adapter.exists(normalizePath(this.basePath + path));
	}

	async delete(path: string) {
		await app.fileManager.trashFile(this.getFile(path));
	}

	async iterate(callback) {
		let files = app.vault.getAllLoadedFiles();
		for(let file of files) {
			await callback(file);
		}
	}

	getFile(path: string) {
		return app.vault.getAbstractFileByPath(normalizePath(path));
	}
}
