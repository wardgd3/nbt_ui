// Reads a box of the Temple Design world's blocks from its region files, for tools/gen-map.js.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/** The box as one block id per position, the names in `names`; chests and the like in `entities`. Whatever is unbuilt reads as air, id 0. */
function readBox(NBT, dir, box) {
	const {x0, x1, y0, y1, z0, z1} = box;
	const sx = x1 - x0 + 1, sy = y1 - y0 + 1, sz = z1 - z0 + 1;
	const blocks = new Uint16Array(sx * sy * sz);
	const names = ['minecraft:air'], ids = new Map([['minecraft:air', 0]]), entities = [];
	const idOf = name => {
		if (!ids.has(name)) {
			ids.set(name, names.length);
			names.push(name);
		}
		return ids.get(name);
	};
	for (const file of fs.readdirSync(dir).filter(f => /^r\..*\.mca$/.test(f))) {
		const region = fs.readFileSync(path.join(dir, file));
		if (region.length < 8192) continue;
		for (let i = 0; i < 1024; i++) {
			const offset = (region.readUInt32BE(i * 4) >>> 8) * 4096;
			if (!offset || region[offset + 4] !== 2) continue;
			const root = NBT.read(zlib.inflateSync(region.subarray(offset + 5, offset + 4 + region.readUInt32BE(offset)))).v;
			const cx = root.get('xPos').v * 16, cz = root.get('zPos').v * 16;
			if (cx + 15 < x0 || cx > x1 || cz + 15 < z0 || cz > z1) continue;
			for (const be of root.get('block_entities')?.v.v || []) {
				const x = be.get('x').v, y = be.get('y').v, z = be.get('z').v;
				if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1) entities.push({id: be.get('id').v, x, y, z});
			}
			for (const section of root.get('sections').v.v) {
				const states = section.get('block_states');
				const base = section.get('Y').v * 16;
				if (!states || base + 15 < y0 || base > y1) continue;
				const palette = states.v.get('palette').v.v.map(p => idOf(p.get('Name').v));
				const data = states.v.get('data')?.v;
				const bits = Math.max(4, Math.ceil(Math.log2(palette.length))), per = Math.floor(64 / bits), mask = (1n << BigInt(bits)) - 1n;
				for (let k = 0; k < 4096; k++) {
					const y = base + (k >> 8), z = cz + ((k >> 4) & 15), x = cx + (k & 15);
					if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue;
					let at = 0;
					if (palette.length > 1) at = Number((BigInt.asUintN(64, BigInt(data[Math.floor(k / per)])) >> BigInt((k % per) * bits)) & mask);
					blocks[(x - x0) + sx * ((z - z0) + sz * (y - y0))] = palette[at];
				}
			}
		}
	}
	return {blocks, names, entities, sx, sy, sz, at: (x, y, z) => blocks[(x - x0) + sx * ((z - z0) + sz * (y - y0))]};
}

module.exports = {readBox};
