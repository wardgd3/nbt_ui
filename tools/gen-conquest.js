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
const OUT = path.join(__dirname, '../src/conquestdata.js');

const fail = why => { throw new Error(`gen-conquest: ${why}`); };
const noComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function tuning() {
	const src = noComments(fs.readFileSync(TUNING, 'utf8'));
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
	return {index, ordField, count, min: floats('MIN'), max: floats('MAX'), def: floats('DEFAULT'),
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
		return fail(`cannot read the slider ${expr}`);
	};
	const sliders = (body, ctx) => [...body.matchAll(/new Slider\(([^,]+),\s*"(\w+)",\s*([\d.]+)F?\)/g)].map(([, expr, key, step]) => {
		const i = at(expr, ctx);
		return i === 'free' ? {special: 'free', key, label: label(key)} : {i, key, label: label(key), step: +step};
	});
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
				sliders: round != null ? ordnance(+round) : inline != null ? sliders(inline) : sliders(arrays[ref] ?? fail(`no Slider[] ${ref}`))}));
	}
	const pagesSrc = /Page\[\] PAGES = \{([\s\S]*?)\};/.exec(src) || fail('no PAGES');
	const pages = [...pagesSrc[1].matchAll(/new Page\("(\w+)",\s*(\w+)\)/g)].map(([, key, list]) => ({key, label: label(key), sections: sectionLists[list] ?? fail(`no Section[] ${list}`)}));
	if (!pages.length) fail('no pages read');
	return {pages, lang: Object.fromEntries(Object.entries(lang).filter(([k]) => k.startsWith('gui.fight_arena.conquest_admin.')).map(([k, v]) => [k.slice(31), v]))};
}

const t = tuning();
const {pages} = screen(t);
const names = Array(t.count).fill(null);
for (const [name, i] of Object.entries(t.index)) if (i < t.count && !names[i]) names[i] = name;
for (let r = 0; r < t.rounds.length; r++) for (const [field, f] of Object.entries(t.ordField)) names[t.index.ORD_BASE + r * 4 + f] = `${field}:${t.rounds[r]}`;
const shown = new Set(pages.flatMap(p => p.sections.flatMap(s => s.sliders.map(sl => sl.i))));
const hidden = names.map((n, i) => (shown.has(i) ? null : {i, name: n})).filter(Boolean);
const data = {generated: new Date().toISOString(), count: t.count, names, min: t.min, max: t.max, def: t.def, ordBase: t.index.ORD_BASE, rounds: t.rounds, pages, hidden};
fs.writeFileSync(OUT, `// Generated by tools/gen-conquest.js from ShipTuning and ConquestAdminScreen - do not edit.\nconst CONQUEST = ${JSON.stringify(data)};\nif (typeof module !== 'undefined') module.exports = CONQUEST;\n`);
console.log(`conquestdata.js: ${t.count} settings, ${pages.length} pages, ${[...shown].filter(i => i != null).length} shown in game${hidden.length ? `, not on the in-game page: ${hidden.map(x => x.name).join(', ')}` : ''}`);
