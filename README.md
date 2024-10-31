<h1 align="center">Obsidian <img src="https://github.com/lynxaegon/obsidian-anysocket-sync/raw/master/icon.svg">AnySocket Sync</h1>
<p align="center">Securely synchronize your Vault on a <a href="https://github.com/lynxaegon/obsidian-anysocket-sync-server">self-hosted server</a></p>
<p align="center">Built with: <a href="https://github.com/lynxaegon/anysocket">anysocket</a></p>

<a name="features"></a>
## Features
* E2E encrypted Sync (transport layer)
* Connect as many devices as you like
* Sync all types of files across any device (works on mobile)
* Version History (customizable retention)
* Recover deleted files (customizable retention)
* Supports syncing on demand
* Works offline
* Auto updates when <a href="https://github.com/lynxaegon/obsidian-anysocket-sync-server">server</a> is updated

_**Info**: This is not a CRDT Sync (like GDocs), it's a file sync so conflicts can happen if you edit the same file on multiple devices at the same time. 
Conflict resolution is **last write wins**_ 

Coming soon:
* Don't lose history on rename
* 2FA for allowing other devices (increased protection)
* Plugins sync

Known issues:
- History is lost on rename (WIP)

_if you find others, please <a href="https://github.com/lynxaegon/obsidian-anysocket-sync/issues/new"> create an issue</a>_

## Installation
_Important: **Always backup your vault!**_
1. First install & configure the <a href="https://github.com/lynxaegon/obsidian-anysocket-sync-server">server</a>
2. Now install the plugin in Obsidian (Community Plugins -> `anysocket-sync`)
3. Enable the plugin
4. Go to settings and update the configuration
5. Enable Sync
6. Enjoy!
   
## Screenshots
![Commands](https://github.com/lynxaegon/obsidian-anysocket-sync/raw/master/screenshots/info_1.png)

![Version History](https://github.com/lynxaegon/obsidian-anysocket-sync/raw/master/screenshots/info_2.png)


## License

MIT
