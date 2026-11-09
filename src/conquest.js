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
	};
	const undo = [], redo = [];
	let last = JSON.stringify(S.values);

	// --- what each setting is ---

	const where = {}; // index -> {page, section, slider}
	C.pages.forEach((p, pi) => p.sections.forEach((sec, si) => sec.sliders.forEach(sl => { if (sl.i != null) where[sl.i] = {pi, si, sl}; })));
	const SECONDS = new Set(['TK_SMOKE_COOLDOWN', 'TK_SMOKE_LINGER', 'TURN_SECONDS']);
	const BLOCKS = new Set(['TK_SMOKE_SIZE', 'DRONE_RANGE', 'BASE_DETECT', 'MISSILE_RANGE', 'SONAR_RANGE']);
	const GOLD_ALSO = new Set(['TURN_GOLD', 'REDEPLOY_PRICE', 'REACTOR_REPAIR']);

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
		if (n === 'BS_MISSILE_CAP') return {k: 'n'};
		if (n === 'REACTOR_HP') return {k: 'hp'};
		if (/^(PRICE_|REWARD_|UP_)/.test(n) || GOLD_ALSO.has(n)) return {k: 'gold'};
		if (n === 'SHIELD_COST' || n === 'REACTOR_RATE') return {k: 'mj'};
		return {k: 'pct'};
	}
	const isPct = i => ['pct', 'zoom'].includes(kind(i).k);
	const UNIT = {pct: '%', zoom: '±%', rounds: 'rounds', s: 's', mmss: 's', m: 'm', n: '', hp: 'HP', gold: 'g', mj: 'MJ/s'};
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

	// --- history and draft ---

	function commit() {
		const now = JSON.stringify(S.values);
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
		S.values = JSON.parse(last);
		saveDraft();
		A.render();
	}

	function saveDraft() {
		try {
			localStorage.setItem(DRAFT, JSON.stringify({values: S.values, base: S.base, baseText: S.baseText, extra: S.extra, page: S.page, open: [...S.open], loadedAt: S.loadedAt}));
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
			S.page = Math.min(C.pages.length - 1, d.page || 0);
			S.open = new Set(d.open || []);
			S.loadedAt = d.loadedAt || null;
			last = JSON.stringify(S.values);
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

	function write() {
		const o = {};
		S.values.forEach((v, i) => { o[`v${i}`] = tidy(v); });
		Object.assign(o, S.extra);
		// The mark the game leaves once it has put the Brawler's gun back to its bare 30 rounds: present, so it never does it again over these values.
		o.brMgBare = 1;
		return JSON.stringify(o, null, 2);
	}

	async function fileHandle(create) {
		const {folder} = A.folder();
		const config = await folder.getDirectoryHandle('config', {create});
		return config.getFileHandle(FILE, {create});
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

	function take(text, from) {
		const got = parse(text);
		commit();
		S.values = got.values;
		S.base = got.values.slice();
		S.baseText = text;
		S.extra = got.extra;
		S.loadedAt = Date.now();
		commit();
		saveDraft();
		A.render();
		const changed = got.values.filter((v, i) => !same(v, C.def[i])).length;
		A.toast(`${from}: ${changed} setting${changed === 1 ? '' : 's'} differ from the defaults${got.known < C.count ? ` · ${C.count - got.known} not in the file yet, at their defaults` : ''}`, 'good');
	}

	async function loadGame(quiet) {
		if (!(await folderReady())) {
			if (!quiet && !A.hasFolderApi()) importFile();
			return;
		}
		let text;
		try {
			({text} = await readGame());
		} catch (e) {
			if (!quiet) A.toast(e.name === 'NotFoundError' ? `No config/${FILE} in ${A.folder().folder.name} yet: the game writes it the first time a world starts. Saving here makes it.` : `Could not read the game's settings: ${e.message}`, 'bad');
			return;
		}
		const mine = pending().length;
		if (!quiet && mine && text !== S.baseText) {
			const ok = await A.ask('Load the game\'s settings?', `You have ${mine} change${mine === 1 ? '' : 's'} not yet saved to the game. Loading puts every setting back to what the game's file has.`,
				[['Cancel', false], ['Load and lose them', true, 'primary']]);
			if (!ok) return;
		}
		if (quiet && mine) return; // a draft with changes in it is never overwritten unasked
		take(text, `Loaded from ${A.folder().folder.name}`);
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
			const text = write();
			const out = await (await fileHandle(true)).createWritable();
			await out.write(text);
			await out.close();
			const n = S.base ? pending().length : S.values.filter((v, i) => changedFromDefault(i)).length;
			S.base = S.values.slice();
			S.baseText = text;
			S.loadedAt = Date.now();
			saveDraft();
			A.render();
			A.toast(`Saved to ${A.folder().folder.name}/config/${FILE}${n ? ` · ${n} change${n === 1 ? '' : 's'}` : ''}. The game picks it up when a world starts or a player joins.`, 'good');
		} catch (e) {
			if (e.name !== 'AbortError') A.toast(`Could not save: ${e.message}`, 'bad');
		}
	}

	function exportFile() {
		commit();
		const url = URL.createObjectURL(new Blob([write()], {type: 'application/json'}));
		const a = A.h('a', {href: url, download: FILE});
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
		A.toast(`Downloaded ${FILE}. Put it in the game folder's config folder.`);
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
			const got = parse(await file.text());
			commit();
			S.values = got.values;
			for (const [k, v] of Object.entries(got.extra)) if (k !== 'brMgBare') S.extra[k] = v;
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
		document.querySelectorAll('.cq-sec').forEach(paintSection);
		document.querySelector('.cq-head')?.replaceWith(pageHead());
	}

	// --- top bar ---

	function top() {
		const n = pending().length, {folder, live} = A.folder();
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
		const pages = C.pages.map((p, pi) => {
			const idx = pageIdx(p), off = idx.filter(changedFromDefault).length, mine = idx.filter(i => S.base && unsaved(i)).length;
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

	function editor() {
		if (S.query) {
			const found = matches();
			const groups = new Map();
			for (const m of found) {
				const k = `${m.pi}:${m.si}`;
				if (!groups.has(k)) groups.set(k, []);
				groups.get(k).push(m.i);
			}
			return [A.h('div', {class: 'ed-head'}, A.h('div', {}, A.h('h1', {}, `“${S.query}”`), A.h('div', {class: 'sub'}, `${found.length} setting${found.length === 1 ? '' : 's'} across ${groups.size} section${groups.size === 1 ? '' : 's'}`))),
				A.h('div', {class: 'scroll cq-body'}, found.length ? [...groups].map(([k, list]) => {
					const [pi, si] = k.split(':').map(Number), sec = C.pages[pi].sections[si];
					return section(sec, list, `${C.pages[pi].label} › ${sec.label}`, true);
				}) : A.h('p', {class: 'empty'}, A.h('b', {}, 'Nothing matches'), 'Try a vehicle, a weapon or a word like price, range or damage.'))];
		}
		const p = C.pages[S.page];
		const body = p.sections.map(sec => {
			const list = sectionIdx(sec).filter(i => !S.onlyChanged || changedFromDefault(i));
			if (sec.sliders.some(sl => sl.special === 'free')) return freeCard(sec);
			if (S.onlyChanged && !list.length) return null;
			return section(sec, list, sec.label, !sec.folds || S.open.has(sec.key) || S.onlyChanged);
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
				A.h('p', {}, `${comma(val('TURN_GOLD'))} gold every ${Math.round(val('TURN_SECONDS'))} s · ${comma(perSec * 3600)} an hour, for every player online.`)),
			A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'Power'),
				A.h('p', {}, reactor > 0 ? `A base shield (${comma(shield)} MJ/s) takes ${(shield / reactor).toFixed(1)} reactor${shield / reactor === 1 ? '' : 's'} at ${comma(reactor)} MJ/s each.` : 'Reactors make no power.')),
			A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'What things cost'), A.h('p', {class: 'cq-hint'}, 'Price, then how long the turn income takes to pay for it.'), table(costs, 'Time to earn')),
			A.h('div', {class: 'cq-card'}, A.h('h3', {}, 'What kills earn'), A.h('p', {class: 'cq-hint'}, 'Reward, then the turn income it equals.'), table(rewards, 'Turn income it equals')),
		];
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
		if (e.key === '[') goPage((S.page - 1 + C.pages.length) % C.pages.length);
		if (e.key === ']') goPage((S.page + 1) % C.pages.length);
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
		_parse: parse, _show: show, _state: S, _write: write,
	};
})();
if (typeof module !== 'undefined') module.exports = Conquest;
