// Draws the Map tab: each level of the Temple from above, from the blocks in the Temple Design world, with the roof off.
// Writes src/map/level*.png and src/mapdata.js. Part of `npm run gen`; close the game first.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {readBox} = require('./temple-world.js');

const HOME = process.env.FA_HOME || os.homedir();
const FA = path.join(HOME, 'FightArenaMod');
const WORLD = process.env.FA_TEMPLE_REGION || path.join(HOME, 'curseforge/minecraft/Instances/Fight Arena/saves/Temple Design/region');
const NBT = require(path.join(FA, 'tools/temple/nbt.js'));
const DATA = require('../src/data.js');
const OUT = path.join(__dirname, '../src/map');

/** Pixels a block. */
const SCALE = 4;
/** The grid of TempleGenerator: TX0, TZ0 and CELL. */
const TX0 = -224, TZ0 = -250, CELL = 64;
const BUILDING = {x0: -245, x1: 245, z0: -270, z1: 105};
/** What each level's plan looks down through. The tops stop short of the next level's floor and its pits, and of the roof. */
const LEVELS = {
	1: {...BUILDING, y0: 60, y1: 112},
	2: {...BUILDING, y0: 116, y1: 162},
	3: {...BUILDING, y0: 166, y1: 219},
};

const WALL = 0, FLOOR = 1, LAVA = 2, WATER = 3, DROP = 4, DOOR = 5, GATE = 6, FIXTURE = 7, GREEN = 8;
const MASS = 9;

const SEE_THROUGH = /:(air|cave_air|void_air|light_helper|light_source|light|chain|lantern|soul_lantern|torch|wall_torch|.*_sign|.*_banner|cobweb|vine|ladder|.*_carpet|.*_button|lever|lightning_rod|candle|short_grass|cornflower|oxeye_daisy|allium|skeleton_skull|mob_spawn|swingshot_node|special_part|special_block|colosseum_trap|iron_bars)$/;
const DOORS = /sliding_door|iron_door/;
const GATES = /temple_gate/;
const FIXTURES = /bookshelf|barrel|grindstone|anvil|fletching_table|smithing_table|crafting_table|smoker|furnace|bed$|chest$|cauldron|hay_block|dining_|plate|campfire|potted_|wardrobe|leaderboard|control_panel|carousel|crucible|mold/;
const GREENS = /leaves|grass_block|moss_block|_log$/;

function plan(level) {
	const box = LEVELS[level];
	const world = readBox(NBT, WORLD, box);
	const see = world.names.map(n => SEE_THROUGH.test(n));
	const door = world.names.map(n => DOORS.test(n)), gate = world.names.map(n => GATES.test(n));
	const lava = world.names.map(n => n === 'minecraft:lava'), water = world.names.map(n => n === 'minecraft:water');
	const fixture = world.names.map(n => FIXTURES.test(n)), green = world.names.map(n => GREENS.test(n));
	const open = id => see[id] || door[id] || gate[id];
	const w = world.sx, h = world.sz;
	const kind = new Uint8Array(w * h), top = new Int16Array(w * h);
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			const wx = box.x0 + x, wz = box.z0 + z;
			let y = box.y1, found = WALL, doorway = -1;
			// Through any ceiling to the room under it, then down to what stands in that room.
			while (y >= box.y0 && !open(world.at(wx, y, wz))) y--;
			for (; y >= box.y0; y--) {
				const id = world.at(wx, y, wz);
				if (door[id] || gate[id]) {
					doorway = gate[id] ? GATE : DOOR;
					continue;
				}
				if (see[id]) continue;
				found = lava[id] ? LAVA : water[id] ? WATER : fixture[id] ? FIXTURE : green[id] ? GREEN : FLOOR;
				break;
			}
			const seen = y >= box.y0;
			kind[x + w * z] = doorway >= 0 ? doorway : seen ? found : open(world.at(wx, box.y0, wz)) ? DROP : WALL;
			top[x + w * z] = seen ? y : box.y0;
		}
	}
	return {box, w, h, kind, top, entities: world.entities};
}

