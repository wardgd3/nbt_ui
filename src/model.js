// The three documents the app edits, to and from the files the game reads. Limits and tag names follow the mod:
// ColosseumConfig, WaveLine, WaveBook, MobTunes, WaveBook's Temple settings and MobSpawnBlockEntity.
const Model = (() => {
	const D = typeof DATA !== 'undefined' ? DATA : require('./data.js');
	const N = typeof NBT !== 'undefined' ? NBT : require('./nbt.js');

	const LIMITS = {
		lines: 64, count: 200, cells: 15, roomGates: 4, roomRounds: 15, roomCells: 60,
		delay: [1, 320], startDelay: [0, 320], raise: [1, 30], reward: [0, 1000000],
		spawnRange: [2, 64], spawnCount: [1, 64],
		bossScale: [0.5, 16], bossHealth: [20, 50000], lives: [1, 10], safeReward: [0, 50000],
		size: [0.25, 3], health: [0.1, 5], speed: [0.25, 3], damage: [0.1, 5],
	};
	const SHAPES = ['classic', 'ring', 'column'];
	const FOLDERS = {waves: 'wave saves', colosseum: 'colosseum', temple: 'temple saves', test: 'temple_colosseum_test'};
	const COLOSSEUM_KIND = 'fight_arena_colosseum', CASTLE_KIND = 'fight_arena_castle', TEMPLE_KIND = 'fight_arena_temple', TEST_KIND = 'fight_arena_temple_colosseum';
	const STATS = [1000, 600, 18, 16, 100, 150, 0, 140, 3, 8, 100, 800, 20, 18, 100, 1000, 250, 8, 1, 1, 250, 40, 100, 100, 600, 600, 3, 36];
	const TEMPLE_DEFAULTS = {boss: 'dynamic_difficulty:lesser_demon', bossScale: 9, bossHealth: 600, lives: 3, safeRewards: [1000, 1000, 40000]};
	const RULES = {
		table: {label: 'Scaled', hint: 'Scales with difficulty and team size'},
		exact: {label: 'Exact', hint: 'This many, whatever the team'},
		per_player: {label: 'Per player', hint: 'This many for every player'},
		solo_one: {label: 'Team, 1 solo', hint: 'This many for a team, one for a player alone'},
		either: {label: 'Either of two', hint: 'One of two creatures for each, scaled'},
		holding: {label: 'Holding item', hint: 'With an item in hand, scaled'},
		trolls: {label: 'Trolls', hint: 'Solo count and team count', mob: 'dynamic_difficulty:troll'},
		axes: {label: 'Axe pillagers', hint: 'Pillagers with axes, scaled', mob: 'minecraft:pillager'},
		ravagers: {label: 'Ridden ravagers', hint: 'Dark Ravagers with pillagers riding, scaled', mob: 'dynamic_difficulty:dark_ravager'},
		paladins: {label: 'Brute Knights', hint: 'One, two for three or more players', amount: '1, 2 for 3+', mob: 'dynamic_difficulty:paladin', fixed: true},
		dark_knights: {label: 'Dark Knights', hint: 'One per player', amount: '1 per player', mob: 'dynamic_difficulty:dark_knight', fixed: true},
		mounted_knights: {label: 'Mounted Knights', hint: 'One per player', amount: '1 per player', mob: 'dynamic_difficulty:mounted_dark_knight', fixed: true},
	};
	const ARMED = ['fight_arena:insurgent', 'fight_arena:insurgent_captain'];

	const clone = o => JSON.parse(JSON.stringify(o));
	const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));
	const round2 = v => Math.round(v * 100) / 100;
	const line = (mob, count = 1, kind = 'table', other = '', count2 = 0) => ({kind, mob, other, count, count2});

	// --- tags ---

	const get = (c, k, fallback) => (c && c[k] ? c[k].v : fallback);
	const items = (c, k) => (c && c[k] ? c[k].v.items : []);
	const readLine = c => line(get(c, 'Mob', ''), get(c, 'Count', 0), get(c, 'Kind', 'table'), get(c, 'Other', ''), get(c, 'Count2', 0));
	const writeLine = l => N.compound({
		Kind: N.string(l.kind), Mob: N.string(l.mob), Other: N.string(l.other), Count: N.int(l.count), Count2: N.int(l.count2 || 0),
	}).v;

	const tune = () => ({size: 1, health: 1, speed: 1, damage: 1, gun: 1, grenade: 1, primary: '', sidearm: ''});
	const isDefaultTune = t => ['size', 'health', 'speed', 'damage', 'gun', 'grenade'].every(k => t[k] === 1) && !t.primary && !t.sidearm;

	const readTune = c => ({
		size: round2(get(c, 'Size', 1)), health: round2(get(c, 'Health', 1)), speed: round2(get(c, 'Speed', 1)),
		damage: round2(get(c, 'Damage', 1)), gun: round2(get(c, 'Gun', 1)), grenade: round2(get(c, 'Grenade', 1)),
		primary: get(c, 'Primary', ''), sidearm: get(c, 'Sidearm', ''),
	});
	const tuneTags = t => ({Size: N.float(t.size), Health: N.float(t.health), Speed: N.float(t.speed), Damage: N.float(t.damage), Gun: N.float(t.gun), Grenade: N.float(t.grenade),
		Primary: N.string(t.primary), Sidearm: N.string(t.sidearm)});

	function readTunes(list, key) {
		const out = {};
		for (const c of list) {
			const scope = get(c, key, 0), mob = get(c, 'Mob', '');
			if (!mob || scope < 0) continue;
			(out[scope] ??= {})[mob] = readTune(c);
		}
		return out;
	}

	function writeTunes(tunes, key) {
		const out = [];
		for (const scope of Object.keys(tunes).map(Number).sort((a, b) => a - b)) {
			for (const mob of Object.keys(tunes[scope]).sort()) {
				const t = tunes[scope][mob];
				if (isDefaultTune(t)) continue;
				out.push({[key]: N.int(scope), Mob: N.string(mob), ...tuneTags(t)});
			}
		}
		return N.list(out);
	}

	// --- Colosseum ---

	const newColosseum = (cells = LIMITS.cells) => ({
		kind: 'colosseum', cells: Object.fromEntries(Array.from({length: cells}, (_, i) => [i + 1, []])), groups: 0, cellGroups: {}, offGroups: [], delay: 5, startDelay: 10, raise: 10, reward: 0,
		shape: 'classic', stats: [...STATS], tunes: {},
	});

	function readColosseum(c, most = LIMITS.cells) {
		const doc = newColosseum();
		for (const cell of items(c, 'Cells')) {
			const number = get(cell, 'Cell', 0), lines = items(cell, 'Lines').map(readLine);
			if (number >= 1 && number <= most && lines.length) doc.cells[number] = lines;
		}
		doc.groups = clamp(get(c, 'Groups', 0), [0, LIMITS.cells]);
		for (const [cell, group] of Object.entries(get(c, 'CellGroups', {}))) {
			if (+cell >= 1 && +cell <= LIMITS.cells && group.v >= 1 && group.v <= doc.groups) doc.cellGroups[cell] = group.v;
		}
		doc.offGroups = get(c, 'OffGroups', []).filter(g => g >= 1 && g <= doc.groups);
		doc.delay = clamp(get(c, 'Delay', doc.delay), LIMITS.delay);
		doc.startDelay = clamp(get(c, 'StartDelay', doc.startDelay), LIMITS.startDelay);
		doc.raise = clamp(get(c, 'RaiseSeconds', doc.raise), LIMITS.raise);
		doc.reward = clamp(get(c, 'Reward', 0), LIMITS.reward);
		const shape = get(c, 'Shape', 'classic');
		doc.shape = SHAPES.includes(shape) ? shape : 'classic';
		get(c, 'CastleStats', []).slice(0, doc.stats.length).forEach((v, i) => { doc.stats[i] = v; });
		doc.tunes = readTunes(items(c, 'MobTunes'), 'Cell');
		return doc;
	}

	/** The tags of ColosseumConfig.write. */
	function colosseumTags(doc) {
		const numbers = Object.keys(doc.cells).map(Number).filter(n => doc.cells[n].length).sort((a, b) => a - b);
		const inGroups = {};
		for (const cell of Object.keys(doc.cellGroups).map(Number).sort((a, b) => a - b)) inGroups[cell] = N.int(doc.cellGroups[cell]);
		return {
			Cells: N.list(numbers.map(n => ({Cell: N.int(n), Lines: N.list(doc.cells[n].map(writeLine))}))),
			Groups: N.int(doc.groups),
			CellGroups: N.compound(inGroups),
			OffGroups: N.ints([...doc.offGroups].sort((a, b) => a - b)),
			Delay: N.int(doc.delay),
			StartDelay: N.int(doc.startDelay),
			RaiseSeconds: N.int(doc.raise),
			Reward: N.int(doc.reward),
			Shape: N.string(doc.shape),
			CastleStats: N.ints(doc.stats),
			MobTunes: writeTunes(doc.tunes, 'Cell'),
		};
	}

	const writeColosseum = doc => ({Kind: N.string(COLOSSEUM_KIND), Version: N.int(2), ...colosseumTags(doc)});

	// --- waves ---

	const sameLine = (a, b) => a.kind === b.kind && a.mob === b.mob && a.other === b.other && a.count === b.count && (a.count2 || 0) === (b.count2 || 0);
	const sameLines = (a, b) => a.length === b.length && a.every((l, i) => sameLine(l, b[i]));
	const isWritten = (doc, wave) => sameLines(doc.waves[wave], D.waves[wave]);

	const newWaves = () => ({kind: 'waves', waves: clone(D.waves), colosseums: [], castles: null, tunes: {}});

	function readWaves(c) {
		const doc = newWaves();
		for (const one of items(c, 'Waves')) {
			const wave = get(one, 'Wave', 0);
			if (wave >= 1 && wave <= 40) doc.waves[wave] = items(one, 'Lines').map(readLine);
		}
		doc.colosseums = items(c, 'WaveColosseums').map(one => ({
			wave: get(one, 'Wave', 0), name: get(one, 'Name', ''), config: readColosseum(get(one, 'Colosseum', {})),
		}));
		// Castles are not edited here: they go back out as they came.
		doc.castles = c.WaveCastles ? encodeTag(c.WaveCastles) : null;
		doc.tunes = readTunes(items(c, 'WaveMobTunes'), 'Wave');
		return doc;
	}

	/** A wave left as written is left out: the game plays it from its own table, which stays right if that table changes. */
	function writeWaves(doc) {
		const changed = Object.keys(doc.waves).map(Number).filter(w => !isWritten(doc, w)).sort((a, b) => a - b);
		return {
			FightArenaWaves: N.int(1),
			Waves: N.list(changed.map(w => ({Wave: N.int(w), Lines: N.list(doc.waves[w].map(writeLine))}))),
			WaveColosseums: N.list(doc.colosseums.map(one => ({
				Wave: N.int(one.wave), Name: N.string(one.name), Colosseum: N.compound(colosseumTags(one.config)),
			}))),
			WaveCastles: doc.castles ? decodeTag(doc.castles) : N.list([]),
			WaveMobTunes: writeTunes(doc.tunes, 'Wave'),
		};
	}

	// A raw tag kept in the document, which must survive JSON for undo and drafts.
	const encodeTag = tag => JSON.stringify(tag, (k, v) => (typeof v === 'bigint' ? `${v}n` : v instanceof Uint8Array ? [...v] : v));
	const decodeTag = text => JSON.parse(text, (k, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));

	// --- Temple ---

	/**
	 * A colosseum room: where its trap is, and its rounds, tagged as a Colosseum's. Each round is its own four gates: cells 1
	 * to 4 are round 1's, 5 to 8 round 2's and so on - see TempleSpawns - and groups is how many rounds it has.
	 */
	const newRoom = room => ({...clone(room), config: {...newColosseum(LIMITS.roomCells), shape: room.shape, groups: 1}});

	/** A room's cells from round one to round two, its mob settings with them. */
	function moveCell(config, from, to) {
		config.cells[to] = config.cells[from];
		config.cells[from] = [];
		delete config.tunes[to];
		if (config.tunes[from]) {
			config.tunes[to] = config.tunes[from];
			delete config.tunes[from];
		}
	}

	/** A room brought to rounds of their own: one saved when each gate had one line-up and was put in a round has it moved there. */
	function settleRoom(config) {
		for (const [cell, group] of Object.entries(config.cellGroups || {})) {
			config.groups = Math.max(config.groups, group);
			if (group > 1) moveCell(config, +cell, (group - 1) * LIMITS.roomGates + +cell);
		}
		config.cellGroups = {};
		config.offGroups = [];
		config.groups = clamp(config.groups, [1, LIMITS.roomRounds]);
		for (let cell = 1; cell <= LIMITS.roomCells; cell++) config.cells[cell] ??= [];
		return config;
	}

	/** A round taken out of a room, those after it moving up. */
	function removeRound(config, round) {
		const gates = LIMITS.roomGates;
		for (let cell = (round - 1) * gates + 1; cell <= round * gates; cell++) {
			config.cells[cell] = [];
			delete config.tunes[cell];
		}
		for (let cell = round * gates + 1; cell <= config.groups * gates; cell++) moveCell(config, cell, cell - gates);
		config.groups = Math.max(1, config.groups - 1);
	}

	function readRoom(room, tags) {
		const read = readColosseum(tags, LIMITS.roomCells), config = newRoom(room).config;
		for (let cell = 1; cell <= LIMITS.roomCells; cell++) config.cells[cell] = read.cells[cell] || [];
		config.groups = read.groups;
		config.cellGroups = read.cellGroups;
		for (const key of ['delay', 'startDelay', 'raise', 'reward']) config[key] = read[key];
		config.tunes = read.tunes;
		return settleRoom(config);
	}

	const newTemple = () => ({
		kind: 'temple', ...clone(TEMPLE_DEFAULTS),
		spawns: clone(D.spawns).map(s => ({...s, entries: s.entries.map(e => ({mob: e.mob, count: e.count}))})),
		colosseums: (D.colosseums || []).map(newRoom),
	});

	/** A Temple document saved before the colosseum rooms, or the rooms' empty slots: given them. */
	function upgrade(doc) {
		doc.colosseums ??= (D.colosseums || []).map(newRoom);
		for (const room of doc.colosseums) settleRoom(room.config);
		const at = s => `${s.x},${s.y},${s.z}`, known = new Set(doc.spawns.map(at));
		for (const s of D.spawns) if (!known.has(at(s))) doc.spawns.push({...clone(s), entries: s.entries.map(e => ({mob: e.mob, count: e.count}))});
		return doc;
	}

	function readTemple(c) {
		const doc = newTemple();
		doc.boss = get(c, 'Boss', doc.boss);
		doc.bossScale = round2(clamp(get(c, 'BossScale', doc.bossScale), LIMITS.bossScale));
		doc.bossHealth = clamp(get(c, 'BossHealth', doc.bossHealth), LIMITS.bossHealth);
		doc.lives = clamp(get(c, 'Lives', doc.lives), LIMITS.lives);
		get(c, 'SafeRewards', []).slice(0, 3).forEach((v, i) => { doc.safeRewards[i] = clamp(v, LIMITS.safeReward); });
		const at = (s) => `${s.x},${s.y},${s.z}`;
		const known = new Map(doc.spawns.map(s => [at(s), s]));
		for (const one of items(c, 'Spawns')) {
			const x = get(one, 'X', 0), y = get(one, 'Y', 0), z = get(one, 'Z', 0);
			let spawn = known.get(at({x, y, z}));
			if (!spawn) {
				spawn = {x, y, z, level: get(one, 'Level', y < 70 ? 0 : Math.min(3, 1 + Math.floor((y - 70) / 50))), room: get(one, 'Room', 0), cell: [0, 0], range: 12, entries: [], added: !!get(one, 'Added', 0)};
				doc.spawns.push(spawn);
			}
			spawn.range = clamp(get(one, 'Range', spawn.range), LIMITS.spawnRange);
			spawn.entries = items(one, 'Entries').map(e => {
				const tuned = get(e, 'Tune', null);
				return {mob: get(e, 'Mob', ''), count: clamp(get(e, 'Count', 1), LIMITS.spawnCount), ...(tuned ? {tune: readTune(tuned)} : {})};
			});
		}
		for (const one of items(c, 'ColosseumRooms')) {
			const room = doc.colosseums.find(r => r.x === get(one, 'X', 0) && r.y === get(one, 'Y', 0) && r.z === get(one, 'Z', 0));
			if (room) room.config = readRoom(room, get(one, 'Colosseum', {}));
		}
		return doc;
	}

	const writeTemple = doc => ({
		Kind: N.string(TEMPLE_KIND),
		Version: N.int(1),
		Boss: N.string(doc.boss),
		BossScale: N.float(doc.bossScale),
		BossHealth: N.int(doc.bossHealth),
		Lives: N.int(doc.lives),
		SafeRewards: N.ints(doc.safeRewards),
		Spawns: N.list(doc.spawns.map(s => ({
			X: N.int(s.x), Y: N.int(s.y), Z: N.int(s.z), Range: N.int(s.range),
			Entries: N.list(s.entries.map(e => ({Mob: N.string(e.mob), Count: N.int(e.count), ...(e.tune && !isDefaultTune(e.tune) ? {Tune: N.compound(tuneTags(e.tune))} : {})}))),
			...(s.added ? {Added: N.int(1), Level: N.int(s.level), Room: N.int(s.room)} : {}),
		}))),
		ColosseumRooms: N.list(doc.colosseums.map(r => ({
			X: N.int(r.x), Y: N.int(r.y), Z: N.int(r.z), Colosseum: N.compound(colosseumTags(r.config)),
		}))),
	});

	/**
	 * A new Mob Spawn in a room, empty, its place in the list given back: on the floor a few blocks from the room's first, the nearest
	 * spot clear of the others. The game puts the block there on import, so long as nothing solid is in the way - see TempleSpawns.
	 */
	function addSpawn(doc, level, room) {
		const base = doc.spawns.find(s => s.level === level && (s.room || 0) === room);
		const clear = (x, z) => !doc.spawns.some(s => s.y === base.y && Math.abs(s.x - x) < 2 && Math.abs(s.z - z) < 2);
		let x = base.x, z = base.z;
		find: for (let r = 3; r < 40; r++) {
			for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
				if (!clear(base.x + dx * r, base.z + dz * r)) continue;
				x = base.x + dx * r;
				z = base.z + dz * r;
				break find;
			}
		}
		return doc.spawns.push({x, y: base.y, z, level, room, cell: [...base.cell], range: base.range, entries: [], added: true}) - 1;
	}

	/** One colosseum room alone, to try out from the admin page's Temple section - see ColosseumTest. */
	const testFile = room => N.serialize({
		Kind: N.string(TEST_KIND), Version: N.int(1), X: N.int(room.x), Y: N.int(room.y), Z: N.int(room.z), Shape: N.string(room.shape),
		Colosseum: N.compound(colosseumTags(room.config)),
	});

	/** A room's test file taken back into a Temple document: the room it was saved from, or null if it is not one. */
	function fromTest(doc, c) {
		if (get(c, 'Kind', '') !== TEST_KIND) return null;
		const room = doc.colosseums.find(r => r.shape === get(c, 'Shape', ''));
		if (room) room.config = readRoom(room, get(c, 'Colosseum', {}));
		return room || null;
	}

	// --- files ---

	const fresh = {waves: newWaves, colosseum: newColosseum, temple: newTemple};
	const writers = {waves: writeWaves, colosseum: writeColosseum, temple: writeTemple};

	/** What kind of file a root compound is: waves, colosseum, temple, castle or null. */
	function kindOf(c) {
		if (c.FightArenaWaves) return 'waves';
		const kind = get(c, 'Kind', '');
		return kind === COLOSSEUM_KIND ? 'colosseum' : kind === TEMPLE_KIND ? 'temple' : kind === CASTLE_KIND ? 'castle' : null;
	}

	const fromFile = (c, kind) => ({waves: readWaves, colosseum: readColosseum, temple: readTemple})[kind](c);
	const toFile = doc => N.serialize(writers[doc.kind](doc));

	// --- what the game would drop or ignore ---

	function lineIssues(lines, where) {
		const out = [];
		const known = new Set(D.mobs.map(m => m.id));
		if (lines.length > LIMITS.lines) out.push(`${where}: over ${LIMITS.lines} lines, the rest are left out`);
		for (const l of lines) {
			if (!l.mob) out.push(`${where}: a line has no creature`);
			else if (!known.has(l.mob)) out.push(`${where}: ${l.mob} is not in the mob list - check the id`);
			if (l.kind === 'either' && !l.other) out.push(`${where}: "Either of two" needs a second creature`);
			if (l.kind === 'holding' && !l.other) out.push(`${where}: "Holding item" needs an item id`);
		}
		return out;
	}

	function issues(doc) {
		if (doc.kind === 'waves') return Object.keys(doc.waves).flatMap(w => lineIssues(doc.waves[w], `Wave ${w}`));
		if (doc.kind === 'colosseum') {
			const out = Object.keys(doc.cells).flatMap(c => lineIssues(doc.cells[c], `Cell ${c}`));
			for (const c of Object.keys(doc.cells)) {
				if (doc.cells[c].length && doc.offGroups.includes(doc.cellGroups[c])) out.push(`Cell ${c} is in a group that is off, so it stays empty`);
			}
			return out;
		}
		return [...doc.spawns.flatMap(s => lineIssues(s.entries.map(e => line(e.mob, e.count)), `Spawn ${s.x}, ${s.y}, ${s.z}`)),
			...doc.colosseums.flatMap(r => Object.keys(r.config.cells).flatMap(c => lineIssues(r.config.cells[c], `Level ${r.level} colosseum round ${Math.ceil(c / LIMITS.roomGates)} gate ${(c - 1) % LIMITS.roomGates + 1}`)))];
	}

	return {
		LIMITS, SHAPES, FOLDERS, RULES, ARMED, clone, clamp, round2, removeRound, addSpawn, testFile, fromTest, line, tune, isDefaultTune, fresh, kindOf, fromFile, toFile,
		isWritten, sameLines, issues, readColosseum, writers, upgrade,
	};
})();
if (typeof module !== 'undefined') module.exports = Model;
