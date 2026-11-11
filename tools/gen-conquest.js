// Rebuilds src/conquestdata.js from the mods: every Conquest admin setting the game keeps in config/modern_warfare_ships.json,
// with its range and default (Modern Warfare's ShipTuning), and the pages, sections, labels and steps of the in-game Conquest
// admin page (Fight Arena's ConquestAdminScreen and its lang file). Run with `npm run gen` after a slider is added in the game.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.FA_HOME || os.homedir();
const TUNING = path.join(HOME, 'ModernWarfareMod/src/main/java/com/wardg/modernwarfare/vehicle/ShipTuning.java');
const SCREEN = path.join(HOME, 'FightArenaMod/src/client/java/com/wardg/fightarena/client/ConquestAdminScreen.java');
const LANG = path.join(HOME, 'FightArenaMod/src/main/resources/assets/fight_arena/lang/en_us.json');
const GAME = path.join(HOME, 'FightArenaMod/src/main/java/com/wardg/fightarena/game');
const ARSENAL = path.join(HOME, 'ModernWarfareMod/src/main/java/com/wardg/modernwarfare/registry/ArsenalItems.java');
const OUT = path.join(__dirname, '../src/conquestdata.js');

const fail = why => { throw new Error(`gen-conquest: ${why}`); };
const noComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function tuning() {
	const raw = fs.readFileSync(TUNING, 'utf8');
	const src = noComments(raw);
	const ints = /public static final int (SUB_SPEED[\s\S]*?);/.exec(src) || fail('ShipTuning has no SUB_SPEED constants');
	const index = {};
	for (const [, name, n] of ints[1].matchAll(/(\w+)\s*=\s*(\d+)/g)) index[name] = +n;
	const ord = /public static final int (ORD_CRATER[\s\S]*?);/.exec(src);
	const ordField = {};
	if (ord) for (const [, name, n] of ord[1].matchAll(/(\w+)\s*=\s*(\d+)/g)) ordField[name] = +n;
	const count = index.COUNT ?? fail('ShipTuning has no COUNT');
	delete index.COUNT;
	const floats = name => {
		const m = new RegExp(`public static final float\\[\\] ${name} = \\{([^}]*)\\}`).exec(src) || fail(`ShipTuning has no ${name}`);
		const list = m[1].split(',').map(t => t.trim()).filter(Boolean).map(t => parseFloat(t.replace(/F$/i, '')));
		if (list.length !== count) fail(`${name} has ${list.length} values, COUNT is ${count}`);
		return list;
	};
	const rounds = /ORD_ROUNDS = \{([^}]*)\}/.exec(src);
	// the marks save() leaves in the file once a one-time fix-up is done (brMgBare, carry96...): the app writes them all,
	// or the game would redo the fix-up over the app's values
	const saveFn = /private static void save\(\) \{([\s\S]*?)\n\t\}/.exec(src) || fail('ShipTuning has no save()');
	const marks = [...saveFn[1].matchAll(/addProperty\("(\w+)",\s*1\)/g)].map(m => m[1]);
	if (!marks.length) fail('ShipTuning.save() writes no marks');
	return {index, ordField, count, marks, min: floats('MIN'), max: floats('MAX'), def: floats('DEFAULT'),
		rounds: rounds ? [...rounds[1].matchAll(/"(\w+)"/g)].map(m => m[1]) : []};
}

