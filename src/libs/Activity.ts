// @ts-nocheck
import EventEmitter from "./Events";

export interface ActivityItem {
	type: string;
	path: string;
	extra?: string;
	at: number;
}

const LIMIT = 50;

/** The last things sync did, for the sync panel. */
export default class Activity extends EventEmitter {
	items: ActivityItem[] = [];

	add(type: string, path: string, extra?: string) {
		this.items.unshift({ type, path, extra, at: Date.now() });
		if (this.items.length > LIMIT) {
			this.items.length = LIMIT;
		}
		this.emit("change");
	}

	clear() {
		this.items = [];
		this.emit("change");
	}

	// "Downloaded", "Renamed from X", ... as a short sentence
	static describe(item: ActivityItem) {
		const name = item.path.split("/").pop();
		switch (item.type) {
			case "downloaded": return { icon: "arrow-down", text: "Got " + name };
			case "updated": return { icon: "arrow-down", text: "Got the newer " + name + " (yours is in its history)" };
			case "uploaded": return { icon: "arrow-up", text: "Sent " + name };
			case "deleted": return { icon: "trash-2", text: "Deleted " + name };
			case "deleted_remote": return { icon: "trash-2", text: "Deleted " + name + " everywhere" };
			case "renamed": return { icon: "pencil", text: "Renamed " + (item.extra ? item.extra.split("/").pop() + " → " : "") + name };
			case "merged": return { icon: "git-merge", text: "Combined changes from two devices in " + name };
			case "kept_both": return { icon: "copy", text: name + " changed on two devices, both versions kept" };
			case "restored": return { icon: "undo-2", text: "Kept " + name + ": it was changed on another device" };
			case "failed": return { icon: "alert-triangle", text: "Couldn't sync " + name + (item.extra ? " (" + item.extra + ")" : "") };
		}
		return { icon: "dot", text: item.type + " " + name };
	}
}
