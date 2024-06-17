import esbuild from "esbuild";
import process from "process";
import builtins from 'builtin-modules'
import {fileURLToPath} from 'url';
import path from 'path'
import fs from 'fs'

const banner =
`/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;

const prod = (process.argv[2] === 'production');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


let developmentPlugin = {
	name: 'developmentPlugin',
	setup(build) {
		const BUILD_DIR = __dirname + "/";
		const SERVER_DIR = __dirname + "/../obsidian-anysocket-sync-server/client/";
		build.onEnd(result => {
			const VERSION = JSON.parse(fs.readFileSync("./package.json", "utf-8")).version;
			const BUILD = Date.now();

			// auto update VERSION from package.json
			const manifest = JSON.parse(fs.readFileSync("./manifest.json", "utf-8"));
			manifest.version = VERSION;
			fs.writeFileSync("./manifest.json", JSON.stringify(manifest, null, "\t"), "utf-8");

			// auto update versions.json with supported versins
			const supportedVersions = JSON.parse(fs.readFileSync("./versions.json", "utf-8"));
			supportedVersions[manifest.version] = manifest.minAppVersion;
			fs.writeFileSync("./versions.json", JSON.stringify(supportedVersions, null, "\t"), "utf-8");


			fs.writeFileSync(BUILD_DIR + "main.js", fs.readFileSync(BUILD_DIR + "main.js", "utf-8")
				.replaceAll("__anysocketsync_version__", "" + VERSION)
				.replaceAll("__anysocketsync_build__", "" + BUILD))


			fs.copyFileSync(BUILD_DIR + "main.js", SERVER_DIR  + "main.js");
			fs.copyFileSync(BUILD_DIR + "styles.css", SERVER_DIR + "styles.css");
			fs.copyFileSync(BUILD_DIR + "manifest.json", SERVER_DIR + "manifest.json");
			fs.writeFileSync(SERVER_DIR + "build_info.json", JSON.stringify({
				version: VERSION,
				build: BUILD
			}));

			// update server version
			const serverPackage = JSON.parse(fs.readFileSync("../obsidian-anysocket-sync-server/package.json", "utf-8"));
			serverPackage.version = manifest.version;
			fs.writeFileSync("../obsidian-anysocket-sync-server/package.json", JSON.stringify(serverPackage, null, "\t"), "utf-8");

			// copy client files to server, for auto update
			const LOCAL_DIR = "C:\\Users\\andre\\Dropbox\\__andrei\\obsidian\\Personal\\.obsidian\\plugins\\anysocket-sync\\";
			fs.copyFileSync(BUILD_DIR + "main.js", LOCAL_DIR + "main.js");
			fs.copyFileSync(BUILD_DIR + "styles.css", LOCAL_DIR + "styles.css");
			fs.copyFileSync(BUILD_DIR + "manifest.json", LOCAL_DIR + "manifest.json");
		});
	},
}

esbuild.build({
	banner: {
		js: banner,
	},
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
		...builtins],
	format: 'cjs',
	watch: !prod,
	target: 'es2018',
	logLevel: "info",
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	plugins: [developmentPlugin],
}).catch(() => process.exit(1));
