// @ts-nocheck
export default new (class Utils {
	private binaryExtensions = [
		"3dm",
		"3ds",
		"3g2",
		"3gp",
		"7z",
		"a",
		"aac",
		"adp",
		"afdesign",
		"afphoto",
		"afpub",
		"ai",
		"aif",
		"aiff",
		"alz",
		"ape",
		"apk",
		"appimage",
		"ar",
		"arj",
		"asf",
		"au",
		"avi",
		"bak",
		"baml",
		"bh",
		"bin",
		"bk",
		"bmp",
		"btif",
		"bz2",
		"bzip2",
		"cab",
		"caf",
		"cgm",
		"class",
		"cmx",
		"cpio",
		"cr2",
		"cur",
		"dat",
		"dcm",
		"deb",
		"dex",
		"djvu",
		"dll",
		"dmg",
		"dng",
		"doc",
		"docm",
		"docx",
		"dot",
		"dotm",
		"dra",
		"DS_Store",
		"dsk",
		"dts",
		"dtshd",
		"dvb",
		"dwg",
		"dxf",
		"ecelp4800",
		"ecelp7470",
		"ecelp9600",
		"egg",
		"eol",
		"eot",
		"epub",
		"exe",
		"f4v",
		"fbs",
		"fh",
		"fla",
		"flac",
		"flatpak",
		"fli",
		"flv",
		"fpx",
		"fst",
		"fvt",
		"g3",
		"gh",
		"gif",
		"graffle",
		"gz",
		"gzip",
		"h261",
		"h263",
		"h264",
		"icns",
		"ico",
		"ief",
		"img",
		"ipa",
		"iso",
		"jar",
		"jpeg",
		"jpg",
		"jpgv",
		"jpm",
		"jxr",
		"key",
		"ktx",
		"lha",
		"lib",
		"lvp",
		"lz",
		"lzh",
		"lzma",
		"lzo",
		"m3u",
		"m4a",
		"m4v",
		"mar",
		"mdi",
		"mht",
		"mid",
		"midi",
		"mj2",
		"mka",
		"mkv",
		"mmr",
		"mng",
		"mobi",
		"mov",
		"movie",
		"mp3",
		"mp4",
		"mp4a",
		"mpeg",
		"mpg",
		"mpga",
		"mxu",
		"nef",
		"npx",
		"numbers",
		"nupkg",
		"o",
		"odp",
		"ods",
		"odt",
		"oga",
		"ogg",
		"ogv",
		"otf",
		"ott",
		"pages",
		"pbm",
		"pcx",
		"pdb",
		"pdf",
		"pea",
		"pgm",
		"pic",
		"png",
		"pnm",
		"pot",
		"potm",
		"potx",
		"ppa",
		"ppam",
		"ppm",
		"pps",
		"ppsm",
		"ppsx",
		"ppt",
		"pptm",
		"pptx",
		"psd",
		"pya",
		"pyc",
		"pyo",
		"pyv",
		"qt",
		"rar",
		"ras",
		"raw",
		"resources",
		"rgb",
		"rip",
		"rlc",
		"rmf",
		"rmvb",
		"rpm",
		"rtf",
		"rz",
		"s3m",
		"s7z",
		"scpt",
		"sgi",
		"shar",
		"snap",
		"sil",
		"sketch",
		"slk",
		"smv",
		"snk",
		"so",
		"stl",
		"suo",
		"sub",
		"swf",
		"tar",
		"tbz",
		"tbz2",
		"tga",
		"tgz",
		"thmx",
		"tif",
		"tiff",
		"tlz",
		"ttc",
		"ttf",
		"txz",
		"udf",
		"uvh",
		"uvi",
		"uvm",
		"uvp",
		"uvs",
		"uvu",
		"viv",
		"vob",
		"war",
		"wav",
		"wax",
		"wbmp",
		"wdp",
		"weba",
		"webm",
		"webp",
		"whl",
		"wim",
		"wm",
		"wma",
		"wmv",
		"wmx",
		"woff",
		"woff2",
		"wrm",
		"wvx",
		"xbm",
		"xif",
		"xla",
		"xlam",
		"xls",
		"xlsb",
		"xlsm",
		"xlsx",
		"xlt",
		"xltm",
		"xltx",
		"xm",
		"xmind",
		"xpi",
		"xpm",
		"xwd",
		"xz",
		"z",
		"zip",
		"zipx"
	]

	debounce(func: () => void, delay: number) {
		let timeout: number | null = null;
		return () => {
			if (timeout) clearTimeout(timeout);
			timeout = window.setTimeout(() => {
				func();
			}, delay);
		};
	}

	async getSHA(data: any) {
		if(!data)
			return null;

		let sha = await crypto.subtle.digest("SHA-256", new TextEncoder("utf-8").encode(data));
		return Array.prototype.map.call(new Uint8Array(sha), x=>(('00'+x.toString(16)).slice(-2))).join('');
	}

	async getSHABinary(data: Uint8Array) {
		if(!data)
			return null;

		let sha = await crypto.subtle.digest("SHA-256", data);
		return Array.prototype.map.call(new Uint8Array(sha), x=>(('00'+x.toString(16)).slice(-2))).join('');
	}

	// vault-relative paths only: no traversal and no absolute paths
	isSafePath(path: string) {
		if(typeof path !== "string" || path.length === 0 || path.indexOf("\0") !== -1) {
			return false;
		}
		if(/^([\\/]|[a-zA-Z]:)/.test(path)) {
			return false;
		}
		return path.split(/[\\/]/).every(part => part !== ".." && part !== ".");
	}

	// what a 1.6.0 server stores: safe, and no segment named "metadata" (its storage layout uses that name)
	isSyncable(path: string) {
		return this.isSafePath(path) && path.split("/").indexOf("metadata") === -1;
	}

	// "just now", "5 min ago", "2 h ago", "Oct 26"
	ago(time: number) {
		if (!time) {
			return "";
		}
		const s = Math.round((Date.now() - time) / 1000);
		if (s < 45) return "just now";
		if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
		if (s < 86400) return Math.round(s / 3600) + " h ago";
		return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
	}

	randomId(bytes = 16) {
		const data = new Uint8Array(bytes);
		crypto.getRandomValues(data);
		return Array.prototype.map.call(data, x => ("00" + x.toString(16)).slice(-2)).join("");
	}

	// by extension, case-insensitive ("Photo.PNG" is binary too)
	isBinary(path: string) {
		let parts = path.split(".");
		if (parts.length < 2) {
			return false;
		}
		if (!this._binarySet) {
			this._binarySet = new Set(this.binaryExtensions.map(e => e.toLowerCase()));
		}
		return this._binarySet.has(parts[parts.length - 1].toLowerCase());
	}
})();