/** Blocks to the nearest wall, for every open block; and for every wall, to the nearest open block. */
function distances({w, h, kind}, from) {
	const d = new Float32Array(w * h).fill(1e6);
	for (let i = 0; i < w * h; i++) if (from(kind[i])) d[i] = 0;
	const step = (i, j, c) => {
		if (j >= 0 && j < w * h && d[j] + c < d[i]) d[i] = d[j] + c;
	};
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			const i = x + w * z;
			if (x) step(i, i - 1, 1);
			if (z) step(i, i - w, 1);
			if (x && z) step(i, i - w - 1, 1.41);
			if (z && x < w - 1) step(i, i - w + 1, 1.41);
		}
	}
	for (let z = h - 1; z >= 0; z--) {
		for (let x = w - 1; x >= 0; x--) {
			const i = x + w * z;
			if (x < w - 1) step(i, i + 1, 1);
			if (z < h - 1) step(i, i + w, 1);
			if (x < w - 1 && z < h - 1) step(i, i + w + 1, 1.41);
			if (z < h - 1 && x) step(i, i + w - 1, 1.41);
		}
	}
	return d;
}

// --- the picture ---

const hex = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
const COLORS = {
	[WALL]: hex('#3a312a'), [MASS]: hex('#1f1a17'), [FLOOR]: hex('#5d5349'), [LAVA]: hex('#e8682a'), [WATER]: hex('#3f86c4'), [DROP]: hex('#0c0a09'),
	[DOOR]: hex('#7fbf7a'), [GATE]: hex('#e8604f'), [FIXTURE]: hex('#8a6c4c'), [GREEN]: hex('#5e8a4e'),
};
const EDGE = hex('#d9ccba');

/** The open air round the building: drops that reach the picture's edge. */
function skyOf({w, h, kind}) {
	const sky = new Uint8Array(w * h), stack = [];
	const add = i => {
		if (kind[i] === DROP && !sky[i]) {
			sky[i] = 1;
			stack.push(i);
		}
	};
	for (let x = 0; x < w; x++) {
		add(x);
		add(x + w * (h - 1));
	}
	for (let z = 0; z < h; z++) {
		add(w * z);
		add(w - 1 + w * z);
	}
	while (stack.length) {
		const i = stack.pop(), x = i % w;
		if (x) add(i - 1);
		if (x < w - 1) add(i + 1);
		if (i >= w) add(i - w);
		if (i < w * (h - 1)) add(i + w);
	}
	return sky;
}

function paint(p) {
	const {w, h, kind, top, box} = p;
	const near = distances(p, k => k !== WALL);
	const W = w * SCALE, H = h * SCALE;
	const rgba = Buffer.alloc(W * H * 4);
	const span = Math.max(1, box.y1 - box.y0);
	const sky = skyOf(p);
	const at = (x, z) => (x < 0 || z < 0 || x >= w || z >= h ? -1 : x + w * z);
	const wallAt = (x, z) => {
		const i = at(x, z);
		return i < 0 || kind[i] === WALL;
	};
	for (let z = 0; z < h; z++) {
		for (let x = 0; x < w; x++) {
			const i = x + w * z;
			let k = kind[i];
			if (k === WALL && near[i] > 7) k = MASS;
			let color = COLORS[k];
			if (k === FLOOR || k === FIXTURE || k === GREEN || k === LAVA || k === WATER) {
				// Higher is lighter, and each rise catches the light from the top left.
				const lift = (top[i] - box.y0) / span, a = at(x - 1, z - 1);
				const rise = a >= 0 && kind[a] !== WALL && kind[a] !== DROP ? Math.max(-3, Math.min(3, top[i] - top[a])) : 0;
				const shade = (k === LAVA || k === WATER ? 0.92 : 0.72 + lift * 0.62) + rise * 0.1;
				color = color.map(c => Math.min(255, Math.round(c * shade)));
			}
			for (let oz = 0; oz < SCALE; oz++) {
				for (let ox = 0; ox < SCALE; ox++) {
					const o = ((z * SCALE + oz) * W + x * SCALE + ox) * 4;
					let c = color, alpha = sky[i] ? 0 : 255;
					if (k === DROP && (x * SCALE + ox + z * SCALE + oz) % 10 < 2) c = hex('#3a312a');
					if (kind[i] !== WALL && ((ox === 0 && wallAt(x - 1, z)) || (ox === SCALE - 1 && wallAt(x + 1, z)) || (oz === 0 && wallAt(x, z - 1)) || (oz === SCALE - 1 && wallAt(x, z + 1)))) {
						c = EDGE;
						alpha = 255;
					}
					rgba[o] = c[0];
					rgba[o + 1] = c[1];
					rgba[o + 2] = c[2];
					rgba[o + 3] = alpha;
				}
			}
		}
	}
	return png(W, H, rgba);
}

