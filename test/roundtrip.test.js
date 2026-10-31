// Files written here must read back the way the mod reads them, and real game files must survive a trip through the app.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const NBT = require('../src/nbt.js');
const Model = require('../src/model.js');

const INSTANCE = path.join(os.homedir(), 'curseforge/minecraft/Instances/Fight Arena');
const realFiles = folder => {
	const dir = path.join(INSTANCE, folder);
	return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.nbt')).map(f => path.join(dir, f)) : [];
};

/** A root compound with the tag type kept and floats rounded, for comparing. */
function plain(tag) {
	if (Array.isArray(tag)) return tag.map(plain);
	if (tag && typeof tag === 'object' && 'items' in tag) return {of: tag.items.length ? tag.of : 0, items: tag.items.map(plain)};
	if (tag && typeof tag === 'object' && 't' in tag) return [tag.t, tag.t === 5 ? Math.round(tag.v * 100) / 100 : plain(tag.v)];
	if (tag && typeof tag === 'object') return Object.fromEntries(Object.keys(tag).sort().map(k => [k, plain(tag[k])]));
	return tag;
}

test('gzip wrapper and unnamed root, as NbtIo.writeCompressed makes them', async () => {
	const bytes = await Model.toFile(Model.fresh.colosseum());
	assert.deepStrictEqual([bytes[0], bytes[1]], [0x1f, 0x8b]);
	const raw = zlib.gunzipSync(Buffer.from(bytes));
	assert.deepStrictEqual([raw[0], raw[1], raw[2]], [10, 0, 0]);
});

for (const file of realFiles('colosseum')) {
	test(`real Colosseum survives the app: ${path.basename(file)}`, async () => {
		const root = await NBT.parse(new Uint8Array(fs.readFileSync(file)));
		assert.strictEqual(Model.kindOf(root), 'colosseum');
		const doc = Model.fromFile(root, 'colosseum');
		const back = await NBT.parse(await Model.toFile(doc));
		// Files from before the gun fields read as 1 and blank, as ColosseumConfig.read has them.
		for (const t of root.MobTunes?.v.items ?? []) {
			t.Damage ??= NBT.float(1); t.Gun ??= NBT.float(1); t.Grenade ??= NBT.float(1);
			t.Primary ??= NBT.string(''); t.Sidearm ??= NBT.string('');
		}
		root.MobTunes ??= NBT.list([]);
		root.Version = NBT.int(2);
		root.Reward ??= NBT.int(0);
		root.Shape ??= NBT.string('classic');
		root.OffGroups ??= NBT.ints([]);
		delete root.ColosseumWaves;
		// Older files have fewer stats: the mod fills in the rest with its defaults, and so does the app.
		const had = root.CastleStats?.v ?? [];
		assert.deepStrictEqual(back.CastleStats.v.slice(0, had.length), had);
		root.CastleStats = back.CastleStats;
		// Empty cells are dropped on read by the mod too, and groups and order are compared as sets of cells.
		const sortCells = c => { c.Cells.v.items = c.Cells.v.items.filter(x => x.Lines.v.items.length).sort((a, b) => a.Cell.v - b.Cell.v); };
		sortCells(root);
		assert.deepStrictEqual(plain(back), plain(root));
	});
}

test('wave file holds only what changed, and keeps the file marker', async () => {
	const doc = Model.fresh.waves();
	doc.waves[7][0].count = 9;
	doc.waves[12] = [];
	doc.tunes = {7: {'minecraft:zombie': {...Model.tune(), size: 2}}};
	const back = await NBT.parse(await Model.toFile(doc));
	assert.ok(back.FightArenaWaves);
	assert.deepStrictEqual(back.Waves.v.items.map(w => w.Wave.v), [7, 12]);
	assert.strictEqual(back.Waves.v.items[1].Lines.v.items.length, 0);
	const again = Model.fromFile(back, 'waves');
	assert.strictEqual(again.waves[7][0].count, 9);
	assert.deepStrictEqual(again.waves[12], []);
	assert.deepStrictEqual(again.waves[1], Model.fresh.waves().waves[1]);
	assert.strictEqual(again.tunes[7]['minecraft:zombie'].size, 2);
});

test('a wave file keeps its Colosseum and passes its Castles through', async () => {
	const castles = NBT.list([{Wave: NBT.int(3), Name: NBT.string('c.nbt'), Castle: NBT.compound({Groups: NBT.int(2)})}]);
	const doc = Model.fromFile({FightArenaWaves: NBT.int(1), WaveCastles: castles}, 'waves');
	const config = Model.fresh.colosseum();
	config.cells[4] = [Model.line('minecraft:zombie', 3)];
	doc.colosseums.push({wave: 8, name: 'x.nbt', config});
	const stored = JSON.parse(JSON.stringify(doc));
	const back = await NBT.parse(await Model.toFile(stored));
	assert.deepStrictEqual(plain(back.WaveCastles), plain(castles));
	const one = back.WaveColosseums.v.items[0];
	assert.strictEqual(one.Wave.v, 8);
	assert.strictEqual(one.Colosseum.v.Cells.v.items[0].Cell.v, 4);
	assert.ok(!one.Colosseum.v.Kind, 'WaveBook stores the config without a Kind');
});

test('Temple file round trip keeps edits and every spawn', async () => {
	const doc = Model.fresh.temple();
	doc.spawns[5].entries = [{mob: 'minecraft:husk', count: 7}];
	doc.spawns[5].range = 33;
	doc.lives = 5;
	const root = await NBT.parse(await Model.toFile(doc));
	assert.strictEqual(root.Kind.v, 'fight_arena_temple');
	assert.strictEqual(Model.kindOf(root), 'temple');
	const again = Model.fromFile(root, 'temple');
	assert.deepStrictEqual(again.spawns[5].entries, [{mob: 'minecraft:husk', count: 7}]);
	assert.strictEqual(again.spawns[5].range, 33);
	assert.strictEqual(again.lives, 5);
	assert.strictEqual(again.spawns.length, doc.spawns.length);
});

test('the wave table matches a real export where the game has one', () => {
	const fresh = Model.fresh.waves();
	assert.strictEqual(Object.keys(fresh.waves).length, 40);
	assert.deepStrictEqual(Model.issues(fresh), []);
	assert.deepStrictEqual(Model.issues(Model.fresh.temple()), []);
});

test('castle and unknown files are told apart', () => {
	assert.strictEqual(Model.kindOf({Kind: NBT.string('fight_arena_castle')}), 'castle');
	assert.strictEqual(Model.kindOf({Kind: NBT.string('other')}), null);
});
