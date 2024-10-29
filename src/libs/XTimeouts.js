module.exports = class XTimeouts{
    constructor() {
        this.timeouts = {};
		this.callbacks = {};
    }

	execute(key) {
		if(this.callbacks[key]) {
			this.callbacks[key]();
		}
	}

	executeAll() {
		for(let key in this.timeouts) {
			this.execute(key);
		}
	}

    set(key, timeout, callback) {
		this.clear(key);

		this.callbacks[key] = () => {
			this.clear(key);
			callback();
		};
        this.timeouts[key] = setTimeout(this.callbacks[key].bind(this), timeout);
    }

    clear(key) {
		clearTimeout(this.timeouts[key]);
		delete this.timeouts[key];
		delete this.callbacks[key];
    }

    clearAll() {
        for(let key in this.timeouts) {
            this.clear(key);
        }
    }
}
