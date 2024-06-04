// @ts-nocheck
export default new (class Utils {
	async getSHA(data: any) {
		if(!data)
			return null;

		let sha = await crypto.subtle.digest("SHA-256", new TextEncoder("utf-8").encode(data));
		return Array.prototype.map.call(new Uint8Array(sha), x=>(('00'+x.toString(16)).slice(-2))).join('');
	}
})();