function screen(t) {
	const src = noComments(fs.readFileSync(SCREEN, 'utf8'));
	const lang = JSON.parse(fs.readFileSync(LANG, 'utf8'));
	const label = key => lang[`gui.fight_arena.conquest_admin.${key}`] || key.replace(/^ord_/, '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
	const at = (expr, ctx = {}) => {
		expr = expr.trim();
		let m;
		if ((m = /^ShipTuning\.(\w+)$/.exec(expr))) return t.index[m[1]] ?? fail(`unknown ShipTuning.${m[1]}`);
		if ((m = /^b\s*\+\s*ShipTuning\.(\w+)$/.exec(expr))) return ctx.b + (t.ordField[m[1]] ?? fail(`unknown ShipTuning.${m[1]}`));
		if (expr === 'price') return ctx.price;
		if (/AdminShipTuningPayload\.FREE/.test(expr)) return 'free';
		// in-game buttons (Kill all, Spawn near me): they act on the running world, not the file
		if (/^AdminShipTuningPayload\.(KILL|SPAWN)_\w+$/.test(expr)) return 'button';
		if (expr === 'EDIT_ALLIED') return 'corps:allied';
		if (expr === 'EDIT_HOSTILE') return 'corps:hostile';
		return fail(`cannot read the slider ${expr}`);
	};
	const sliders = (body, ctx) => [...body.matchAll(/new Slider\(([^,]+),\s*"(\w+)",\s*([\d.]+)F?\)/g)].map(([, expr, key, step]) => {
		const i = at(expr, ctx);
		if (i === 'button') return null;
		if (i === 'free') return {special: 'free', key, label: label(key)};
		if (typeof i === 'string') return {special: 'corps', side: i.slice(6), key, label: label(key)};
		return {i, key, label: label(key), step: +step};
	}).filter(Boolean);
	const arrays = {};
	for (const [, name, body] of src.matchAll(/private static final Slider\[\] (\w+) = \{([\s\S]*?)\};/g)) arrays[name] = body;
	// ordnance(round): its price, then the four ORD_ multiples from ORD_BASE + round * 4
	const fn = /private static Slider\[\] ordnance\(int round\) \{([\s\S]*?)\n\t\}/.exec(src);
	const prices = fn && /new int\[\]\{([^}]*)\}\[round\]/.exec(fn[1]);
	const ordnance = round => {
		if (!fn || !prices) fail('cannot read ordnance(round)');
		const price = at(prices[1].split(',')[round]);
		return sliders(fn[1].slice(fn[1].indexOf('return')), {b: t.index.ORD_BASE + round * 4, price});
	};
	const sectionLists = {};
	for (const [, name, body] of src.matchAll(/private static final Section\[\] (\w+) = \{([\s\S]*?)\};/g)) {
		sectionLists[name] = [...body.matchAll(/new Section\("(\w+)",\s*(ordnance\((\d+)\)|new Slider\[\]\{([\s\S]*?)\}|\w+),\s*(true|false)\)/g)]
			.map(([, key, ref, round, inline, folds]) => ({key, label: label(key), folds: folds === 'true',
				sliders: round != null ? ordnance(+round) : inline != null ? sliders(inline) : sliders(arrays[ref] ?? fail(`no Slider[] ${ref}`))}))
			// a section of in-game buttons only (the Hostiles page's Kill all) has nothing for the file
			.filter(sec => sec.sliders.length);
	}
	const pagesSrc = /Page\[\] PAGES = \{([\s\S]*?)\};/.exec(src) || fail('no PAGES');
	const pages = [...pagesSrc[1].matchAll(/new Page\("(\w+)",\s*(\w+)\)/g)].map(([, key, list]) => ({key, label: label(key), sections: sectionLists[list] ?? fail(`no Section[] ${list}`)}));
	if (!pages.length) fail('no pages read');
	return {pages, lang: Object.fromEntries(Object.entries(lang).filter(([k]) => k.startsWith('gui.fight_arena.conquest_admin.')).map(([k, v]) => [k.slice(31), v]))};
}

