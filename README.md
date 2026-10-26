<h1 align="center">Obsidian <img src="https://github.com/lynxaegon/obsidian-anysocket-sync/raw/master/icon.svg">AnySocket Sync</h1>
<p align="center">Securely synchronize your Vault on a <a href="https://github.com/lynxaegon/obsidian-anysocket-sync-server">self-hosted server</a></p>
<p align="center">Built with: <a href="https://github.com/lynxaegon/anysocket">anysocket</a></p>

<a name="features"></a>
## Features
* Encrypted sync (AES-256-GCM, between your devices and your server)
* Works offline: changes made while offline sync when you're back
* Nothing is lost when two devices change the same note: changes to different parts are combined, and if both changed the same part, both versions are kept side by side
* Renames keep a file's history
* Version history for every file (images and PDFs too) and recovery of deleted files
* New devices have to be approved from a device that already syncs, or on the server
* A sync panel (click the status bar): what's happening, what needs a look, your devices, recent activity
* Sync all types of files across any device (works on mobile)
* Handles large vaults; phones skip very large files (configurable)
* Supports syncing on demand
* Auto updates when the <a href="https://github.com/lynxaegon/obsidian-anysocket-sync-server">server</a> is updated

_if you find an issue, please <a href="https://github.com/lynxaegon/obsidian-anysocket-sync/issues/new"> create an issue</a>_

## Installation
_Important: **Always backup your vault!**_
1. First install & configure the <a href="https://github.com/lynxaegon/obsidian-anysocket-sync-server">server</a>
2. Now install the plugin in Obsidian (Community Plugins -> `anysocket-sync`)
3. Enable the plugin
4. Go to settings and update the configuration
5. Enable the connection (the first device is approved on its own; approve the others from it)
6. Enjoy!
   
## Screenshots
![Commands](https://github.com/lynxaegon/obsidian-anysocket-sync/raw/master/screenshots/info_1.png)

![Version History](https://github.com/lynxaegon/obsidian-anysocket-sync/raw/master/screenshots/info_2.png)


## License

MIT
