// Rebuilds src/data.js from the mod sources and the Temple Design world, so the app's defaults match the game.
// Run with `npm run gen` after the wave table, the mobs, the guns or the Temple's Mob Spawns change.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const HOME = process.env.FA_HOME || os.homedir();
const FA = path.join(HOME, 'FightArenaMod');
const DD = path.join(HOME, 'DynamicDifficultyMod');
const MW = path.join(HOME, 'ModernWarfareMod');
const WORLD = process.env.FA_TEMPLE_REGION
	|| path.join(HOME, 'curseforge/minecraft/Instances/Fight Arena/saves/Temple Design/region');
const NBT = require(path.join(FA, 'tools/temple/nbt.js'));

const read = file => fs.readFileSync(file, 'utf8');
const lang = file => JSON.parse(read(file));

// --- mobs ---

const VANILLA = 'zombie husk drowned skeleton stray wither_skeleton bogged spider cave_spider creeper witch pillager vindicator '
	+ 'evoker illusioner ravager vex phantom blaze ghast magma_cube slime piglin piglin_brute hoglin zoglin zombified_piglin '
	+ 'endermite silverfish enderman shulker guardian elder_guardian warden wither iron_golem';
const FACTIONS = [
	['undead', /undead|skeleton_giant|shade|vampire/],
	['dragons', /dragon|phantom$/],
	['demons', /demon|magma/],
	['giants', /troll|ogre|rogue_golem|temple_golem/],
	['orcs', /orc|uruk/],
	['beasts', /bear|warthog|ravager|hound|spider|widow|brood|shark/],
	['dark', /dark|brute|paladin|captain_dark/],
	['light', /light|king_arthur|gandalf|dixon/],
	['insurgents', /insurgent/],
];
const NOT_MOBS = /thrown_|_rock|fireball|great_arrow|javelin|gate$|carousel|catapult|ballista|shopkeeper|training_dummy|king_arthur|dark_lord|gandalf|dixon|test_zombie/;

