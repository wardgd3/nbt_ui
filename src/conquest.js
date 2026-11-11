// The Conquest tab: the game's Conquest admin settings (Modern Warfare's ShipTuning, kept in config/modern_warfare_ships.json
// in the game folder) on one page - every slider the in-game admin page has, by the same pages and sections, with exact
// values, defaults, search, undo, a list of what is about to change in the game, and an economy read-out.
// The game reads the file when a world starts and whenever a player joins (and before an admin's slider move in game).
const Conquest = (() => {
	const C = CONQUEST;
	const FILE = 'modern_warfare_ships.json', DRAFT = 'nbt_ui.conquest.v1';
	const NAME = C.names;
	let A = null;

	const S = {
		values: C.def.slice(),
		base: null, // the values as the game's file had them when last read or written
		baseText: null,
		extra: {}, // keys in the file that are not settings, kept as they are
		page: 0,
		open: new Set(),
		query: '',
		onlyChanged: false,
		side: 'changes',
		loadedAt: null,
		triedAuto: false,
		guns: {}, // what is set on each gun, by item id: price (gold), damage, range, fullRange, fireRate, autoRate, recoil
		gunsBase: null, // the guns file as last read or written
		catalog: C.guns, // every gun and its own figures - the game's latest catalog once read from the folder
		corps: corpsDefaults(), // the men of the players' corps and the hostile one: {allied: [{role, primary, sidearm}], hostile: [...]}
		corpsBase: null, // the corps file as last read or written (its defaults where the game has none)
		corpsBaseText: null,
	};
	const undo = [], redo = [];
	const snapshot = () => JSON.stringify({v: S.values, g: S.guns, c: S.corps});
	/** The corps the game makes up when its file has none (CorpsConfig.defaults): each man with his role's own guns. */
	function corpsDefaults() {
		const d = C.corps?.defaults || {allied: [], hostile: []};
		return {allied: d.allied.map(role => ({role, primary: '', sidearm: ''})), hostile: d.hostile.map(role => ({role, primary: '', sidearm: ''}))};
	}
	let last = snapshot();

	// --- what each setting is ---

	const where = {}; // index -> {page, section, slider}
	C.pages.forEach((p, pi) => p.sections.forEach((sec, si) => sec.sliders.forEach(sl => { if (sl.i != null) where[sl.i] = {pi, si, sl}; })));
	const SECONDS = new Set(['TK_SMOKE_COOLDOWN', 'TK_SMOKE_LINGER', 'TURN_SECONDS']);
	const BLOCKS = new Set(['TK_SMOKE_SIZE', 'DRONE_RANGE', 'BASE_DETECT', 'MISSILE_RANGE', 'SONAR_RANGE']);
	const GOLD_ALSO = new Set(['TURN_GOLD', 'REDEPLOY_PRICE', 'REACTOR_REPAIR', 'STARTING_GOLD', 'STATION_COST']);

	/** How a setting reads: its kind, decides the unit shown, what the number box holds, and whether 0 reads Off. */
	function kind(i) {
		const n = NAME[i] || '';
		if (n.startsWith('ORD_')) return {k: 'pct', off: true};
		if (/_MAG$/.test(n)) return {k: 'rounds'};
		if (n === 'HT_SPAWN' || n === 'HB_SPAWN') return {k: 'pct', off: true};
		if (/_ZOOM$/.test(n)) return {k: 'zoom'};
		if (SECONDS.has(n)) return {k: 's'};
		if (n === 'REDEPLOY_TIME') return {k: 'mmss'};
		if (BLOCKS.has(n)) return {k: 'm'};
		if (n === 'BS_MISSILE_CAP' || n === 'CORPS_MAX' || n === 'HC_CAP' || n === 'BS_CARRY_CAP' || n === 'BS_BOAT_COUNT') return {k: 'n'};
		if (n === 'BS_CIWS_RANGE') return {k: 'm', off: true};
		if (n === 'BS_DEPLOY_RANGE' || n === 'BS_CARRY_RANGE' || n === 'BS_BOAT_GUARD' || n === 'BS_BOAT_RANGE') return {k: 'm'};
		if (n === 'BS_BOAT_REBUILD') return {k: 'mmss'};
		if (n === 'HBASE_COUNT') return {k: 'n', off: true};
		if (n === 'HBASE_PATROLS' || n === 'HBASE_GARRISON' || n === 'HBASE_TURRETS') return {k: 'n'};
		if (n === 'HBASE_SPAWN' || n === 'HOSTILE_SPAWN') return {k: 'pct', off: true};
		if (n === 'HBASE_SPACING' || n === 'HBASE_PATROL_RADIUS' || n === 'HBASE_ATTACK_RANGE' || n === 'HBASE_TURRET_RANGE') return {k: 'm'};
		if (n === 'HBASE_REINFORCE') return {k: 'mmss', off: true};
		if (n === 'HC_SPAWN') return {k: 'pct', off: true};
		if (n === 'REACTOR_HP') return {k: 'hp'};
		if (n === 'VEHICLE_FUEL' || n === 'FUEL_COAL') return {k: 'gal'};
		if (n === 'MUN_GUN_PCT' || n === 'MUN_AMMO_PCT') return {k: 'share'};
		if (/^(PRICE_|REWARD_|UP_|MUN_)/.test(n) || GOLD_ALSO.has(n)) return {k: 'gold'};
		if (n === 'SHIELD_COST' || n === 'REACTOR_RATE') return {k: 'mj'};
		return {k: 'pct'};
	}
	const isPct = i => ['pct', 'zoom'].includes(kind(i).k);
	const UNIT = {pct: '%', zoom: '±%', rounds: 'rounds', s: 's', mmss: 's', m: 'm', n: '', hp: 'HP', gold: 'g', mj: 'MJ/s', share: '% of shop', gal: 'gal/min'};
	const comma = n => Math.round(n).toLocaleString('en-US');
	const mmss = v => `${Math.floor(Math.round(v) / 60)}:${String(Math.round(v) % 60).padStart(2, '0')}`;

	function show(i, v = S.values[i]) {
		const {k, off} = kind(i);
		if (off && v <= 0) return 'Off';
		switch (k) {
			case 'pct': return `${Math.round(v * 100)}%`;
			case 'zoom': return `±${Math.round(v * 100)}%`;
			case 'rounds': return `${Math.round(v)} rounds`;
			case 's': return `${Math.round(v)} s`;
			case 'mmss': return mmss(v);
			case 'm': return `${Math.round(v)} m`;
			case 'hp': return `${comma(v)} HP`;
			case 'gold': return `${comma(v)} g`;
			case 'mj': return `${comma(v)} MJ/s`;
			case 'gal': return `${comma(v)} gal/min`;
			case 'share': return `${Math.round(v)}% of shop`;
			default: return comma(v);
		}
	}
	/** The number box shows percentages as percent, the rest as stored. */
	const toBox = (i, v) => (isPct(i) ? +(v * 100).toFixed(2) : +v.toFixed(2));
	const fromBox = (i, n) => (isPct(i) ? n / 100 : n);
	const stepOf = i => where[i]?.sl.step || 0.05;
	const clamp = (i, v) => Math.min(C.max[i], Math.max(C.min[i], v));
	const tidy = v => Math.round(v * 1e6) / 1e6;
	const snap = (i, v) => tidy(clamp(i, Math.round(v / stepOf(i)) * stepOf(i)));
	const same = (a, b) => Math.abs(a - b) < 1e-5;
	const label = i => where[i]?.sl.label || NAME[i];
	const placeOf = i => (where[i] ? `${C.pages[where[i].pi].label} › ${C.pages[where[i].pi].sections[where[i].si].label}` : 'Not on the admin page');
	const changedFromDefault = i => !same(S.values[i], C.def[i]);
	const unsaved = i => !same(S.values[i], (S.base || C.def)[i]);
	const pending = () => (S.base ? S.values.map((v, i) => i).filter(unsaved) : []);
	const sectionIdx = sec => sec.sliders.filter(sl => sl.i != null).map(sl => sl.i);
	const pageIdx = p => p.sections.flatMap(sectionIdx);

	// --- the guns (Fight Arena's ConquestGuns: config/fight_arena_conquest_guns.json, and the catalog it writes) ---

	const GUN_FILE = 'fight_arena_conquest_guns.json', CATALOG_FILE = 'fight_arena_conquest_guns.catalog.json';
	/** The Guns page, after the in-game pages in the data. */
	const GUN_PAGE = C.pages.length;
	const TIER_NAMES = ['', 'Tier I', 'Tier II', 'Tier III', 'Tier IV', 'Tier V'];
	const GFIELDS = [
		{k: 'price', label: 'Munitions price', unit: 'g', munitions: true},
		{k: 'damage', label: 'Damage', unit: 'a shot'},
		{k: 'range', label: 'Range', unit: 'm'},
		{k: 'fullRange', label: 'Full damage to', unit: 'm'},
		{k: 'fireRate', label: 'Fire rate', unit: '%', rate: true},
		{k: 'autoRate', label: 'Full Auto rate', unit: '%', rate: true, auto: true},
		{k: 'recoil', label: 'Recoil', unit: '%', rate: true},
	];
	const GFIELD = Object.fromEntries(GFIELDS.map(f => [f.k, f]));
	const cat = () => S.catalog || {guns: []};
	const gunById = id => cat().guns.find(g => g.id === id);
	const munTier = () => cat().munitionsTier || 3;
	const isMun = g => g.tier === munTier();
	const fieldsOf = g => GFIELDS.filter(f => (f.munitions ? isMun(g) : f.auto ? g.shoots && g.auto : g.shoots));
	/** What a gun has before anything is set: its Munitions price is the Munitions page's share of its shop price. */
	function ownOf(g, k) {
		if (k === 'price') return Math.max(1, Math.round(g.price * val('MUN_GUN_PCT') / 100));
		return k in g && !GFIELD[k].rate ? g[k] : 1;
	}
	const gunVal = (g, k) => S.guns[g.id]?.[k] ?? ownOf(g, k);
	function gunLimits(g, k) {
		const c = cat();
		if (k === 'price') return [0, c.maxPrice || 1e6];
		if (k === 'damage') return [0, c.maxDamage || 1e4];
		if (k === 'range') return [1, c.maxRange || 512];
		if (k === 'fullRange') return [0, gunVal(g, 'range')];
		return [c.minRate || 0.25, c.maxRate || 3];
	}
	const gunShow = (k, v) => (k === 'price' ? `${comma(v)} g` : GFIELD[k].rate ? `${Math.round(v * 100)}%` : k === 'damage' ? String(+v.toFixed(2)) : `${+v.toFixed(1)} m`);
	const gunToBox = (k, v) => (GFIELD[k].rate ? +(v * 100).toFixed(1) : +v.toFixed(2));
	const gunFromBox = (k, n) => (GFIELD[k].rate ? n / 100 : n);
	function setGun(id, k, v) {
		const g = gunById(id);
		if (v == null) {
			if (S.guns[id]) delete S.guns[id][k];
		} else {
			const [lo, hi] = gunLimits(g, k);
			v = tidy(Math.min(hi, Math.max(lo, v)));
			if (k === 'price') v = Math.round(v);
			S.guns[id] = {...S.guns[id], [k]: v};
			// a range brought under its full-damage range takes that down with it
			if (k === 'range' && S.guns[id].fullRange > v) S.guns[id].fullRange = v;
		}
		if (S.guns[id] && !Object.keys(S.guns[id]).length) delete S.guns[id];
	}
	/** Each gun figure that differs from the game's guns file, as {id, k}. */
	function gunPending() {
		const base = S.gunsBase || {}, out = [];
		for (const id of new Set([...Object.keys(S.guns), ...Object.keys(base)])) {
			for (const k of new Set([...Object.keys(S.guns[id] || {}), ...Object.keys(base[id] || {})])) {
				const a = S.guns[id]?.[k], b = base[id]?.[k];
				if (a == null ? b != null : b == null || !same(a, b)) out.push({id, k});
			}
		}
		return out;
	}
	const gunsSet = () => Object.values(S.guns).reduce((n, o) => n + Object.keys(o).length, 0);
	const unsavedCount = () => pending().length + gunPending().length + corpsPending().length;

	// --- the corps (Fight Arena's CorpsConfig: config/fight_arena_conquest_corps.json) ---

	const CORPS_FILE = 'fight_arena_conquest_corps.json';
	const CP = C.corps || {roles: [], defaults: {allied: [], hostile: []}, maxMen: 16, none: 'none'};
	const SIDES = ['allied', 'hostile'];
	const SIDE_NAME = {allied: 'Your corps', hostile: 'Hostile corps'};
	const roleOf = key => CP.roles.find(r => r.key === key) || CP.roles.find(r => r.key === 'rifleman') || CP.roles[0];
	/** The guns a man may carry (MobGuns): any gun that fires rounds or shot as his main gun, a handgun as his sidearm. */
	const DATA_GUNS = typeof DATA !== 'undefined' && DATA.guns ? DATA.guns : {primary: [], sidearm: []};
	const PRIMARIES = DATA_GUNS.primary, SIDEARMS = DATA_GUNS.sidearm;
	const gunName = id => PRIMARIES.find(g => g.id === id)?.name || cat().guns.find(g => g.id === id)?.name || (id || '').replace(/^.*:/, '').replace(/_/g, ' ');
	const canPrimary = id => !PRIMARIES.length || PRIMARIES.some(g => g.id === id);
	const canSidearm = id => !SIDEARMS.length || SIDEARMS.some(g => g.id === id);
	/** What a man carries: his own, else his role's for his side. */
	const primaryOf = (m, side) => m.primary || roleOf(m.role)[side].primary;
	const sidearmOf = (m, side) => (m.sidearm === CP.none ? null : m.sidearm || roleOf(m.role)[side].sidearm);
	const manText = (m, side) => `${roleOf(m.role).name} · ${gunName(primaryOf(m, side))} / ${sidearmOf(m, side) ? gunName(sidearmOf(m, side)) : 'no sidearm'}`;
	const sameMan = (a, b) => a && b && a.role === b.role && a.primary === b.primary && a.sidearm === b.sidearm;
	const sameSide = (a, b) => a.length === b.length && a.every((m, k) => sameMan(m, b[k]));
	/** The sides whose men differ from the game's file (or, not loaded, from the defaults). */
	function corpsPending() {
		const base = S.corpsBase || corpsDefaults();
		return SIDES.filter(side => !sameSide(S.corps[side], base[side]));
	}

	/** A corps file as the game reads it (CorpsConfig.parse): at most MAX_MEN a side, a role it knows, guns a man can carry. */
	function parseCorps(text) {
		const out = corpsDefaults();
		if (!text || !text.trim()) return out;
		const o = JSON.parse(text);
		if (!o || typeof o !== 'object' || Array.isArray(o) || !(Array.isArray(o.allied) || Array.isArray(o.hostile))) throw new Error('not a corps file');
		const str = v => (typeof v === 'string' ? v : '');
		for (const side of SIDES) {
			if (!Array.isArray(o[side])) continue;
			out[side] = o[side].filter(e => e && typeof e === 'object' && !Array.isArray(e)).slice(0, CP.maxMen).map(e => {
				let primary = str(e.primary), sidearm = str(e.sidearm);
				if (primary && !canPrimary(primary)) primary = '';
				if (sidearm && sidearm !== CP.none && !canSidearm(sidearm)) sidearm = '';
				return {role: roleOf(str(e.role).toLowerCase()).key, primary, sidearm};
			});
		}
		return out;
	}

	/** Written as the game writes it. */
	function writeCorps() {
		const o = {};
		for (const side of SIDES) o[side] = S.corps[side].map(m => ({role: m.role, primary: m.primary, sidearm: m.sidearm}));
		return JSON.stringify(o, null, 2);
	}

	/** A guns file as the game reads it: only numbers, by gun. */
	function parseGuns(text) {
		if (!text || !text.trim()) return {};
		const o = JSON.parse(text);
		if (!o || typeof o.guns !== 'object' || Array.isArray(o.guns)) throw new Error('not a guns file');
		const out = {};
		for (const [id, fields] of Object.entries(o.guns)) {
			if (!fields || typeof fields !== 'object') continue;
			const keep = {};
			for (const f of GFIELDS) if (typeof fields[f.k] === 'number') keep[f.k] = fields[f.k];
			if (Object.keys(keep).length) out[id] = keep;
		}
		return out;
	}

	function writeGuns() {
		const guns = {};
		for (const id of Object.keys(S.guns).sort()) guns[id] = S.guns[id];
		return JSON.stringify({guns}, null, 2);
	}

	// --- history and draft ---

	function commit() {
		const now = snapshot();
		if (now === last) return;
		undo.push(last);
		if (undo.length > 300) undo.shift();
		redo.length = 0;
		last = now;
		saveDraft();
	}

	function travel(from, to, word) {
		commit();
		if (!from.length) return A.toast(`Nothing to ${word}`);
		to.push(last);
		last = from.pop();
		({v: S.values, g: S.guns} = JSON.parse(last));
		S.corps = JSON.parse(last).c || corpsDefaults();
		saveDraft();
		A.render();
	}

	function saveDraft() {
		try {
			localStorage.setItem(DRAFT, JSON.stringify({values: S.values, base: S.base, baseText: S.baseText, extra: S.extra, page: S.page, open: [...S.open], loadedAt: S.loadedAt,
				guns: S.guns, gunsBase: S.gunsBase, catalog: S.catalog === C.guns ? null : S.catalog, corps: S.corps, corpsBase: S.corpsBase, corpsBaseText: S.corpsBaseText}));
		} catch { /* no storage: the tab works without a draft */ }
	}

	function loadDraft() {
		try {
			const d = JSON.parse(localStorage.getItem(DRAFT));
			if (!d) return;
			if (Array.isArray(d.values)) S.values = C.def.map((v, i) => (Number.isFinite(d.values[i]) ? clamp(i, d.values[i]) : v));
			if (Array.isArray(d.base)) S.base = C.def.map((v, i) => (Number.isFinite(d.base[i]) ? d.base[i] : v));
			S.baseText = d.baseText || null;
			S.extra = d.extra || {};
			S.page = Math.min(C.pages.length, d.page || 0);
			S.guns = d.guns && typeof d.guns === 'object' ? d.guns : {};
			S.gunsBase = d.gunsBase || null;
			if (d.catalog?.guns) S.catalog = d.catalog;
			if (d.corps?.allied && d.corps?.hostile) S.corps = d.corps;
			S.corpsBase = d.corpsBase?.allied ? d.corpsBase : null;
			S.corpsBaseText = d.corpsBaseText ?? null;
			S.open = new Set(d.open || []);
			S.loadedAt = d.loadedAt || null;
			last = snapshot();
		} catch { /* a draft that cannot be read is passed over */ }
	}

	// --- the game's file ---

	/** A file's settings as the game reads them: each clamped, each one missing at its default. */
	function parse(text) {
		const o = JSON.parse(text);
		if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not a settings file');
		const values = C.def.map((d, i) => (typeof o[`v${i}`] === 'number' ? clamp(i, o[`v${i}`]) : d));
		const extra = {};
		for (const [k, v] of Object.entries(o)) {
			const m = /^v(\d+)$/.exec(k);
			if (!m || +m[1] >= C.count) extra[k] = v;
		}
		const known = Object.keys(o).filter(k => /^v\d+$/.test(k) && +k.slice(1) < C.count).length;
		return {values, extra, known};
	}

	/** How many settings a file has past the ones this app knows (its data older than the game). */
	function unknownSettings(extra) {
		return Object.keys(extra).filter(k => /^v\d+$/.test(k)).length;
	}

	function write() {
		const o = {};
		S.values.forEach((v, i) => { o[`v${i}`] = tidy(v); });
		Object.assign(o, S.extra);
		// The marks the game leaves once it has done a one-time fix-up (the Brawler's bare gun, the carrier's doubled reach...):
		// present, so it never does them again over these values.
		for (const m of C.marks || ['brMgBare']) o[m] = 1;
		return JSON.stringify(o, null, 2);
	}

	async function fileHandle(create, name = FILE) {
		const {folder} = A.folder();
		const config = await folder.getDirectoryHandle('config', {create});
		return config.getFileHandle(name, {create});
	}

	/** A config file's text, or null where there is none. */
	async function readOptional(name) {
		try {
			return await (await (await fileHandle(false, name)).getFile()).text();
		} catch (e) {
			if (e.name === 'NotFoundError') return null;
			throw e;
		}
	}

	/** The game folder linked and allowed, asking for it if need be. */
	async function folderReady() {
		if (!A.hasFolderApi()) return false;
		if (!A.folder().folder) await A.linkFolder();
		return A.folder().folder ? A.ensureFolder() : false;
	}

	async function readGame() {
		const file = await (await fileHandle(false)).getFile();
		return {text: await file.text(), time: file.lastModified};
	}

	function take(text, from, guns, corps = corpsDefaults(), corpsText = null) {
		const got = parse(text);
		commit();
		S.values = got.values;
		S.base = got.values.slice();
		S.baseText = text;
		S.extra = got.extra;
		S.guns = JSON.parse(JSON.stringify(guns));
		S.gunsBase = JSON.parse(JSON.stringify(guns));
		S.corps = JSON.parse(JSON.stringify(corps));
		S.corpsBase = JSON.parse(JSON.stringify(corps));
		S.corpsBaseText = corpsText;
		S.loadedAt = Date.now();
		commit();
		saveDraft();
		A.render();
		const changed = got.values.filter((v, i) => !same(v, C.def[i])).length, g = gunsSet();
		const newer = unknownSettings(got.extra);
		if (newer) A.toast(`The game has ${newer} setting${newer === 1 ? '' : 's'} this app does not know yet - kept as they are. Restart the app (npm start refreshes it) or run npm run gen:conquest.`, 'bad');
		A.toast(`${from}: ${changed} setting${changed === 1 ? '' : 's'} differ from the defaults${g ? ` · ${g} gun figure${g === 1 ? '' : 's'} set` : ''}${got.known < C.count ? ` · ${C.count - got.known} not in the file yet, at their defaults` : ''}`, 'good');
	}

	async function loadGame(quiet) {
		if (!(await folderReady())) {
			if (!quiet && !A.hasFolderApi()) importFile();
			return;
		}
		let text, gunsText, catalog, corpsText;
		try {
			text = await readOptional(FILE);
			gunsText = await readOptional(GUN_FILE);
			catalog = await readOptional(CATALOG_FILE);
			corpsText = await readOptional(CORPS_FILE);
		} catch (e) {
			if (!quiet) A.toast(`Could not read the game's settings: ${e.message}`, 'bad');
			return;
		}
		try {
			const c = catalog && JSON.parse(catalog);
			if (c?.guns?.length) S.catalog = c;
		} catch { /* a catalog that cannot be read: the one built in stays */ }
		if (text == null) {
			if (!quiet) A.toast(`No config/${FILE} in ${A.folder().folder.name} yet: the game writes it the first time a world starts. Saving here makes it.`, 'bad');
			text = '{}';
		}
		let guns;
		try {
			guns = parseGuns(gunsText);
		} catch (e) {
			if (!quiet) A.toast(`config/${GUN_FILE} could not be read (${e.message}); the guns start empty`, 'bad');
			guns = {};
		}
		let corps;
		try {
			corps = parseCorps(corpsText);
		} catch (e) {
			if (!quiet) A.toast(`config/${CORPS_FILE} could not be read (${e.message}); the game uses its default corps`, 'bad');
			corps = corpsDefaults();
		}
		const mine = unsavedCount();
		if (!quiet && mine && text !== S.baseText) {
			const ok = await A.ask('Load the game\'s settings?', `You have ${mine} change${mine === 1 ? '' : 's'} not yet saved to the game. Loading puts every setting back to what the game's file has.`,
				[['Cancel', false], ['Load and lose them', true, 'primary']]);
			if (!ok) return;
		}
		if (quiet && mine) return A.render(); // a draft with changes in it is never overwritten unasked
		take(text, `Loaded from ${A.folder().folder.name}`, guns, corps, corpsText);
	}

	async function saveGame() {
		commit();
		if (!A.hasFolderApi()) return exportFile();
		if (!(await folderReady())) return;
		try {
			let current = null;
			try {
				current = (await readGame()).text;
			} catch (e) {
				if (e.name !== 'NotFoundError') throw e;
			}
			// The game wrote the file since it was read here (an admin moved a slider in game): its changes are kept unless these overwrite them.
			if (current != null && S.baseText != null && current !== S.baseText) {
				const theirs = parse(current).values, base = S.base || C.def;
				const gameMoved = theirs.map((v, i) => i).filter(i => !same(theirs[i], base[i]));
				if (gameMoved.length) {
					const both = gameMoved.filter(i => !same(S.values[i], base[i]) && !same(S.values[i], theirs[i]));
					const pick = await A.ask('The game changed the settings', A.h('div', {},
						A.h('p', {}, `Since you loaded them, the game's file changed ${gameMoved.length} setting${gameMoved.length === 1 ? '' : 's'}${both.length ? `, ${both.length} of which you changed too` : ''}:`),
						A.h('div', {class: 'cq-difflist'}, gameMoved.slice(0, 30).map(i => A.h('div', {}, A.h('span', {}, label(i), A.h('small', {}, placeOf(i))),
							A.h('b', {}, `${show(i, base[i])} → ${show(i, theirs[i])}`), both.includes(i) ? A.h('em', {}, `yours: ${show(i)}`) : null)))),
						[['Cancel', null], ['Overwrite with mine', 'mine'], ['Keep the game\'s, then save', 'merge', 'primary']]);
					if (!pick) return;
					if (pick === 'merge') {
						for (const i of gameMoved) if (same(S.values[i], base[i])) S.values[i] = theirs[i];
						commit();
					}
				}
			}
			// The in-game corps editor saved its men since they were read here: theirs are kept unless these replace them.
			if (corpsPending().length && S.corpsBase) {
				const now = await readOptional(CORPS_FILE);
				if (now != null && now !== S.corpsBaseText) {
					let theirs = null;
					try {
						theirs = parseCorps(now);
					} catch { /* unreadable: the game would use its defaults, so writing over it loses nothing */ }
					const moved = theirs ? SIDES.filter(side => !sameSide(theirs[side], S.corpsBase[side])) : [];
					if (moved.length) {
						const pick = await A.ask('The game changed the corps', `Since you loaded them, the in-game editor saved new men for ${moved.map(s => SIDE_NAME[s].toLowerCase()).join(' and ')}.`,
							[['Cancel', null], ['Overwrite with mine', 'mine'], ['Keep the game\'s, then save', 'merge', 'primary']]);
						if (!pick) return;
						if (pick === 'merge') {
							// a side the game changed is taken whole from the game; the other side keeps what was changed here
							for (const side of moved) S.corps[side] = theirs[side];
							S.corpsBase = theirs;
							S.corpsBaseText = now;
							commit();
						}
					}
				}
			}
			if (current != null) {
				try {
					Object.assign(S.extra, parse(current).extra);
				} catch { /* the game's file unreadable: nothing in it to keep */ }
			}
			const text = write();
			const out = await (await fileHandle(true)).createWritable();
			await out.write(text);
			await out.close();
			const gunsChanged = gunPending().length;
			if (gunsChanged || (S.gunsBase == null && gunsSet())) {
				const g = await (await fileHandle(true, GUN_FILE)).createWritable();
				await g.write(writeGuns());
				await g.close();
			}
			const corpsChanged = corpsPending();
			if (corpsChanged.length) {
				const c = await (await fileHandle(true, CORPS_FILE)).createWritable();
				const corpsText = writeCorps();
				await c.write(corpsText);
				await c.close();
				S.corpsBaseText = corpsText;
			}
			const n = (S.base ? pending().length : S.values.filter((v, i) => changedFromDefault(i)).length) + gunsChanged + corpsChanged.length;
			S.base = S.values.slice();
			S.baseText = text;
			S.gunsBase = JSON.parse(JSON.stringify(S.guns));
			S.corpsBase = JSON.parse(JSON.stringify(S.corps));
			S.loadedAt = Date.now();
			saveDraft();
			A.render();
			A.toast(`Saved to ${A.folder().folder.name}/config/${FILE}${n ? ` · ${n} change${n === 1 ? '' : 's'}` : ''}${gunsChanged ? ` and config/${GUN_FILE}` : ''}${corpsChanged.length ? ` and config/${CORPS_FILE}` : ''}. The game picks it up when a world starts or a player joins${corpsChanged.length ? '; the corps when Minecraft next starts' : ''}.`, 'good');
		} catch (e) {
			if (e.name !== 'AbortError') A.toast(`Could not save: ${e.message}`, 'bad');
		}
	}

	function download(name, text) {
		const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
		const a = A.h('a', {href: url, download: name});
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}

	function exportFile() {
		commit();
		download(FILE, write());
		if (gunsSet()) download(GUN_FILE, writeGuns());
		const corps = SIDES.some(side => !sameSide(S.corps[side], corpsDefaults()[side]));
		if (corps) download(CORPS_FILE, writeCorps());
		A.toast(`Downloaded ${[FILE, gunsSet() ? GUN_FILE : null, corps ? CORPS_FILE : null].filter(Boolean).join(', ')}. Put them in the game folder's config folder.`);
	}

	function importFile() {
		const input = A.h('input', {type: 'file', accept: '.json,application/json', onchange: async () => {
			const f = input.files[0];
			if (f) await drop(f);
		}});
		input.click();
	}

	/** A settings file dropped or picked: its values in, as changes to save (the game's file stays what it is). */
	async function drop(file) {
		try {
			const text = await file.text();
			if (/"(allied|hostile)"\s*:\s*\[/.test(text) && !/"v0"\s*:/.test(text)) {
				const corps = parseCorps(text);
				commit();
				S.corps = corps;
				commit();
				A.render();
				return A.toast(`Opened ${file.name}: ${corps.allied.length} men in your corps, ${corps.hostile.length} in the hostile one, not saved yet`, 'good');
			}
			if (/"guns"\s*:/.test(text) && !/"v0"\s*:/.test(text)) {
				const guns = parseGuns(text);
				commit();
				S.guns = guns;
				commit();
				A.render();
				return A.toast(`Opened ${file.name}: ${gunsSet()} gun figure${gunsSet() === 1 ? '' : 's'}, not saved yet`, 'good');
			}
			const got = parse(text);
			commit();
			S.values = got.values;
			for (const [k, v] of Object.entries(got.extra)) if (!(C.marks || ['brMgBare']).includes(k)) S.extra[k] = v;
			commit();
			A.render();
			A.toast(`Opened ${file.name}${S.base ? `: ${pending().length} change${pending().length === 1 ? '' : 's'} from the game's file, not saved yet` : ''}`, 'good');
		} catch (e) {
			A.toast(`${file.name} is not a Conquest settings file (${e.message})`, 'bad');
		}
	}

	// --- changing values ---

	function set(i, v, hardly) {
		S.values[i] = snapToStep(i, v, hardly);
		refresh();
	}
	/** A typed number is kept as typed (in range); a slider's move falls on its step. */
	const snapToStep = (i, v, typed) => (typed ? tidy(clamp(i, v)) : snap(i, v));

	function resetTo(list, to) {
		for (const i of list) S.values[i] = to[i];
		commit();
		A.render();
	}

	/** After a value moves: everything but the row being dragged brought up to date. */
	function refresh(skipRow) {
		for (const row of document.querySelectorAll('.cq-row')) {
			if (row === skipRow) continue;
			paintRow(row);
		}
		A.renderRail();
		A.renderTop();
		A.renderPalette();
		document.querySelectorAll('.cq-sec:not(.cq-gunsec)').forEach(paintSection);
		document.querySelectorAll('.cq-corps').forEach(paintCorpsSum);
		document.querySelector('.cq-head')?.replaceWith(S.page === GUN_PAGE ? gunsHead() : pageHead());
	}

	// --- top bar ---

	function top() {
		const n = unsavedCount(), {folder, live} = A.folder();
		const where = !A.hasFolderApi() ? 'Downloads (no folder access in this browser)' : !folder ? 'No game folder linked' : !live ? `Reconnect ${folder.name}` : S.base ? `${folder.name}/config/${FILE}` : `${folder.name} · not loaded yet`;
		return [
			A.h('button', {type: 'button', class: 'file cq-file', title: S.loadedAt ? `Last read or written ${new Date(S.loadedAt).toLocaleString()}` : 'Where the game keeps the Conquest settings',
				onclick: () => loadGame(false)}, n ? A.h('b') : null, A.h('span', {class: 'cq-where'}, where), n ? A.h('em', {}, `${n} unsaved`) : null),
			A.h('div', {class: 'bar'},
				A.btn('undo', 'Undo', () => travel(undo, redo, 'undo'), {class: 'icon ghost', disabled: !undo.length, title: 'Undo (Ctrl+Z)'}),
				A.btn('redo', 'Redo', () => travel(redo, undo, 'redo'), {class: 'icon ghost', disabled: !redo.length, title: 'Redo (Ctrl+Y)'}),
				A.btn('open', 'Load from game', () => loadGame(false), {text: 'Load', title: `Read config/${FILE} from the game folder`}),
				A.btn('folder', 'Import a settings file', importFile, {class: 'ghost', text: 'Import', title: 'Open a .json settings file (or drop one on the page)'}),
				A.btn('copy', 'Export', exportFile, {class: 'ghost', text: 'Export', title: `Download these settings as ${FILE}`}),
				A.btn('save', 'Save to game', saveGame, {class: 'primary', text: n ? `Save ${n}` : 'Save', title: 'Write these settings into the game folder (Ctrl+S)'})),
		];
	}

	// --- rail ---

	function rail() {
		const search = A.h('div', {class: 'search'}, A.h('label', {}, A.icon('search'),
			A.h('input', {type: 'search', placeholder: 'Find a setting', value: S.query, 'data-k': 'cq-search', spellcheck: 'false', 'aria-label': 'Find a setting',
				oninput: e => { S.query = e.target.value; A.renderEditor(); A.renderRail(); },
				onkeydown: e => { if (e.key === 'Escape') { S.query = ''; e.target.blur(); A.render(); } }}),
			A.h('kbd', {}, '/')),
			A.h('p', {}, S.query ? A.h('span', {}, A.h('b', {}, String(matches().length)), ' matching') : `${C.count} settings · ${S.values.filter((v, i) => changedFromDefault(i)).length} off their defaults`));
		const pages = ORDER.map(pi => {
			if (pi === GUN_PAGE) return gunsRail();
			const p = C.pages[pi];
			const corpsHere = SIDES.filter(side => p.sections.some(sec => sec.sliders.some(sl => sl.special === 'corps' && sl.side === side)));
			const idx = pageIdx(p), off = idx.filter(changedFromDefault).length + corpsHere.filter(side => !sameSide(S.corps[side], corpsDefaults()[side])).length;
			const mine = idx.filter(i => S.base && unsaved(i)).length + corpsHere.filter(side => corpsPending().includes(side)).length;
			const on = pi === S.page && !S.query;
			return [
				A.h('button', {type: 'button', class: 'cq-page', 'aria-current': String(on), onclick: () => goPage(pi)},
					A.h('span', {}, p.label), off ? A.h('small', {title: `${off} off their defaults`}, String(off)) : A.h('small'), mine ? A.h('i', {class: 'mark', title: `${mine} not saved to the game`}) : A.h('i')),
				on && p.sections.length > 1 ? A.h('div', {class: 'cq-secs'}, p.sections.map((sec, si) => {
					const sidx = sectionIdx(sec), so = sidx.filter(changedFromDefault).length, sm = sidx.some(i => S.base && unsaved(i));
					return A.h('button', {type: 'button', class: 'cq-secrow', onclick: () => jump(pi, si)}, A.h('span', {}, sec.label),
						A.h('small', {}, so ? String(so) : ''), sm ? A.h('i', {class: 'mark'}) : A.h('i'));
				})) : null,
			];
		});
		return [search,
			A.h('div', {class: 'rail-head'}, A.h('span', {class: 'eyebrow'}, 'Admin pages'),
				A.h('button', {type: 'button', class: 'chip', 'aria-pressed': String(S.onlyChanged), title: 'Show only settings off their defaults', onclick: () => { S.onlyChanged = !S.onlyChanged; A.render(); }}, 'Changed')),
			A.h('div', {class: 'scroll'}, pages)];
	}

	/** The rail's pages in order: the in-game ones, the Guns page after Munitions. */
	const ORDER = (() => {
		const order = C.pages.map((p, pi) => pi), at = C.pages.findIndex(p => p.key === 'munitions');
		order.splice(at >= 0 ? at + 1 : order.length, 0, GUN_PAGE);
		return order;
	})();

	function gunsRail() {
		const on = S.page === GUN_PAGE && !S.query, set = Object.keys(S.guns).length, mine = gunPending().length;
		const tiers = [...new Set(cat().guns.map(g => g.tier))].sort();
		return [
			A.h('button', {type: 'button', class: 'cq-page', 'aria-current': String(on), onclick: () => goPage(GUN_PAGE)},
				A.h('span', {}, 'Guns'), set ? A.h('small', {title: `${set} gun${set === 1 ? '' : 's'} adjusted`}, String(set)) : A.h('small'), mine ? A.h('i', {class: 'mark', title: `${mine} not saved to the game`}) : A.h('i')),
			on ? A.h('div', {class: 'cq-secs'}, tiers.map(t => {
				const n = cat().guns.filter(g => g.tier === t && S.guns[g.id]).length, m = gunPending().some(x => gunById(x.id)?.tier === t);
				return A.h('button', {type: 'button', class: 'cq-secrow', onclick: () => jumpTier(t)}, A.h('span', {}, `${TIER_NAMES[t]}${t === munTier() ? ' · Munitions' : ''}`),
					A.h('small', {}, n ? String(n) : ''), m ? A.h('i', {class: 'mark'}) : A.h('i'));
			})) : null,
		];
	}

	const tierOpen = t => S.open.has(`gtier${t}`) !== (t === munTier());
	function jumpTier(t) {
		S.page = GUN_PAGE;
		S.query = '';
		if (!tierOpen(t)) toggleTier(t);
		saveDraft();
		A.render();
		document.querySelector(`.cq-sec[data-key="gtier${t}"]`)?.scrollIntoView({block: 'start', behavior: 'smooth'});
	}
	function toggleTier(t) {
		const k = `gtier${t}`;
		S.open.has(k) ? S.open.delete(k) : S.open.add(k);
	}

	function goPage(pi) {
		commit();
		S.page = pi;
		S.query = '';
		saveDraft();
		A.render();
		document.querySelector('#editor .scroll')?.scrollTo(0, 0);
	}

	function jump(pi, si) {
		S.page = pi;
		S.query = '';
		const sec = C.pages[pi].sections[si];
		if (sec.folds) S.open.add(sec.key);
		saveDraft();
		A.render();
		document.querySelector(`.cq-sec[data-key="${sec.key}"]`)?.scrollIntoView({block: 'start', behavior: 'smooth'});
	}

	// --- the settings ---

	function matches() {
		const words = S.query.toLowerCase().split(/\s+/).filter(Boolean);
		const out = [];
		C.pages.forEach((p, pi) => p.sections.forEach((sec, si) => sec.sliders.forEach(sl => {
			if (sl.i == null) return;
			const hay = `${p.label} ${sec.label} ${sl.label} ${NAME[sl.i]} ${UNIT[kind(sl.i).k]} ${kind(sl.i).k === 'gold' ? 'gold price' : ''}`.toLowerCase();
			if (words.every(w => hay.includes(w)) && (!S.onlyChanged || changedFromDefault(sl.i))) out.push({pi, si, i: sl.i});
		})));
		return out;
	}

	function gunMatches() {
		const words = S.query.toLowerCase().split(/\s+/).filter(Boolean);
		return cat().guns.filter(g => {
			const hay = `guns gun ${g.name} ${g.id} ${TIER_NAMES[g.tier]} tier ${g.tier} ${isMun(g) ? 'munitions price' : ''} ${g.shoots ? 'damage range fire rate recoil' : ''}`.toLowerCase();
			return words.every(w => hay.includes(w)) && (!S.onlyChanged || S.guns[g.id]);
		});
	}

	function editor() {
		if (S.query) {
			const found = matches();
			const groups = new Map();
			for (const m of found) {
				const k = `${m.pi}:${m.si}`;
				if (!groups.has(k)) groups.set(k, []);
				groups.get(k).push(m.i);
			}
			const guns = gunMatches();
			return [A.h('div', {class: 'ed-head'}, A.h('div', {}, A.h('h1', {}, `“${S.query}”`), A.h('div', {class: 'sub'}, `${found.length} setting${found.length === 1 ? '' : 's'} across ${groups.size} section${groups.size === 1 ? '' : 's'}${guns.length ? ` · ${guns.length} gun${guns.length === 1 ? '' : 's'}` : ''}`))),
				A.h('div', {class: 'scroll cq-body'}, found.length || guns.length ? [...[...groups].map(([k, list]) => {
					const [pi, si] = k.split(':').map(Number), sec = C.pages[pi].sections[si];
					return section(sec, list, `${C.pages[pi].label} › ${sec.label}`, true);
				}), guns.length ? A.h('section', {class: 'cq-sec cq-gunsec open'}, A.h('header', {}, A.h('div', {class: 'cq-fold'}, A.h('h2', {}, 'Guns'))), A.h('div', {class: 'cq-guns'}, guns.map(gunCard))) : null]
					: A.h('p', {class: 'empty'}, A.h('b', {}, 'Nothing matches'), 'Try a vehicle, a gun, or a word like price, range or damage.'))];
		}
		if (S.page === GUN_PAGE) return gunsEditor();
		const p = C.pages[S.page];
		const body = p.sections.map(sec => {
			const list = sectionIdx(sec).filter(i => !S.onlyChanged || changedFromDefault(i));
			if (sec.sliders.some(sl => sl.special === 'free')) return freeCard(sec);
			const corps = sec.sliders.find(sl => sl.special === 'corps');
			const corpsOff = corps && !sameSide(S.corps[corps.side], corpsDefaults()[corps.side]);
			if (S.onlyChanged && !list.length && !corpsOff) return null;
			const el = section(sec, list, sec.label, !sec.folds || S.open.has(sec.key) || S.onlyChanged);
			if (corps && el.classList.contains('open') && (!S.onlyChanged || corpsOff)) el.append(corpsCard(corps.side, corps.label));
			return el;
		}).filter(Boolean);
		return [pageHead(), A.h('div', {class: 'scroll cq-body'}, body.length ? body : A.h('p', {class: 'empty'}, A.h('b', {}, 'Nothing changed here'), 'Every setting on this page is at its default.'))];
	}

	function pageHead() {
		const p = C.pages[S.page], idx = pageIdx(p);
		const folds = p.sections.filter(sec => sec.folds);
		const allOpen = folds.every(sec => S.open.has(sec.key));
		const off = idx.filter(changedFromDefault);
		return A.h('div', {class: 'ed-head cq-head'},
			A.h('div', {}, A.h('h1', {}, p.label), A.h('div', {class: 'sub'}, `${idx.length} settings in ${p.sections.length} section${p.sections.length === 1 ? '' : 's'}`, off.length ? [' · ', A.h('b', {}, `${off.length} off their defaults`)] : ' · all at their defaults')),
			A.h('div', {class: 'bar'},
				folds.length ? A.h('button', {type: 'button', class: 'btn small ghost', onclick: () => {
					for (const sec of folds) allOpen ? S.open.delete(sec.key) : S.open.add(sec.key);
					saveDraft();
					A.renderEditor();
				}}, allOpen ? 'Collapse all' : 'Expand all') : null,
				off.length ? A.btn('reset', 'Reset this page to defaults', async () => {
					if (await A.ask(`Reset ${p.label}?`, `${off.length} setting${off.length === 1 ? '' : 's'} on this page go back to their defaults. Undo brings them back.`, [['Cancel', false], ['Reset', true, 'primary']])) resetTo(off, C.def);
				}, {class: 'small ghost danger', text: 'Reset page'}) : null));
	}

	function section(sec, list, title, open) {
		const el = A.h('section', {class: `cq-sec${open ? ' open' : ''}`, 'data-key': sec.key},
			A.h('header', {},
				A.h('button', {type: 'button', class: 'cq-fold', 'aria-expanded': String(open), disabled: !sec.folds || S.query || S.onlyChanged, onclick: () => {
					S.open.has(sec.key) ? S.open.delete(sec.key) : S.open.add(sec.key);
					saveDraft();
					A.renderEditor();
				}}, sec.folds && !S.query && !S.onlyChanged ? A.h('span', {class: 'cq-caret'}, '›') : null, A.h('h2', {}, title), A.h('span', {class: 'cq-sum'})),
				A.h('button', {type: 'button', class: 'btn small ghost danger cq-secreset', title: 'Put this section back to its defaults', onclick: () => resetTo(list.filter(changedFromDefault), C.def)}, 'Reset')),
			open ? A.h('div', {class: 'cq-rows'}, list.map(row)) : null);
		el._list = list;
		paintSection(el);
		return el;
	}

	function paintSection(el) {
		const list = el._list || [], off = list.filter(changedFromDefault).length, mine = list.filter(i => S.base && unsaved(i)).length;
		const sum = el.querySelector('.cq-sum');
		if (sum) sum.replaceChildren(...[
			!el.classList.contains('open') ? `${list.length} settings` : null,
			off ? A.h('b', {}, `${off} changed`) : null,
			mine ? A.h('em', {}, `${mine} unsaved`) : null].filter(Boolean).flatMap((x, k) => (k ? [' · ', x] : [x])));
		const reset = el.querySelector('.cq-secreset');
		if (reset) reset.hidden = !off;
	}

	function row(i) {
		const k = kind(i), range = A.h('input', {type: 'range', min: C.min[i], max: C.max[i], step: stepOf(i), value: S.values[i], 'aria-label': label(i),
			oninput: e => {
				S.values[i] = snap(i, +e.target.value);
				paintRow(el, true);
				refresh(el);
			},
			onchange: () => commit()});
		const box = A.h('input', {type: 'number', class: 'cq-num', min: toBox(i, C.min[i]), max: toBox(i, C.max[i]), step: 'any', value: toBox(i, S.values[i]), 'aria-label': `${label(i)} value`,
			onchange: e => {
				const n = parseFloat(e.target.value);
				if (!Number.isFinite(n)) return paintRow(el);
				set(i, fromBox(i, n), true);
				commit();
				paintRow(el);
			},
			onkeydown: e => {
				if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
				e.preventDefault();
				const by = stepOf(i) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
				set(i, S.values[i] + by);
				commit();
				paintRow(el);
			}});
		const pos = (C.def[i] - C.min[i]) / (C.max[i] - C.min[i] || 1) * 100;
		const el = A.h('div', {class: 'cq-row', 'data-i': i},
			A.h('i', {class: 'cq-dot', title: 'Not saved to the game yet'}),
			A.h('label', {class: 'cq-label', title: `${placeOf(i)} · v${i} ${NAME[i]}`}, label(i)),
			A.h('div', {class: 'cq-track', style: `--d:${pos}%`, title: `Default ${show(i, C.def[i])}`}, range),
			A.h('div', {class: 'cq-val'}, box, A.h('span', {}, UNIT[k.k])),
			A.h('output', {}),
			A.h('button', {type: 'button', class: 'btn small icon ghost cq-reset', 'aria-label': `Back to the default, ${show(i, C.def[i])}`, title: `Back to the default, ${show(i, C.def[i])}`,
				onclick: () => { S.values[i] = C.def[i]; commit(); refresh(); }}, A.icon('reset')));
		el._i = i;
		el._range = range;
		el._box = box;
		paintRow(el);
		return el;
	}

	function paintRow(el, dragging) {
		const i = el._i, v = S.values[i];
		if (!dragging) el._range.value = v;
		if (document.activeElement !== el._box) el._box.value = toBox(i, v);
		el.querySelector('output').textContent = show(i);
		el.classList.toggle('off-default', changedFromDefault(i));
		el.classList.toggle('unsaved', !!S.base && unsaved(i));
		el.querySelector('.cq-reset').style.visibility = changedFromDefault(i) ? 'visible' : 'hidden';
		const was = S.base && unsaved(i) ? `In the game now: ${show(i, S.base[i])}` : '';
		el.querySelector('.cq-dot').title = was || 'Not saved to the game yet';
	}

	// --- the Guns page ---

	function gunsHead() {
		const guns = cat().guns, set = Object.keys(S.guns).length, tiers = [...new Set(guns.map(g => g.tier))];
		const allOpen = tiers.every(tierOpen);
		return A.h('div', {class: 'ed-head cq-head'},
			A.h('div', {}, A.h('h1', {}, 'Guns'), A.h('div', {class: 'sub'}, `${guns.length} guns in ${tiers.length} tiers · ${TIER_NAMES[munTier()]} sold in the Munitions Chest`,
				set ? [' · ', A.h('b', {}, `${set} adjusted`)] : ' · all as built')),
			A.h('div', {class: 'bar'},
				A.h('button', {type: 'button', class: 'btn small ghost', onclick: () => {
					for (const t of tiers) if (tierOpen(t) === allOpen) toggleTier(t);
					saveDraft();
					A.renderEditor();
				}}, allOpen ? 'Collapse all' : 'Expand all'),
				set ? A.btn('reset', 'Put every gun back as built', async () => {
					if (await A.ask('Reset every gun?', `All ${set} adjusted gun${set === 1 ? '' : 's'} go back to as built. Undo brings them back.`, [['Cancel', false], ['Reset', true, 'primary']])) {
						S.guns = {};
						commit();
						A.render();
					}
				}, {class: 'small ghost danger', text: 'Reset guns'}) : null));
	}

	function gunsEditor() {
		if (!cat().guns.length) {
			return [gunsHead(), A.h('div', {class: 'scroll cq-body'}, A.h('p', {class: 'empty'}, A.h('b', {}, 'No gun list yet'),
				`Start the game once with the current Fight Arena, then Load: it writes config/${CATALOG_FILE} with every gun.`))];
		}
		const tiers = [...new Set(cat().guns.map(g => g.tier))].sort();
		return [gunsHead(), A.h('div', {class: 'scroll cq-body'},
			A.h('p', {class: 'cq-lead'}, 'These hold in every Conquest world, over the world\'s own gun settings. A blank box keeps the gun as built; the grey figure is what that is. Damage is the whole shot at the muzzle.'),
			tiers.map(t => tierSection(t)))];
	}

	function tierSection(t) {
		const guns = cat().guns.filter(g => g.tier === t && (!S.onlyChanged || S.guns[g.id])), open = tierOpen(t) || S.onlyChanged;
		if (S.onlyChanged && !guns.length) return null;
		const set = guns.filter(g => S.guns[g.id]).length, mine = new Set(gunPending().map(x => x.id)), unsavedHere = guns.filter(g => mine.has(g.id)).length;
		const shooters = guns.filter(g => g.shoots);
		const scale = {};
		const bulk = shooters.length ? A.h('div', {class: 'cq-bulk'}, A.h('span', {}, 'Whole tier'),
			[['damage', 'Damage'], ['fireRate', 'Fire rate'], ['recoil', 'Recoil']].map(([k, name]) => A.h('label', {class: 'cq-val'},
				A.h('input', {type: 'number', class: 'cq-num', placeholder: '100', step: 'any', 'aria-label': `${name} for the whole tier, percent of as built`, oninput: e => { scale[k] = e.target.value; }}),
				A.h('span', {}, `% ${name.toLowerCase()}`))),
			A.h('button', {type: 'button', class: 'btn small', title: 'Set these on every gun in the tier, as a percent of each one as built', onclick: () => {
				let n = 0;
				for (const [k, raw] of Object.entries(scale)) {
					const pct = parseFloat(raw);
					if (!Number.isFinite(pct)) continue;
					for (const g of shooters) setGun(g.id, k, k === 'damage' ? g.damage * pct / 100 : pct / 100);
					n++;
				}
				if (!n) return A.toast('Type a percent first');
				commit();
				A.render();
			}}, 'Apply')) : null;
		return A.h('section', {class: `cq-sec cq-gunsec${open ? ' open' : ''}`, 'data-key': `gtier${t}`},
			A.h('header', {},
				A.h('button', {type: 'button', class: 'cq-fold', 'aria-expanded': String(open), disabled: S.onlyChanged, onclick: () => { toggleTier(t); saveDraft(); A.renderEditor(); }},
					S.onlyChanged ? null : A.h('span', {class: 'cq-caret'}, '›'), A.h('h2', {}, TIER_NAMES[t]),
					t === munTier() ? A.h('em', {class: 'cq-tag'}, 'Munitions Chest') : null,
					A.h('span', {class: 'cq-sum'}, [open ? null : `${guns.length} guns`, set ? A.h('b', {}, `${set} adjusted`) : null, unsavedHere ? A.h('em', {}, `${unsavedHere} unsaved`) : null]
						.filter(Boolean).flatMap((x, k) => (k ? [' · ', x] : [x])))),
				set ? A.h('button', {type: 'button', class: 'btn small ghost danger', title: 'Put this tier\'s guns back as built', onclick: () => {
					for (const g of guns) delete S.guns[g.id];
					commit();
					A.render();
				}}, 'Reset') : null),
			open ? [bulk, A.h('div', {class: 'cq-guns'}, guns.map(gunCard))] : null);
	}

	function gunCard(g) {
		const fields = fieldsOf(g), mine = new Set(gunPending().filter(x => x.id === g.id).map(x => x.k));
		const el = A.h('div', {class: `cq-gun${S.guns[g.id] ? ' set' : ''}`, 'data-gun': g.id},
			A.h('div', {class: 'cq-gun-head'},
				A.h('b', {}, g.name), A.h('small', {}, `${TIER_NAMES[g.tier]}${isMun(g) ? ' · Munitions' : ''}${g.shoots ? '' : ' · launcher'}`),
				S.guns[g.id] ? A.h('button', {type: 'button', class: 'btn small icon ghost', title: 'Back to as built', 'aria-label': `Put ${g.name} back as built`, onclick: () => {
					delete S.guns[g.id];
					commit();
					A.render();
				}}, A.icon('reset')) : null),
			fields.length ? A.h('div', {class: 'cq-gun-fields'}, fields.map(f => {
				const has = S.guns[g.id]?.[f.k] != null;
				const box = A.h('input', {type: 'number', class: 'cq-num', step: 'any', 'data-k': `gun:${g.id}:${f.k}`, placeholder: String(gunToBox(f.k, ownOf(g, f.k))),
					value: has ? gunToBox(f.k, S.guns[g.id][f.k]) : '', 'aria-label': `${g.name} ${f.label}`,
					onchange: e => {
						const raw = e.target.value.trim(), n = parseFloat(raw);
						setGun(g.id, f.k, raw === '' || !Number.isFinite(n) ? null : gunFromBox(f.k, n));
						commit();
						const fresh = gunCard(g);
						el.replaceWith(fresh);
						refresh();
					}});
				return A.h('label', {class: `cq-gf${has ? ' set' : ''}${mine.has(f.k) ? ' unsaved' : ''}`, title: `As built: ${gunShow(f.k, ownOf(g, f.k))}${f.munitions ? ' (the Munitions page\'s share of its shop price)' : ''}`},
					A.h('span', {}, f.label), A.h('div', {class: 'cq-val'}, box, A.h('span', {}, f.unit)));
			})) : A.h('p', {class: 'cq-note'}, 'A launcher: only its price can be set, and it is not sold in the Munitions Chest.'));
		return el;
	}

	function revealGun(id) {
		const g = gunById(id);
		if (!g) return;
		S.query = '';
		S.page = GUN_PAGE;
		if (!tierOpen(g.tier)) toggleTier(g.tier);
		A.render();
		const el = document.querySelector(`.cq-gun[data-gun="${id}"]`);
		if (el) {
			el.scrollIntoView({block: 'center', behavior: 'smooth'});
			el.classList.add('flash');
			setTimeout(() => el.classList.remove('flash'), 1200);
		}
	}

	// --- the corps' men, on the Corps page ---

	const HEALTH_OF = {allied: 'CORPS_HEALTH', hostile: 'HC_HEALTH'}, DAMAGE_OF = {allied: 'CORPS_DAMAGE', hostile: 'HC_DAMAGE'};
	const select = (value, options, attrs) => A.h('select', attrs, options.map(([v, text]) => A.h('option', {value: v, selected: v === value}, text)));

	/** Changing a side's men: then saved in history and drawn again. */
	function editCorps(side, fn) {
		const men = S.corps[side].map(m => ({...m}));
		fn(men);
		S.corps = {...S.corps, [side]: men};
		commit();
		const card = document.querySelector(`.cq-corps[data-side="${side}"]`);
		if (card) card.replaceWith(corpsCard(side, card._label));
		refresh();
	}

	function corpsCard(side, title = 'Men and guns') {
		const men = S.corps[side], base = (S.corpsBase || corpsDefaults())[side], def = corpsDefaults()[side];
		const other = side === 'allied' ? 'hostile' : 'allied';
		const atDefault = sameSide(men, def);
		const el = A.h('div', {class: 'cq-corps', 'data-side': side},
			A.h('div', {class: 'cq-corps-head'},
				A.h('h3', {}, title), A.h('span', {class: 'cq-corps-sum'}),
				A.h('div', {class: 'bar'},
					A.h('button', {type: 'button', class: 'btn small ghost', title: `Make these men the same as ${SIDE_NAME[other].toLowerCase()}'s (roles and set guns)`,
						onclick: () => editCorps(side, list => list.splice(0, list.length, ...S.corps[other].map(m => ({...m}))))}, `Copy ${SIDE_NAME[other].toLowerCase()}`),
					atDefault ? null : A.h('button', {type: 'button', class: 'btn small ghost danger', title: 'Back to the game\'s default corps',
						onclick: () => editCorps(side, list => list.splice(0, list.length, ...def))}, 'Defaults'),
					A.btn('plus', 'Add a man', () => editCorps(side, list => list.push({role: 'rifleman', primary: '', sidearm: ''})),
						{class: 'small', text: 'Add man', disabled: men.length >= CP.maxMen, title: men.length >= CP.maxMen ? `A corps has at most ${CP.maxMen} men` : 'Add a Rifleman'}))),
			A.h('div', {class: 'cq-men'}, men.map((m, k) => manRow(side, m, k, base))),
			A.h('p', {class: 'cq-note'}, `In config/${CORPS_FILE}. A corps raised or redeployed after a change is made up as it then stands. Fight Arena reads this file when Minecraft starts, and the in-game editor's Save replaces it.`));
		el._label = title;
		paintCorpsSum(el);
		return el;
	}

	/** The card's line: how many men, the health the whole corps has at its Health setting, the roles in it. */
	function paintCorpsSum(el) {
		const side = el.dataset.side, men = S.corps[side];
		const hp = men.reduce((n, m) => n + roleOf(m.role).health, 0) * val(HEALTH_OF[side]);
		const mix = {};
		for (const m of men) mix[roleOf(m.role).name] = (mix[roleOf(m.role).name] || 0) + 1;
		el.querySelector('.cq-corps-sum').replaceChildren(
			A.h('b', {}, `${men.length} of ${CP.maxMen} men`), ` · ${comma(hp)} HP in all at ${Math.round(val(HEALTH_OF[side]) * 100)}% health, ${Math.round(val(DAMAGE_OF[side]) * 100)}% gun damage · `,
			Object.entries(mix).map(([r, n]) => `${n} ${r}`).join(', ') || 'no men');
	}

	function manRow(side, m, k, base) {
		const r = roleOf(m.role), men = S.corps[side];
		const ownP = r[side].primary, ownS = r[side].sidearm;
		const change = fn => editCorps(side, list => { list[k] = {...list[k], ...fn}; });
		return A.h('div', {class: `cq-man${sameMan(m, base[k]) ? '' : ' unsaved'}`, title: sameMan(m, base[k]) ? '' : base[k] ? `In the game now: ${manText(base[k], side)}` : 'Not in the game\'s corps yet'},
			A.h('span', {class: 'cq-man-n'}, String(k + 1)),
			select(m.role, CP.roles.map(x => [x.key, x.name]), {'aria-label': `Man ${k + 1} role`, onchange: e => change({role: e.target.value})}),
			select(m.primary, [['', `${gunName(ownP)} (role's)`], ...PRIMARIES.filter(g => g.id !== ownP).map(g => [g.id, g.name])],
				{'aria-label': `Man ${k + 1} main gun`, class: m.primary ? 'set' : '', onchange: e => change({primary: e.target.value})}),
			select(m.sidearm, [['', `${gunName(ownS)} (role's)`], [CP.none, 'No sidearm'], ...SIDEARMS.filter(g => g.id !== ownS).map(g => [g.id, g.name])],
				{'aria-label': `Man ${k + 1} sidearm`, class: m.sidearm ? 'set' : '', onchange: e => change({sidearm: e.target.value})}),
			A.h('small', {class: 'cq-man-info'}, r.info),
			A.h('div', {class: 'cq-man-tools'},
				A.h('button', {type: 'button', class: 'btn small icon ghost', disabled: k === 0, title: 'Move up', 'aria-label': `Move man ${k + 1} up`,
					onclick: () => editCorps(side, list => list.splice(k - 1, 0, ...list.splice(k, 1)))}, '↑'),
				A.h('button', {type: 'button', class: 'btn small icon ghost', disabled: k === men.length - 1, title: 'Move down', 'aria-label': `Move man ${k + 1} down`,
					onclick: () => editCorps(side, list => list.splice(k + 1, 0, ...list.splice(k, 1)))}, '↓'),
				A.h('button', {type: 'button', class: 'btn small icon ghost', disabled: men.length >= CP.maxMen, title: 'Add another like him', 'aria-label': `Copy man ${k + 1}`,
					onclick: () => editCorps(side, list => list.splice(k + 1, 0, {...list[k]}))}, A.icon('copy')),
				A.h('button', {type: 'button', class: 'btn small icon ghost danger', disabled: men.length <= 1, title: men.length <= 1 ? 'A corps keeps at least one man' : 'Remove', 'aria-label': `Remove man ${k + 1}`,
					onclick: () => editCorps(side, list => list.splice(k, 1))}, A.icon('close'))));
	}

	function freeCard(sec) {
		return A.h('section', {class: 'cq-sec open cq-free'}, A.h('header', {}, A.h('div', {class: 'cq-fold'}, A.h('h2', {}, sec.label))),
			A.h('div', {class: 'cq-note'}, A.h('b', {}, 'Free'), ' makes everything in the command interface free and unlimited. The world keeps it, not the settings file, so it is switched in the game: ',
				A.h('kbd', {}, 'Admin page'), ' › Admin › Free.'));
	}

	// --- side panel ---

	function side() {
		const tabs = A.seg([['changes', 'Changes'], ['economy', 'Economy']], S.side, v => { S.side = v; A.renderPalette(); });
		return [A.h('div', {class: 'pad'}, tabs), A.h('div', {class: 'scroll cq-side'}, S.side === 'economy' ? economy() : changes())];
	}

	function changes() {
		const out = [];
		if (!S.base) {
			out.push(A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'Not loaded from the game'),
				A.h('p', {}, 'Load the game\'s settings to see exactly what a save would change. Until then, changes are counted from the defaults.'),
				A.btn('open', 'Load from game', () => loadGame(false), {class: 'small primary', text: 'Load from game'})));
		}
		const list = S.base ? pending() : S.values.map((v, i) => i).filter(changedFromDefault);
		const ref = S.base || C.def;
		out.push(A.h('div', {class: 'cq-card'},
			A.h('h3', {}, S.base ? (list.length ? `${list.length} to save` : 'In step with the game') : `${list.length} off their defaults`),
			S.base && !list.length ? A.h('p', {}, `Everything here matches ${A.folder().folder?.name || 'the game'}'s file${S.loadedAt ? `, read ${ago(S.loadedAt)}` : ''}.`) : null,
			list.length ? A.h('div', {class: 'cq-changes'}, list.map(i => A.h('div', {class: 'cq-change'},
				A.h('button', {type: 'button', class: 'link', title: placeOf(i), onclick: () => reveal(i)}, A.h('span', {}, label(i)), A.h('small', {}, placeOf(i))),
				A.h('span', {class: 'cq-delta'}, A.h('s', {}, show(i, ref[i])), ' → ', A.h('b', {}, show(i))),
				A.h('button', {type: 'button', class: 'btn small icon ghost', title: S.base ? 'Back to the game\'s value' : 'Back to the default', 'aria-label': 'Undo this change', onclick: () => { S.values[i] = ref[i]; commit(); A.render(); }}, A.icon('close'))))) : null,
			S.base && list.length ? A.h('div', {class: 'bar', style: 'margin-top:8px'},
				A.btn('save', 'Save to game', saveGame, {class: 'small primary', text: 'Save to game'}),
				A.h('button', {type: 'button', class: 'btn small ghost danger', onclick: () => resetTo(list, S.base)}, 'Discard all')) : null));
		const gunList = gunPending();
		if (gunList.length) {
			const base = S.gunsBase || {};
			out.push(A.h('div', {class: 'cq-card'}, A.h('h3', {}, `${gunList.length} gun figure${gunList.length === 1 ? '' : 's'} to save`),
				A.h('div', {class: 'cq-changes'}, gunList.map(({id, k}) => {
					const g = gunById(id), before = base[id]?.[k], now = S.guns[id]?.[k];
					const word = v => (v == null ? (g ? `built ${gunShow(k, ownOf(g, k))}` : 'as built') : gunShow(k, v));
					return A.h('div', {class: 'cq-change'},
						A.h('button', {type: 'button', class: 'link', onclick: () => revealGun(id)}, A.h('span', {}, `${g?.name || id} · ${GFIELD[k].label}`), A.h('small', {}, g ? `Guns › ${TIER_NAMES[g.tier]}` : 'Not in the gun list')),
						A.h('span', {class: 'cq-delta'}, A.h('s', {}, word(before)), ' → ', A.h('b', {}, word(now))),
						A.h('button', {type: 'button', class: 'btn small icon ghost', title: 'Back to the game\'s', 'aria-label': 'Undo this change', onclick: () => {
							setGun(id, k, before ?? null);
							commit();
							A.render();
						}}, A.icon('close')));
				})),
				A.btn('save', 'Save to game', saveGame, {class: 'small primary', text: 'Save to game'})));
		}
		const corpsList = corpsPending();
		if (corpsList.length) {
			const base = S.corpsBase || corpsDefaults();
			out.push(A.h('div', {class: 'cq-card'}, A.h('h3', {}, `${corpsList.length === 2 ? 'Both corps' : SIDE_NAME[corpsList[0]]} to save`),
				A.h('div', {class: 'cq-changes'}, corpsList.flatMap(side => {
					const now = S.corps[side], was = base[side], rows = [];
					if (now.length !== was.length) rows.push([`${SIDE_NAME[side]} · men`, `${was.length}`, `${now.length}`]);
					for (let k = 0; k < Math.max(now.length, was.length); k++) {
						if (!sameMan(now[k], was[k])) rows.push([`${SIDE_NAME[side]} · man ${k + 1}`, was[k] ? manText(was[k], side) : 'none', now[k] ? manText(now[k], side) : 'removed']);
					}
					return [...rows.slice(0, 12).map(([what, a, b]) => A.h('div', {class: 'cq-change cq-change-corps'},
						A.h('button', {type: 'button', class: 'link', onclick: () => revealCorps(side)}, A.h('span', {}, what), A.h('small', {}, 'Corps › Men and guns')),
						A.h('span', {class: 'cq-delta'}, A.h('s', {}, a), ' → ', A.h('b', {}, b)))),
						rows.length > 12 ? A.h('p', {class: 'cq-hint'}, `and ${rows.length - 12} more`) : null,
						A.h('div', {class: 'bar'}, A.h('button', {type: 'button', class: 'btn small ghost danger', onclick: () => {
							S.corps = {...S.corps, [side]: JSON.parse(JSON.stringify(base[side]))};
							commit();
							A.render();
						}}, `Put ${SIDE_NAME[side].toLowerCase()} back to the game's`))];
				})),
				A.btn('save', 'Save to game', saveGame, {class: 'small primary', text: 'Save to game'})));
		}
		const offAll = S.values.map((v, i) => i).filter(changedFromDefault);
		if (offAll.length) out.push(A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'Defaults'),
			A.h('p', {}, `${offAll.length} of ${C.count} settings are off the mod's defaults.`),
			A.h('button', {type: 'button', class: 'btn small ghost danger', onclick: async () => {
				if (await A.ask('Reset everything?', `All ${offAll.length} changed settings go back to the mod's defaults here. Nothing reaches the game until you save. Undo brings them back.`, [['Cancel', false], ['Reset all', true, 'primary']])) resetTo(offAll, C.def);
			}}, 'Reset all to defaults')));
		out.push(A.h('p', {class: 'cq-foot'}, `The game reads config/${FILE} when a world starts and whenever a player joins. Settings from mod source ${new Date(C.generated).toLocaleDateString()}.`));
		return out;
	}

	function reveal(i) {
		const w = where[i];
		if (!w) return;
		S.query = '';
		S.page = w.pi;
		const sec = C.pages[w.pi].sections[w.si];
		if (sec.folds) S.open.add(sec.key);
		A.render();
		const el = document.querySelector(`.cq-row[data-i="${i}"]`);
		if (el) {
			el.scrollIntoView({block: 'center', behavior: 'smooth'});
			el.classList.add('flash');
			setTimeout(() => el.classList.remove('flash'), 1200);
			el._box.focus();
		}
	}

	function revealCorps(side) {
		const pi = C.pages.findIndex(p => p.sections.some(sec => sec.sliders.some(sl => sl.special === 'corps' && sl.side === side)));
		if (pi < 0) return;
		S.query = '';
		S.page = pi;
		A.render();
		const el = document.querySelector(`.cq-corps[data-side="${side}"]`);
		if (el) {
			el.scrollIntoView({block: 'center', behavior: 'smooth'});
			el.classList.add('flash');
			setTimeout(() => el.classList.remove('flash'), 1200);
		}
	}

	const ago = t => {
		const s = Math.round((Date.now() - t) / 1000);
		return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
	};
	const span = sec => (!Number.isFinite(sec) ? '—' : sec < 60 ? `${Math.round(sec)} s` : sec < 3600 ? `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, '0')}s` : `${(sec / 3600).toFixed(1)} h`);
	const val = name => S.values[C.names.indexOf(name)];

	function economy() {
		const perSec = val('TURN_GOLD') / Math.max(1, val('TURN_SECONDS'));
		const gold = S.values.map((v, i) => i).filter(i => kind(i).k === 'gold' && where[i] && !['TURN_GOLD'].includes(NAME[i]));
		const costs = gold.filter(i => !/^REWARD_/.test(NAME[i])), rewards = gold.filter(i => /^REWARD_/.test(NAME[i]));
		const table = (list, word) => A.h('div', {class: 'cq-econ'}, list.sort((a, b) => S.values[b] - S.values[a]).map(i => A.h('button', {type: 'button', class: 'cq-econ-row', title: placeOf(i), onclick: () => reveal(i)},
			A.h('span', {}, ...(label(i) === 'Price' ? [C.pages[where[i].pi].sections[where[i].si].label, A.h('small', {}, 'Ordnance')]
				: [label(i).replace(/^Upgrade price: /, 'Upgrade: '), A.h('small', {}, C.pages[where[i].pi].sections[where[i].si].label)])),
			A.h('b', {}, show(i)), A.h('em', {title: `${word} at the turn income`}, perSec > 0 ? span(S.values[i] / perSec) : '—'))));
		const shield = val('SHIELD_COST'), reactor = val('REACTOR_RATE');
		return [
			A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'Turn income'),
				A.h('div', {class: 'cq-big'}, A.h('b', {}, comma(perSec * 60)), ' gold a minute'),
				A.h('p', {}, `${comma(val('TURN_GOLD'))} gold every ${Math.round(val('TURN_SECONDS'))} s · ${comma(perSec * 3600)} an hour, for every player online.`),
				C.names.includes('STARTING_GOLD') ? A.h('p', {}, `Players start with ${comma(val('STARTING_GOLD'))} gold${perSec > 0 ? `, ${span(val('STARTING_GOLD') / perSec)} of turn income` : ''}.`) : null),
			corpsEconomy(),
			hostilesEconomy(),
			fuelEconomy(perSec),
			A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'Power'),
				A.h('p', {}, reactor > 0 ? `A base shield (${comma(shield)} MJ/s) takes ${(shield / reactor).toFixed(1)} reactor${shield / reactor === 1 ? '' : 's'} at ${comma(reactor)} MJ/s each.` : 'Reactors make no power.')),
			A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'What things cost'), A.h('p', {class: 'cq-hint'}, 'Price, then how long the turn income takes to pay for it.'), table(costs, 'Time to earn')),
			munGunsCard(perSec),
			A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'What kills earn'), A.h('p', {class: 'cq-hint'}, 'Reward, then the turn income it equals.'), table(rewards, 'Turn income it equals')),
		];
	}

	const has = name => C.names.includes(name);
	const at = name => C.names.indexOf(name);
	/** "Hostile spawn rate (all)": every hostile spawn chance is multiplied by it. */
	const allSpawn = () => (has('HOSTILE_SPAWN') ? val('HOSTILE_SPAWN') : 1);
	const pct = v => `${Math.round(v * 100)}%`;

	/** Each hostile spawn chance as the game uses it (its own × all), and what the hostile bases add up to. */
	function hostilesEconomy() {
		const spawns = ['HT_SPAWN', 'HB_SPAWN', 'HC_SPAWN', 'HBASE_SPAWN'].filter(n => has(n) && where[at(n)]);
		if (!spawns.length) return null;
		const all = allSpawn();
		const rows = spawns.map(n => {
			const i = at(n), sec = C.pages[where[i].pi].sections[where[i].si].label, own = S.values[i];
			return A.h('button', {type: 'button', class: 'cq-econ-row', title: placeOf(i), onclick: () => reveal(i)},
				A.h('span', {}, sec, A.h('small', {}, `${label(i)} ${own > 0 ? pct(own) : 'off'} × all ${pct(all)}`)),
				A.h('b', {}, own * all > 0 ? pct(own * all) : 'Off'), A.h('em'));
		});
		const out = [A.h('div', {class: 'cq-econ'}, rows)];
		if (has('HBASE_COUNT')) {
			const n = Math.round(val('HBASE_COUNT')), squads = Math.round(val('HBASE_PATROLS')) + Math.round(val('HBASE_GARRISON')), turrets = Math.round(val('HBASE_TURRETS'));
			const back = val('HBASE_REINFORCE');
			out.push(A.h('p', {}, n > 0
				? `${n} hostile base${n === 1 ? '' : 's'} a world, ${comma(val('HBASE_SPACING'))} m apart: ${comma(n * squads)} squads (${Math.round(val('HBASE_PATROLS'))} patrolling, ${Math.round(val('HBASE_GARRISON'))} on guard at each) and ${comma(n * turrets)} turrets in all. Each base has a ${Math.round(val('HBASE_TANK_CHANCE') * 100)}% chance of a tank. ${back > 0 ? `A lost patrol is back in ${mmss(back)}` : 'A lost patrol is not replaced'}${has('REWARD_LOOT_CHEST') ? `, and each loot chest pays ${comma(val('REWARD_LOOT_CHEST'))} g the first time it is opened` : ''}.`
				: 'No hostile bases are placed in a world.'));
		}
		return A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'Hostiles'), A.h('p', {class: 'cq-hint'}, `Each spawn chance as the game uses it: its own times Hostile spawn rate (all), now ${pct(all)}.`), out);
	}

	/** Fuel: how far the starting tank goes, how many vehicles a coal station keeps going, and what a station costs. */
	function fuelEconomy(perSec) {
		const F = C.fuel;
		if (!F || !has('VEHICLE_FUEL') || !has('FUEL_COAL')) return null;
		const burn = val('VEHICLE_FUEL'), make = val('FUEL_COAL'), cost = has('STATION_COST') ? val('STATION_COST') : 0;
		const mins = m => span(m * 60);
		const lines = burn <= 0 ? [A.h('p', {}, 'Vehicles burn no fuel.')] : [
			A.h('div', {class: 'cq-econ'},
				A.h('button', {type: 'button', class: 'cq-econ-row', onclick: () => reveal(at('VEHICLE_FUEL'))}, A.h('span', {}, 'Starting fuel', A.h('small', {}, `${comma(F.start)} gal, one vehicle out`)), A.h('b', {}, mins(F.start / burn)), A.h('em')),
				A.h('button', {type: 'button', class: 'cq-econ-row', onclick: () => reveal(at('VEHICLE_FUEL'))}, A.h('span', {}, 'Four vehicles out', A.h('small', {}, `${comma(4 * burn)} gal/min`)), A.h('b', {}, mins(F.start / (4 * burn))), A.h('em')),
				A.h('button', {type: 'button', class: 'cq-econ-row', onclick: () => reveal(at('FUEL_COAL'))}, A.h('span', {}, 'One coal station', A.h('small', {}, `${comma(make)} gal/min`)),
					A.h('b', {}, `${+(make / burn).toFixed(1)} vehicles`), A.h('em', {title: 'Kept going for good'}, 'for good')),
				A.h('button', {type: 'button', class: 'cq-econ-row', onclick: () => reveal(at('FUEL_COAL'))}, A.h('span', {}, `The most, ${F.maxStations} stations`, A.h('small', {}, `${comma(make * F.maxStations)} gal/min`)),
					A.h('b', {}, `${+(make * F.maxStations / burn).toFixed(1)} vehicles`), A.h('em', {}, 'for good'))),
			cost ? A.h('p', {}, `A mining station costs ${comma(cost)} g${perSec > 0 ? `, ${span(cost / perSec)} of turn income` : ''}.`) : null];
		return A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'Fuel'), A.h('p', {class: 'cq-hint'}, 'How long fuel lasts, and how many vehicles stations keep running.'), lines);
	}

	/** The two corps side by side: men, health in all, gun damage, and how many may be out. */
	function corpsEconomy() {
		if (!C.names.includes('CORPS_MAX')) return null;
		const hp = side => S.corps[side].reduce((n, m) => n + roleOf(m.role).health, 0) * val(HEALTH_OF[side]);
		const line = (side, most) => A.h('button', {type: 'button', class: 'cq-econ-row', onclick: () => revealCorps(side)},
			A.h('span', {}, SIDE_NAME[side], A.h('small', {}, `${S.corps[side].length} men · ${Math.round(val(DAMAGE_OF[side]) * 100)}% gun damage`)),
			A.h('b', {}, `${comma(hp(side))} HP`), A.h('em', {title: 'How many may be out at once'}, most));
		const spawn = val('HC_SPAWN') * allSpawn();
		return A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'Corps'), A.h('p', {class: 'cq-hint'}, 'Men, health in all at the Health setting, and how many may be out.'),
			A.h('div', {class: 'cq-econ'}, line('allied', `${Math.round(val('CORPS_MAX'))} each`), line('hostile', spawn > 0 ? `${Math.round(val('HC_CAP'))} at once` : 'off')),
			A.h('p', {}, `A player's ${Math.round(val('CORPS_MAX'))} corps field ${comma(hp('allied') * val('CORPS_MAX'))} HP in all; the hostile ones at most ${comma(hp('hostile') * val('HC_CAP'))} HP${spawn > 0 ? ` (spawn chance ${Math.round(spawn * 100)}%)` : ', but they are off'}.`));
	}

	function munGunsCard(perSec) {
		const guns = cat().guns.filter(isMun).map(g => ({g, price: gunVal(g, 'price')})).sort((a, b) => b.price - a.price);
		if (!guns.length) return null;
		return A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'Munitions Chest guns'), A.h('p', {class: 'cq-hint'}, `${TIER_NAMES[munTier()]}, at their Munitions price, and the turn income it takes.`),
			A.h('div', {class: 'cq-econ'}, guns.map(({g, price}) => A.h('button', {type: 'button', class: 'cq-econ-row', onclick: () => revealGun(g.id)},
				A.h('span', {}, g.name, A.h('small', {}, S.guns[g.id]?.price != null ? 'price set' : `${Math.round(val('MUN_GUN_PCT'))}% of shop`)),
				A.h('b', {}, `${comma(price)} g`), A.h('em', {}, perSec > 0 ? span(price / perSec) : '—')))));
	}

	function foot() {
		return [A.hasFolderApi() ? A.h('button', {type: 'button', class: `link ${A.folder().live ? 'ok' : ''}`, onclick: A.linkFolder, title: 'Change the linked game folder'},
			A.icon('folder'), A.folder().folder ? (A.folder().live ? `Settings in ${A.folder().folder.name} / config / ${FILE}` : `Reconnect ${A.folder().folder.name}`) : 'Link game folder') : A.h('span', {}, 'Saves to Downloads'),
		A.h('div', {class: 'hints'},
			A.h('span', {}, A.h('kbd', {}, '/'), ' find'),
			A.h('span', {}, A.h('kbd', {}, '['), ' ', A.h('kbd', {}, ']'), ' page'),
			A.h('span', {}, A.h('kbd', {}, '↑'), ' ', A.h('kbd', {}, '↓'), ' in a value, Shift ×10'),
			A.h('span', {}, A.h('kbd', {}, 'Ctrl'), ' ', A.h('kbd', {}, 'S'), ' save to game'),
			A.h('span', {}, A.h('kbd', {}, 'Ctrl'), ' ', A.h('kbd', {}, 'Z'), ' undo'))];
	}

	function keys(e) {
		const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
		const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range';
		if (ctrl && key === 's') { e.preventDefault(); saveGame(); return; }
		if (ctrl && key === 'o') { e.preventDefault(); importFile(); return; }
		if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { if (!typing) { e.preventDefault(); travel(redo, undo, 'redo'); } return; }
		if (ctrl && key === 'z') { if (!typing) { e.preventDefault(); travel(undo, redo, 'undo'); } return; }
		if (ctrl && key === 'k') { e.preventDefault(); document.querySelector('[data-k="cq-search"]')?.focus(); return; }
		if (typing || ctrl || e.altKey) return;
		if (e.key === '/') { e.preventDefault(); document.querySelector('[data-k="cq-search"]')?.focus(); return; }
		const at = ORDER.indexOf(S.page);
		if (e.key === '[') goPage(ORDER[(at - 1 + ORDER.length) % ORDER.length]);
		if (e.key === ']') goPage(ORDER[(at + 1) % ORDER.length]);
	}

	/** The tab opened: the game's settings read straight away if the folder is linked and nothing here is unsaved. */
	async function opened() {
		if (S.triedAuto) return;
		S.triedAuto = true;
		const {folder, live} = A.folder();
		if (folder && live) await loadGame(true);
	}

	return {
		init(api) {
			A = api;
			loadDraft();
		},
		top, rail, editor, side, foot, keys, drop, opened, commit,
		// for the tests
		_parse: parse, _show: show, _state: S, _write: write, _parseGuns: parseGuns, _writeGuns: writeGuns, _setGun: setGun, _ownOf: ownOf, _parseCorps: parseCorps, _writeCorps: writeCorps, _corpsPending: corpsPending, _corpsDefaults: corpsDefaults,
	};
})();
if (typeof module !== 'undefined') module.exports = Conquest;
