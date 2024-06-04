// @ts-nocheck
import FSAdapter from "./FSAdapter";

export default class Storage {
	static tree: any = null;
	fsVault: FSAdapter;
	fsInternal: FSAdapter;
	private inited = false;

	constructor() {
		this.fsVault = new FSAdapter("./");
		this.fsInternal = new FSAdapter(".obsidian/plugins/obsidian-anysocket-sync/");
	}

	async init() {
		if(this.inited)
			return;

		this.tree = {};
		// this.tree = await this.fsInternal.read("vault_index.json");
		// if(!this.tree) {
		// 	this.tree = "{}";
		// }
		// this.tree = JSON.parse(this.tree);
		this.inited = true;
	}

	async write(path: string, data: string, metadata: any) {
		await this.writeMetadata(path, metadata);
		return await this.fsVault.write(path, data, metadata.mtime);
	}

	async read(path: string) {
		return await this.fsVault.read(path);
	}

	async delete(path: string, metadata: any) {
		console.log("deleting", path, "metadata", metadata);

		await this.writeMetadata(path, metadata);
		return await this.fsVault.delete(path);
	}

	async exists(path: string) {
		return await this.fsVault.exists(path);
	}

	async iterate(callback: any) {
		await this.fsVault.iterate(async (item) => {
			// skip root
			if(item.path == "/")
				return;
			await callback(item);
		});
	}

	async readMetadata(path: string) {
		if(!this.tree[path]) {
			return null;
		}

		return this.tree[path];
	}

	async writeMetadata(path: string, metadata: any) {
		if(!this.tree[path]) {
			this.tree[path] = {};
		}
		for(let key in metadata) {
			this.tree[path][key] = metadata[key];
		}

		// await this.fsInternal.write("vault_index.json", JSON.stringify(this.tree));
		return this.tree[path];
	}

	async updatePlugin(files) {
		for(let item of files) {
			await this.fsInternal.write(item.path, item.data);
		}
	}
}