function crc32(buf) {
	let c, crc = 0xffffffff;
	for (const byte of buf) {
		c = (crc ^ byte) & 255;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		crc = (crc >>> 8) ^ c;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function png(w, h, rgba) {
	const chunk = (type, data) => {
		const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
		out.writeUInt32BE(data.length, 0);
		body.copy(out, 4);
		out.writeUInt32BE(crc32(body), body.length + 4);
		return out;
	};
	const head = Buffer.alloc(13);
	head.writeUInt32BE(w, 0);
	head.writeUInt32BE(h, 4);
	head.set([8, 6, 0, 0, 0], 8);
	const raw = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) {
		const row = y * (w * 4 + 1);
		raw[row] = 2;
		for (let i = 0; i < w * 4; i++) raw[row + 1 + i] = (rgba[y * w * 4 + i] - (y ? rgba[(y - 1) * w * 4 + i] : 0)) & 255;
	}
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}

// --- the rooms, as the generator planned them ---

const NAMES = {ENTRANCE: 'Entrance', ARENA: 'Combat Arena', GARDEN: 'Garden', LIBRARY: 'Library', GOLEM: 'Golem Room', GOLEM2: 'Golem Room 2', MASSIVE: 'Great Hall', CRUCIBLE: 'Crucible Rotation',
	SAFE: 'Safe Room', STAIRWELL: 'Stairs Up', CHAPEL: 'Chapel', ARMORY: 'Armory', OVER: 'High Bridge', ROTUNDA: 'Rotunda', HYPOSTYLE: 'Hypostyle Hall', COLONNADE: 'Colonnade', PRISON: 'Prison',
	TREASURY: 'Treasury', BARRACKS: 'Barracks', CRYPT: 'Crypt', POOL: 'Pool', KITCHEN: 'Kitchen', THRONE: 'Throne Room', PF1: 'Parkour: Lava', PF2: 'Parkour: Void', PF3: 'Parkour: Lava',
	PF5: 'Parkour: Lava', PF6: 'Parkour: Lava', PF7: 'Parkour: Lava', PF8: 'Parkour: Void'};
const SORTS = {SAFE: 'safe', STAIRWELL: 'stairs', ENTRANCE: 'start', ARENA: 'fight', GOLEM: 'puzzle', GOLEM2: 'puzzle', CRUCIBLE: 'parkour', PF1: 'parkour', PF2: 'parkour', PF3: 'parkour', PF5: 'parkour',
	PF6: 'parkour', PF7: 'parkour', PF8: 'parkour', THRONE: 'fight'};
const SHAPES = {classic: 'Standard', ring: 'Ring', column: 'Cylinder'};
const COLOSSEUM_REACH = 86;

function rooms() {
	const dir = path.join(FA, 'docs/temple');
	const version = Math.max(...fs.readdirSync(dir).map(f => +(f.match(/^layout_v(\d+)\.txt$/) || [0, 0])[1]));
	const out = {1: [], 2: [], 3: []};
	for (const row of fs.readFileSync(path.join(dir, `layout_v${version}.txt`), 'utf8').trim().split('\n')) {
		const hit = row.trim().match(/^\d+ level (\d) cell (\S+) (\w+) floor (\d+) height (\d+)(.*)$/);
		if (!hit) throw new Error(`Unread layout row: ${row}`);
		const kind = hit[3];
		if (!NAMES[kind]) throw new Error(`No name for the room kind ${kind}`);
		out[hit[1]].push({kind, name: NAMES[kind], sort: SORTS[kind] || 'room', floor: +hit[4], height: +hit[5], cells: hit[2].split('+').map(c => c.split(',').map(Number)), tags: hit[6].trim().split(/\s+/).filter(Boolean)});
	}
	for (const c of DATA.colosseums) {
		const list = out[c.level];
		list.splice(list.findIndex(r => r.kind === 'SAFE'), 0, {kind: 'COLOSSEUM', name: `Colosseum: ${SHAPES[c.shape]}`, sort: 'colosseum', floor: c.y + 1, height: 46, cells: [], tags: [],
			box: [c.middle[0] - COLOSSEUM_REACH, c.middle[1] - COLOSSEUM_REACH, c.middle[0] + COLOSSEUM_REACH, c.middle[1] + COLOSSEUM_REACH], colosseum: c.level});
	}
	return {version, rooms: out};
}

/** A room's walls: its cells' open blocks, less the rows and columns only a hallway runs along. */
function fit(room, p) {
	if (room.box) return room.box;
	const {box, w, kind} = p;
	const x0 = Math.min(...room.cells.map(c => TX0 + c[0] * CELL)), x1 = Math.max(...room.cells.map(c => TX0 + c[0] * CELL + CELL - 1));
	const z0 = Math.min(...room.cells.map(c => TZ0 + c[1] * CELL)), z1 = Math.max(...room.cells.map(c => TZ0 + c[1] * CELL + CELL - 1));
	const open = (x, z) => kind[(x - box.x0) + w * (z - box.z0)] !== WALL;
	const wide = 13;
	const rows = [], cols = [];
	for (let z = z0; z <= z1; z++) {
		let n = 0;
		for (let x = x0; x <= x1; x++) if (open(x, z)) n++;
		if (n >= wide) rows.push(z);
	}
	for (let x = x0; x <= x1; x++) {
		let n = 0;
		for (let z = z0; z <= z1; z++) if (open(x, z)) n++;
		if (n >= wide) cols.push(x);
	}
	if (!rows.length || !cols.length) return [x0 + 6, z0 + 6, x1 - 6, z1 - 6];
	return [cols[0], rows[0], cols[cols.length - 1] + 1, rows[rows.length - 1] + 1];
}

// --- the way through: the shortest walk from room to room, kept to the middle of the halls ---

function walker(p) {
	const {w, h, kind} = p;
	const clear = distances(p, k => k === WALL);
	const nearestOpen = (x, z) => {
		const cx = x - p.box.x0, cz = z - p.box.z0;
		let best = -1, score = -1;
		for (let oz = -24; oz <= 24; oz++) {
			for (let ox = -24; ox <= 24; ox++) {
				const nx = cx + ox, nz = cz + oz;
				if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
				const i = nx + w * nz;
				if (kind[i] === WALL) continue;
				const value = Math.min(clear[i], 4) * 4 - Math.hypot(ox, oz);
				if (value > score || best < 0) {
					score = value;
					best = i;
				}
			}
		}
		return best;
	};
	const walk = (from, to) => {
		const tx = to % w, tz = (to - tx) / w;
		const cost = new Float64Array(w * h).fill(Infinity), back = new Int32Array(w * h).fill(-1), done = new Uint8Array(w * h);
		// A binary heap of open blocks, by what they have cost plus the straight way left.
		const heap = [from], rank = new Float64Array(w * h);
		cost[from] = 0;
		const swap = (a, b) => {
			const held = heap[a];
			heap[a] = heap[b];
			heap[b] = held;
		};
		const push = i => {
			heap.push(i);
			for (let k = heap.length - 1; k > 0;) {
				const up = (k - 1) >> 1;
				if (rank[heap[up]] <= rank[heap[k]]) break;
				swap(up, k);
				k = up;
			}
		};
		const pop = () => {
			const best = heap[0], end = heap.pop();
			if (heap.length) {
				heap[0] = end;
				for (let k = 0; ;) {
					const a = k * 2 + 1, b = a + 1;
					let low = k;
					if (a < heap.length && rank[heap[a]] < rank[heap[low]]) low = a;
					if (b < heap.length && rank[heap[b]] < rank[heap[low]]) low = b;
					if (low === k) break;
					swap(low, k);
					k = low;
				}
			}
			return best;
		};
		while (heap.length) {
			const at = pop();
			if (at === to) break;
			if (done[at]) continue;
			done[at] = 1;
			const x = at % w, z = (at - x) / w;
			for (let oz = -1; oz <= 1; oz++) {
				for (let ox = -1; ox <= 1; ox++) {
					if (!ox && !oz) continue;
					const nx = x + ox, nz = z + oz;
					if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
					const i = nx + w * nz;
					if (kind[i] === WALL || done[i]) continue;
					const next = cost[at] + (ox && oz ? 1.41 : 1) * (1 + 7 / (clear[i] + 0.5));
					if (next < cost[i]) {
						cost[i] = next;
						back[i] = at;
						rank[i] = next + Math.hypot(nx - tx, nz - tz);
						push(i);
					}
				}
			}
		}
		if (back[to] < 0 && to !== from) return null;
		const line = [];
		for (let at = to; at !== -1; at = back[at]) line.unshift([p.box.x0 + at % w + 0.5, p.box.z0 + Math.floor(at / w) + 0.5]);
		return line;
	};
	return {nearestOpen, walk};
}

function simpler(line, tolerance) {
	if (line.length < 3) return line;
	const [ax, az] = line[0], [bx, bz] = line[line.length - 1];
	const len = Math.hypot(bx - ax, bz - az) || 1;
	let far = 0, at = 0;
	for (let i = 1; i < line.length - 1; i++) {
		const d = Math.abs((bx - ax) * (az - line[i][1]) - (ax - line[i][0]) * (bz - az)) / len;
		if (d > far) {
			far = d;
			at = i;
		}
	}
	if (far <= tolerance) return [line[0], line[line.length - 1]];
	return [...simpler(line.slice(0, at + 1), tolerance).slice(0, -1), ...simpler(line.slice(at), tolerance)];
}

// --- away ---

fs.mkdirSync(OUT, {recursive: true});
const {version, rooms: planned} = rooms();
const map = {version, scale: SCALE, levels: {}};
for (const level of [1, 2, 3]) {
	const p = plan(level);
	fs.writeFileSync(path.join(OUT, `level${level}.png`), paint(p));
	const list = planned[level];
	const {nearestOpen, walk} = walker(p);
		const route = [], locked = [];
	for (const room of list) {
		room.box = fit(room, p);
		room.at = [Math.round((room.box[0] + room.box[2]) / 2), Math.round((room.box[1] + room.box[3]) / 2)];
	}
	for (let k = 0; k + 1 < list.length; k++) {
		const leg = walk(nearestOpen(...list[k].at), nearestOpen(...list[k + 1].at));
		if (leg) route.push(simpler(leg, 1.2));
		// Golem Room 2's way out is walled up until he is mended.
		else locked.push([list[k].at, list[k + 1].at]);
	}
	map.levels[level] = {x0: p.box.x0, z0: p.box.z0, w: p.w, h: p.h,
		rooms: list.map(({cells, ...room}) => room), route, locked,
		chests: p.entities.filter(e => /:(chest|munitions_chest)$/.test(e.id)).map(e => [e.x, e.z])};
	console.log(`Level ${level}: ${list.length} rooms, ${map.levels[level].chests.length} chests, ${fs.statSync(path.join(OUT, `level${level}.png`)).size >> 10} KB`);
}
const target = path.join(__dirname, '../src/mapdata.js');
fs.writeFileSync(target, `// Generated by tools/gen-map.js - do not edit by hand.\nconst MAPDATA = ${JSON.stringify(map)};\nif (typeof module !== 'undefined') module.exports = MAPDATA;\n`);
console.log(`Temple v${version} -> ${target}`);
