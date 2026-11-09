// The Conquest tab's reading and writing of the game's config/modern_warfare_ships.json.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

global.CONQUEST = require('../src/conquestdata.js');
const Conquest = require('../src/conquest.js');
const C = global.CONQUEST;
const sample = fs.readFileSync(path.join(__dirname, 'ships_sample.json'), 'utf8');
const at = name => C.names.indexOf(name);

test('the data covers every setting, each in range of its default', () => {
	assert.strictEqual(C.names.length, C.count);
	for (let i = 0; i < C.count; i++) assert.ok(C.min[i] <= C.def[i] && C.def[i] <= C.max[i], `v${i} ${C.names[i]}`);
	const shown = new Set(C.pages.flatMap(p => p.sections.flatMap(s => s.sliders.map(sl => sl.i))));
	for (const name of ['BB_SPEED', 'REWARD_TANK', 'REDEPLOY_PRICE', 'BASE_DETECT']) assert.ok(shown.has(at(name)), name);
});

test('a game file reads as the game reads it: clamped, missing ones at their defaults', () => {
	const got = Conquest._parse(sample);
	assert.ok(Math.abs(got.values[0] - 1.3) < 1e-4);
	const missing = C.names.findIndex((n, i) => !(`v${i}` in JSON.parse(sample)));
	if (missing >= 0) assert.strictEqual(got.values[missing], C.def[missing]);
	const wild = Conquest._parse(JSON.stringify({v0: 99, v23: -5, other: 'kept'}));
	assert.strictEqual(wild.values[0], C.max[0]);
	assert.strictEqual(wild.values[23], C.min[23]);
	assert.deepStrictEqual(wild.extra, {other: 'kept'});
	assert.throws(() => Conquest._parse('[1,2]'));
});

test('written and read back, nothing changes', () => {
	const S = Conquest._state;
	S.values = Conquest._parse(sample).values;
	S.extra = {other: 'kept'};
	const text = Conquest._write();
	const o = JSON.parse(text);
	assert.strictEqual(Object.keys(o).filter(k => /^v\d+$/.test(k)).length, C.count);
	assert.strictEqual(o.brMgBare, 1);
	assert.strictEqual(o.other, 'kept');
	// floats like 1.3000001 are written tidied, 1.3
	Conquest._parse(text).values.forEach((v, i) => assert.ok(Math.abs(v - S.values[i]) < 1e-5, `v${i}`));
});

test('values read in the units the in-game page shows', () => {
	assert.strictEqual(Conquest._show(at('BB_SPEED'), 1.3000001), '130%');
	assert.strictEqual(Conquest._show(at('BB_ZOOM'), 0.25), '±25%');
	assert.strictEqual(Conquest._show(at('REDEPLOY_TIME'), 240), '4:00');
	assert.strictEqual(Conquest._show(at('REWARD_BASE'), 1000), '1,000 g');
	assert.strictEqual(Conquest._show(at('HT_SPAWN'), 0), 'Off');
	assert.strictEqual(Conquest._show(C.ordBase, 0), 'Off');
	assert.strictEqual(Conquest._show(at('TK_MG_MAG'), 60), '60 rounds');
	assert.strictEqual(Conquest._show(at('BASE_DETECT'), 50), '50 m');
});

test('the Munitions page reads in its own units', () => {
	assert.strictEqual(Conquest._show(at('MUN_GUN_PCT'), 30), '30% of shop');
	assert.strictEqual(Conquest._show(at('MUN_JUGGERNAUT'), 3000), '3,000 g');
});

test('the guns file: numbers only in, sorted out, clamped to the game\'s limits', () => {
	assert.ok(C.guns && C.guns.guns.length > 20, 'the gun catalog is built in');
	const got = Conquest._parseGuns(JSON.stringify({guns: {'modern_warfare:m16a4': {damage: 30, fireRate: 1.5, note: 'x'}, 'modern_warfare:sks': {}}}));
	assert.deepStrictEqual(got, {'modern_warfare:m16a4': {damage: 30, fireRate: 1.5}});
	assert.deepStrictEqual(Conquest._parseGuns(''), {});
	assert.throws(() => Conquest._parseGuns('{"v0": 1}'));
	const S = Conquest._state;
	S.guns = {};
	Conquest._setGun('modern_warfare:m16a4', 'fireRate', 99);
	Conquest._setGun('modern_warfare:m16a4', 'range', 20);
	Conquest._setGun('modern_warfare:m16a4', 'fullRange', 50);
	const m16 = S.guns['modern_warfare:m16a4'];
	assert.strictEqual(m16.fireRate, C.guns.maxRate);
	assert.strictEqual(m16.fullRange, 20, 'full-damage range kept within the range');
	Conquest._setGun('modern_warfare:m16a4', 'fireRate', null);
	assert.ok(!('fireRate' in m16) || S.guns['modern_warfare:m16a4'].fireRate == null);
	assert.deepStrictEqual(JSON.parse(Conquest._writeGuns()).guns, S.guns);
	const glock = C.guns.guns.find(g => g.id === 'modern_warfare:glock_17');
	assert.strictEqual(Conquest._ownOf(glock, 'price'), Math.max(1, Math.round(glock.price * 0.3)));
});