// The corps (FA CorpsRole and CorpsConfig): each role's health, pace and own guns, the default men, the most a corps may have.
function corps() {
	const role = noComments(fs.readFileSync(path.join(GAME, 'CorpsRole.java'), 'utf8'));
	const config = noComments(fs.readFileSync(path.join(GAME, 'CorpsConfig.java'), 'utf8'));
	const lang = JSON.parse(fs.readFileSync(LANG, 'utf8'));
	const gunId = {};
	for (const [, c, id] of fs.readFileSync(ARSENAL, 'utf8').matchAll(/public static final Item (\w+) = gun\("([a-z0-9_]+)"/g)) gunId[c] = `modern_warfare:${id}`;
	const id = c => gunId[c] ?? fail(`no ArsenalItems.${c}`);
	const roles = [...role.matchAll(/^\s*([A-Z]+)\(([\d.]+)F?,\s*([\d.]+),\s*ArsenalItems\.(\w+),\s*ArsenalItems\.(\w+),\s*ArsenalItems\.(\w+),\s*ArsenalItems\.(\w+)\)/gm)]
		.map(([, name, health, speed, p, sd, hp, hs]) => {
			const key = name.toLowerCase();
			return {key, name: lang[`gui.fight_arena.corps.role.${key}`] || key, info: lang[`gui.fight_arena.corps.role_info.${key}`] || '',
				health: +health, speed: +speed, allied: {primary: id(p), sidearm: id(sd)}, hostile: {primary: id(hp), sidearm: id(hs)}};
		});
	if (roles.length < 2) fail('cannot read the CorpsRole values');
	const lists = /allies\s*\?\s*new CorpsRole\[\]\{([^}]*)\}\s*:\s*new CorpsRole\[\]\{([^}]*)\}/.exec(config) || fail('cannot read CorpsConfig.defaults');
	const men = list => [...list.matchAll(/CorpsRole\.(\w+)/g)].map(m => m[1].toLowerCase());
	const max = /MAX_MEN = (\d+)/.exec(config) || fail('no CorpsConfig.MAX_MEN');
	const none = /NONE = "(\w+)"/.exec(fs.readFileSync(path.join(GAME, 'MobGuns.java'), 'utf8'));
	return {roles, defaults: {allied: men(lists[1]), hostile: men(lists[2])}, maxMen: +max[1], none: none ? none[1] : 'none'};
}

// Fuel (MW Fuel and MiningStations): the gallons a player starts with, and the most mining stations a player may run.
function fuel() {
	const dir = path.dirname(TUNING), read = f => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
	const start = /double START = ([\d.]+)/.exec(read('Fuel.java')), max = /int MAX = (\d+)/.exec(read('MiningStations.java'));
	if (!start || !max) console.warn('gen-conquest: could not read Fuel.START or MiningStations.MAX - the Economy fuel card is left out');
	return start && max ? {start: +start[1], maxStations: +max[1]} : null;
}

const t = tuning();
const {pages} = screen(t);
const names = Array(t.count).fill(null);
for (const [name, i] of Object.entries(t.index)) if (i < t.count && !names[i]) names[i] = name;
for (let r = 0; r < t.rounds.length; r++) for (const [field, f] of Object.entries(t.ordField)) names[t.index.ORD_BASE + r * 4 + f] = `${field}:${t.rounds[r]}`;
const shown = new Set(pages.flatMap(p => p.sections.flatMap(s => s.sliders.map(sl => sl.i))));
const hidden = names.map((n, i) => (shown.has(i) ? null : {i, name: n})).filter(Boolean);
// The guns, as Fight Arena lists them when it starts (ConquestGuns writes the catalog): the game's own copy first, else the dev server's.
const CATALOGS = [path.join(HOME, 'curseforge/minecraft/Instances/Fight Arena/config/fight_arena_conquest_guns.catalog.json'),
	path.join(HOME, 'FightArenaMod/run/config/fight_arena_conquest_guns.catalog.json')].filter(f => fs.existsSync(f))
	.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
const guns = CATALOGS.length ? JSON.parse(fs.readFileSync(CATALOGS[0], 'utf8')) : null;
if (!guns) console.warn('gen-conquest: no gun catalog yet - start the game or the dev server once with the current Fight Arena');
const data = {generated: new Date().toISOString(), count: t.count, marks: t.marks, names, min: t.min, max: t.max, def: t.def, ordBase: t.index.ORD_BASE, rounds: t.rounds, pages, hidden, guns, corps: corps(), fuel: fuel()};
fs.writeFileSync(OUT, `// Generated by tools/gen-conquest.js from ShipTuning and ConquestAdminScreen - do not edit.\nconst CONQUEST = ${JSON.stringify(data)};\nif (typeof module !== 'undefined') module.exports = CONQUEST;\n`);
console.log(`conquestdata.js: ${t.count} settings, ${pages.length} pages, ${guns ? guns.guns.length : 0} guns, ${data.corps.roles.length} corps roles, ${[...shown].filter(i => i != null).length} shown in game${hidden.length ? `, not on the in-game page: ${hidden.map(x => x.name).join(', ')}` : ''}`);