function mobs() {
	const out = [];
	for (const id of VANILLA.split(' ')) {
		out.push({id: `minecraft:${id}`, name: id.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '), faction: 'vanilla'});
	}
	const add = (ns, file) => {
		for (const [key, name] of Object.entries(lang(file))) {
			const hit = key.match(new RegExp(`^entity\\.${ns}\\.([a-z0-9_]+)$`));
			if (!hit || NOT_MOBS.test(hit[1])) continue;
			const faction = (FACTIONS.find(([, re]) => re.test(hit[1])) || ['dark'])[0];
			out.push({id: `${ns}:${hit[1]}`, name, faction});
		}
	};
	add('dynamic_difficulty', path.join(DD, 'src/main/resources/assets/dynamic_difficulty/lang/en_us.json'));
	add('fight_arena', path.join(FA, 'src/main/resources/assets/fight_arena/lang/en_us.json'));
	return out;
}

// --- the wave table: Waves.setWave written out as WaveLines, the way Muster records them ---

function contentIds() {
	const source = read(path.join(DD, 'src/main/java/com/wardg/dynamicdifficulty/ModContent.java'));
	const ids = {};
	for (const hit of source.matchAll(/EntityType<[^=]*?>\s+([A-Z0-9_]+)\s*=[\s\S]*?Identifier\.of\([^,]+,\s*"([a-z0-9_]+)"\)/g)) {
		ids[hit[1]] = `dynamic_difficulty:${hit[2]}`;
	}
	return ids;
}

function waves() {
	const ids = contentIds();
	const mob = expr => {
		const vanilla = expr.match(/^EntityType\.([A-Z_]+)$/);
		if (vanilla) return `minecraft:${vanilla[1].toLowerCase()}`;
		const mod = expr.match(/^ModContent\.([A-Z0-9_]+)$/);
		if (mod && ids[mod[1]]) return ids[mod[1]];
		throw new Error(`Unknown mob in wave table: ${expr}`);
	};
	const item = expr => {
		const hit = expr.match(/Items\.([A-Z_]+)$/);
		if (!hit) throw new Error(`Unknown item in wave table: ${expr}`);
		return `minecraft:${hit[1].toLowerCase()}`;
	};
	const line = (kind, id, other, count, count2 = 0) => ({kind, mob: id, other, count, count2});
	const calls = {
		table: ([a, n]) => line('table', mob(a), '', +n),
		exact: ([a, n]) => line('exact', mob(a), '', +n),
		soloOne: ([a, n]) => line('solo_one', mob(a), '', +n),
		tableHolding: ([a, i, n]) => line('holding', mob(a), item(i), +n),
		tableEither: ([a, b, n]) => line('either', mob(a), mob(b), +n),
		tableAxes: ([n]) => line('axes', 'minecraft:pillager', '', +n),
		tableRavagers: ([n]) => line('ravagers', ids.DARK_RAVAGER, '', +n),
		paladins: () => line('paladins', ids.LESSER_DARK_KNIGHT, '', 1),
		darkKnights: () => line('dark_knights', ids.DARK_KNIGHT, '', 1),
	};
	const source = read(path.join(FA, 'src/main/java/com/wardg/fightarena/game/Waves.java'));
	const start = source.indexOf('private static void setWave(int wave, Muster m)');
	const body = source.slice(start, source.indexOf('\n\t}\n', start));
	const out = {};
	let wave = 0;
	for (const row of body.split('\n')) {
		const code = row.replace(/\/\/.*$/, '').trim();
		const opened = code.match(/^case (\d+) ->/);
		if (opened) {
			wave = +opened[1];
			out[wave] = [];
			continue;
		}
		const call = code.match(/^m\.([a-zA-Z]+)\((.*)\);$/);
		if (!call) continue;
		if (!calls[call[1]]) throw new Error(`Unhandled wave rule: m.${call[1]}`);
		out[wave].push(calls[call[1]](call[2] ? call[2].split(/,\s*/) : []));
	}
	if (Object.keys(out).length !== 40) throw new Error(`Expected 40 waves, found ${Object.keys(out).length}`);
	return out;
}

// --- guns armed mobs may carry: MobGuns.primaries and sidearms ---

function guns() {
	const source = read(path.join(MW, 'src/main/java/com/wardg/modernwarfare/registry/ArsenalItems.java'));
	const names = lang(path.join(MW, 'src/main/resources/assets/modern_warfare/lang/en_us.json'));
	const name = id => names[`item.modern_warfare.${id}`] || id;
	const primary = ['shotgun', 'm18_pistol'], sidearm = ['m18_pistol'];
	for (const hit of source.matchAll(/gun\("([a-z0-9_]+)", ArsenalGunItem\.of\(Kind\.([A-Z_]+)/g)) {
		primary.push(hit[1]);
		if (hit[2] === 'PISTOL') sidearm.push(hit[1]);
	}
	primary.push('akimbo_1887');
	const list = ids => ids.map(id => ({id: `modern_warfare:${id}`, name: name(id)}));
	return {primary: list(primary), sidearm: list(sidearm)};
}

// --- the Temple's Mob Spawns, as they stand in the Temple Design world ---

const PATH_CELLS = [[3, 4], [2, 4], [1, 4], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [6, 1]];

function spawns() {
	const out = [];
	for (const file of fs.readdirSync(WORLD).filter(f => /^r\..*\.mca$/.test(f))) {
		const region = fs.readFileSync(path.join(WORLD, file));
		if (region.length < 8192) continue;
		for (let i = 0; i < 1024; i++) {
			const offset = (region.readUInt32BE(i * 4) >>> 8) * 4096;
			if (!offset || region[offset + 4] !== 2) continue;
			const size = region.readUInt32BE(offset);
			const raw = zlib.inflateSync(region.subarray(offset + 5, offset + 4 + size));
			if (!raw.includes('fight_arena:mob_spawn')) continue;
			const entities = NBT.read(raw).v.get('block_entities');
			for (const be of entities ? entities.v.v : []) {
				if (be.get('id').v !== 'fight_arena:mob_spawn') continue;
				const x = be.get('x').v, y = be.get('y').v, z = be.get('z').v;
				const cell = [Math.floor((x + 224) / 64), Math.floor((z + 250) / 64)];
				const step = PATH_CELLS.findIndex(([a, b]) => a === cell[0] && b === cell[1]);
				// Levels stand LEVEL_H = 50 apart from PLAT = 70; under that are the tunnels' alcoves.
				const level = y < 70 ? 0 : Math.min(3, 1 + Math.floor((y - 70) / 50));
				out.push({x, y, z, level, room: step + 1, cell, range: be.get('Range').v,
					entries: be.get('Entries').v.v.map(e => ({mob: e.get('Mob').v, count: e.get('Count').v}))});
			}
		}
	}
	return out.sort((a, b) => a.level - b.level || a.room - b.room || a.x - b.x || a.z - b.z);
}

// --- the Temple's colosseum rooms: their traps, as they stand in the Temple Design world ---

function colosseums() {
	const shapes = ['classic', 'ring', 'column'];
	const out = [];
	for (const file of fs.readdirSync(WORLD).filter(f => /^r\..*\.mca$/.test(f))) {
		const region = fs.readFileSync(path.join(WORLD, file));
		if (region.length < 8192) continue;
		for (let i = 0; i < 1024; i++) {
			const offset = (region.readUInt32BE(i * 4) >>> 8) * 4096;
			if (!offset || region[offset + 4] !== 2) continue;
			const size = region.readUInt32BE(offset);
			const raw = zlib.inflateSync(region.subarray(offset + 5, offset + 4 + size));
			if (!raw.includes('fight_arena:colosseum_trap')) continue;
			const entities = NBT.read(raw).v.get('block_entities');
			for (const be of entities ? entities.v.v : []) {
				if (be.get('id').v !== 'fight_arena:colosseum_trap') continue;
				const x = be.get('x').v, y = be.get('y').v, z = be.get('z').v;
				// A trap stands a block under its floor; the floors stand LEVEL_H = 50 apart from PLAT = 70.
				const level = 1 + Math.floor((y + 1 - 70) / 50);
				out.push({level, shape: shapes[level - 1], x, y, z, middle: [x, z + be.get('Radius').v + 5]});
			}
		}
	}
	return out.sort((a, b) => a.level - b.level);
}

const data = {mobs: mobs(), waves: waves(), guns: guns(), spawns: spawns(), colosseums: colosseums()};
const target = path.join(__dirname, '../src/data.js');
fs.writeFileSync(target, '// Generated by tools/gen-data.js - do not edit by hand.\n'
	+ `const DATA = ${JSON.stringify(data)};\nif (typeof module !== 'undefined') module.exports = DATA;\n`);
console.log(`${data.mobs.length} mobs, 40 waves, ${data.guns.primary.length} guns, ${data.spawns.length} Mob Spawns, ${data.colosseums.length} colosseum rooms -> ${target}`);
