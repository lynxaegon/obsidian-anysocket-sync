// @ts-nocheck
export default class FSAdapter {
	constructor(basePath: string) {
		this.basePath = basePath;
	}

	async makeFolder(path: string) {
		await app.vault.createFolder(this.basePath + path).catch(() => {
			// ignored
		});
	}

	async write(path: string, data: any, mtime: any) {
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
			await app.vault.adapter.write(this.basePath + path, data, options);
		}
		return data;
	}

	async read(path: string) {
		try {
			return await app.vault.adapter.read(this.basePath + path);
		}
		catch(e) {
			return null;
		}
	}

	async exists(path: string) {
		return await app.vault.adapter.exists(this.basePath + path)
	}

	async delete(path: any) {
		await app.vault.delete(this.getFile(path), true)
	}

	async iterate(callback) {
		let files = app.vault.getAllLoadedFiles();
		for(let file of files) {
			await callback(file);
		}
	}

	getFile(path: string) {
		return app.vault.getAbstractFileByPath(path);
	}
}
