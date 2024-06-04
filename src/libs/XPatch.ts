// @ts-ignore
class XPatch {
	create(original: string, target: string) {
		const m = original.length;
		const n = target.length;
		const dp = Array.from(Array(m + 1), () => Array(n + 1).fill(0));

		for (let i = 0; i <= m; i++) {
			for (let j = 0; j <= n; j++) {
				if (i === 0) {
					dp[i][j] = j;
				} else if (j === 0) {
					dp[i][j] = i;
				} else if (original[i - 1] === target[j - 1]) {
					dp[i][j] = dp[i - 1][j - 1];
				} else {
					dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
				}
			}
		}

		let i = m;
		let j = n;
		const patch = [];

		while (i > 0 || j > 0) {
			if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
				patch.unshift({ type: 'remove', index: i - 1, char: original[i - 1] });
				i--;
			} else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
				patch.unshift({ type: 'add', index: i, char: target[j - 1] });
				j--;
			} else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
				patch.unshift({ type: 'replace', index: i - 1, char: original[i - 1], newChar: target[j - 1] });
				i--;
				j--;
			} else {
				i--;
				j--;
			}
		}

		return patch;
	}

	applyPatch(patch: [], string: string) {
		let result = string;
		let offset = 0; // To account for changes in the string length

		for (const step of patch) {
			const { type, index, char, newChar } = step;

			if (type === 'remove') {
				result = result.slice(0, index - offset) + result.slice(index - offset + 1);
				offset++;
			} else if (type === 'add') {
				result = result.slice(0, index - offset) + char + result.slice(index - offset);
				offset--;
			} else if (type === 'replace') {
				result = result.slice(0, index - offset) + newChar + result.slice(index - offset + 1);
			}
		}

		return result;
	}

}

export default new XPatch();
