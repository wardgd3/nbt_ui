// The page: three editors that share one line-up editor and one mob palette. Everything hangs off S; render() draws
// it, and typing changes the document in place and refreshes only what depends on it, so fields keep their focus.
(() => {
	const {LIMITS, RULES, ARMED, SHAPES, FOLDERS} = Model;
	const MOBS = new Map(DATA.mobs.map(m => [m.id, m]));
	const FACTION_ORDER = ['undead', 'orcs', 'beasts', 'dark', 'giants', 'demons', 'dragons', 'insurgents', 'light', 'vanilla'];
	const FACTION_NAMES = {undead: 'Undead', orcs: 'Orcs', beasts: 'Beasts', dark: 'Dark Order', giants: 'Giants', demons: 'Demons', dragons: 'Dragons',
		insurgents: 'Insurgents', light: 'Light side', vanilla: 'Vanilla'};
	const GROUP_COLORS = ['#f0813a', '#58b0d1', '#8dbb6f', '#a585e0', '#e9b44c', '#e26aa2', '#4fc1a6', '#d17f4e', '#7f9be8', '#c9c262', '#e8604f', '#8d97a3', '#b6946c', '#c58be0', '#68c4e0'];
	const MODES = [['waves', 'Waves'], ['colosseum', 'Colosseum'], ['temple', 'Temple']];
	const LEVELS = [[1, 'Level 1'], [2, 'Level 2'], [3, 'Level 3'], [0, 'Tunnels']];
	const DRAFT_KEY = 'nbt_ui.draft.v1';
	const OK_EXT = /\.nbt$/i;

	const S = {
		mode: 'waves',
		docs: {waves: Model.fresh.waves(), colosseum: Model.fresh.colosseum(), temple: Model.fresh.temple()},
		sel: {waves: 1, colosseum: 1, temple: 'run'},
		names: {waves: 'waves', colosseum: 'colosseum', temple: 'temple'},
		opened: {waves: null, colosseum: null, temple: null},
		level: 1,
		onlyChanged: false,
		query: '',
		hit: 0,
		swap: null,
		tuneOpen: null,
		tuneScope: 'this',
		flash: null,
		clip: null,
		folder: null,
		folderLive: false,
	};
	const last = {}, saved = {}, undo = {waves: [], colosseum: [], temple: []}, redo = {waves: [], colosseum: [], temple: []};

	const doc = () => S.docs[S.mode];
	const snapshot = mode => JSON.stringify(S.docs[mode]);
	const dirty = mode => snapshot(mode) !== saved[mode];

	// --- small DOM helpers ---

	function h(tag, props, ...kids) {
		const el = document.createElement(tag);
		apply(el, props);
		el.append(...kids.flat(Infinity).filter(k => k != null && k !== false));
		return el;
	}

	function s(tag, props, ...kids) {
		const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
		apply(el, props);
		el.append(...kids.filter(k => k != null));
		return el;
	}

	function apply(el, props) {
		for (const [k, v] of Object.entries(props || {})) {
			if (v == null || v === false) continue;
			if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
			else if (k === 'class') el.setAttribute('class', v);
			else if (k === 'value' || k === 'checked') el[k] = v;
			else el.setAttribute(k, v === true ? '' : v);
		}
	}

	const ICONS = {
		save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-8h8v8',
		open: 'M3 19V5h6l2 3h10v3M3 19l3-8h17l-3 8z',
		undo: 'M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3',
		redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3',
		copy: 'M9 9h11v12H9zM5 15H3V3h12v2',
		paste: 'M8 4H5v17h14V4h-3M9 2h6v4H9z',
		clear: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
		tune: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6h4V4zM6 14v6h4v-6z',
		close: 'M6 6l12 12M18 6 6 18',
		folder: 'M3 20V5h6l2 3h10v12z',
		search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
		reset: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
		plus: 'M12 5v14M5 12h14',
		help: 'M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4M12 18v.5',
	};

	const icon = name => s('svg', {viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'},
		s('path', {d: ICONS[name]}));

	function btn(name, label, onclick, extra = {}) {
		const cls = extra.class || '';
		return h('button', {...extra, type: 'button', class: `btn ${cls}`, title: extra.title || label, 'aria-label': label, onclick}, icon(name), extra.text ? extra.text : null);
	}

	const seg = (options, value, onpick, cls = '') => h('div', {class: `seg ${cls}`, role: 'group'},
		options.map(([v, label]) => h('button', {type: 'button', 'aria-pressed': String(v === value), onclick: () => onpick(v)}, label)));

	function toast(text, tone = '') {
		const el = h('div', {class: `toast ${tone}`}, text);
		document.getElementById('toasts').append(el);
		setTimeout(() => el.remove(), tone === 'bad' ? 6000 : 3200);
	}

	/** A dialog; resolves with the value of the button chosen, or null. */
	function ask(title, body, buttons = [['OK', true, 'primary']]) {
		return new Promise(done => {
			const root = document.getElementById('modal');
			const back = document.activeElement;
			const close = value => {
				root.replaceChildren();
				document.removeEventListener('keydown', onkey, true);
				if (back && back.isConnected) back.focus();
				done(value);
			};
			const onkey = e => {
				if (e.key !== 'Escape') return;
				e.stopPropagation();
				close(null);
			};
			document.addEventListener('keydown', onkey, true);
			const foot = buttons.map(([label, value, cls]) => h('button', {type: 'button', class: `btn ${cls || ''}`, onclick: () => close(value)}, label));
			const dialog = h('div', {class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title},
				h('h2', {}, title), h('div', {class: 'body'}, typeof body === 'function' ? body(close) : body), foot.length ? h('footer', {}, foot) : null);
			root.replaceChildren(h('div', {class: 'veil', onclick: e => { if (e.target === e.currentTarget) close(null); }}, dialog));
			(foot[foot.length - 1] || dialog.querySelector('button'))?.focus();
		});
	}

	// --- mobs and what the current selection is ---

	const mobName = id => MOBS.get(id)?.name || id.replace(/^.*:/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'No creature';
	const factionColor = id => `var(--f-${MOBS.get(id)?.faction || 'other'})`;
	const heavy = id => ['giants', 'demons', 'dragons'].includes(MOBS.get(id)?.faction);

	function lines() {
		const d = doc(), at = S.sel[S.mode];
		if (S.mode === 'waves') return d.waves[at];
		if (S.mode === 'colosseum') return d.cells[at];
		return at === 'run' ? null : d.spawns[at].entries;
	}

	const maxCount = () => (S.mode === 'temple' ? LIMITS.spawnCount[1] : LIMITS.count);
	const headcount = list => list.reduce((n, l) => n + (l.count || 0), 0);

	function faction(list) {
		const out = {};
		for (const l of list) {
			const f = MOBS.get(l.mob)?.faction || 'other';
			out[f] = (out[f] || 0) + l.count;
		}
		return out;
	}

	const stack = list => h('span', {class: 'stack'},
		Object.entries(faction(list)).map(([f, n]) => h('i', {style: `flex:${n} 1 0;background:var(--f-${f})`})));

	// --- history and drafts ---

	let softTimer = 0;

	function commit() {
		clearTimeout(softTimer);
		softTimer = 0;
		const mode = S.mode, now = snapshot(mode);
		if (now === last[mode]) return;
		undo[mode].push(last[mode]);
		if (undo[mode].length > 200) undo[mode].shift();
		redo[mode].length = 0;
		last[mode] = now;
		saveDraft();
	}

	/** After typing: the change kept, the side panels brought up to date, the field left alone. */
	function soft() {
		clearTimeout(softTimer);
		softTimer = setTimeout(commit, 400);
		renderRail();
		renderHead();
		renderTop();
		renderFoot();
	}

	function hard() {
		commit();
		render();
	}

	function travel(from, to, word) {
		commit();
		const mode = S.mode;
		if (!from[mode].length) return toast(`Nothing to ${word}`);
		to[mode].push(last[mode]);
		last[mode] = from[mode].pop();
		S.docs[mode] = JSON.parse(last[mode]);
		if (mode === 'temple' && S.sel.temple !== 'run' && !S.docs.temple.spawns[S.sel.temple]) S.sel.temple = 'run';
		S.swap = null;
		saveDraft();
		render();
	}

	function saveDraft() {
		try {
			localStorage.setItem(DRAFT_KEY, JSON.stringify({mode: S.mode, docs: S.docs, names: S.names, opened: S.opened, sel: S.sel, saved}));
		} catch { /* Private window or full storage: the app runs without drafts. */ }
	}

	function loadDraft() {
		try {
			const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
			if (!draft) return;
			Object.assign(S.docs, draft.docs);
			Object.assign(S.names, draft.names);
			Object.assign(S.opened, draft.opened);
			Object.assign(S.sel, draft.sel);
			if (draft.mode) S.mode = draft.mode;
			Object.assign(saved, draft.saved);
		} catch { /* A draft that cannot be read is passed over. */ }
	}

	// --- line-up changes ---

	function addMob(id, count = 1) {
		const list = lines();
		if (!list) return toast('Pick a Mob Spawn first');
		const temple = S.mode === 'temple';
		if (S.swap != null && list[S.swap]) {
			const line = list[S.swap];
			line.mob = id;
			S.flash = id;
			S.swap = null;
			return hard();
		}
		const same = list.find(l => l.mob === id && (temple || l.kind === 'table' || l.kind === 'exact'));
		if (same) same.count = Math.min(maxCount(), same.count + count);
		else if (temple) list.push({mob: id, count: Math.min(maxCount(), count)});
		else {
			if (list.length >= LIMITS.lines) return toast(`A line-up holds at most ${LIMITS.lines} lines`, 'bad');
			list.push(Model.line(id, Math.min(maxCount(), count), heavy(id) ? 'exact' : 'table'));
		}
		S.flash = id;
		hard();
	}

	function nextTarget(by) {
		commit();
		if (S.mode === 'waves') S.sel.waves = ((S.sel.waves - 1 + by + 40) % 40) + 1;
		else if (S.mode === 'colosseum') S.sel.colosseum = ((S.sel.colosseum - 1 + by + 15) % 15) + 1;
		else {
			const order = templeOrder();
			const at = order.indexOf(S.sel.temple);
			S.sel.temple = order[(at + by + order.length) % order.length];
			if (S.sel.temple !== 'run') S.level = doc().spawns[S.sel.temple].level;
		}
		S.swap = null;
		S.tuneOpen = null;
		render();
		document.querySelector('[aria-current="true"]')?.scrollIntoView({block: 'nearest'});
	}

	const templeOrder = () => ['run', ...LEVELS.flatMap(([level]) => doc().spawns.map((sp, i) => (sp.level === level ? i : -1)).filter(i => i >= 0))];

	function copyLines() {
		const list = lines();
		if (!list) return;
		S.clip = {temple: S.mode === 'temple', lines: Model.clone(list)};
		toast(`Copied ${list.length} line${list.length === 1 ? '' : 's'}`);
		renderHead();
	}

	function pasteLines() {
		const list = lines();
		if (!list || !S.clip) return;
		const temple = S.mode === 'temple';
		const incoming = S.clip.lines.map(l => (temple ? {mob: l.mob, count: Math.min(maxCount(), l.count)}
			: S.clip.temple ? Model.line(l.mob, l.count, heavy(l.mob) ? 'exact' : 'table') : Model.clone(l)));
		list.splice(0, list.length, ...incoming);
		hard();
	}

	function clearLines() {
		const list = lines();
		if (list) list.length = 0;
		hard();
	}

	// --- top bar ---

	function renderTop() {
		const name = h('input', {'aria-label': 'File name', spellcheck: 'false', value: S.names[S.mode], 'data-k': 'name',
			oninput: e => {
				S.names[S.mode] = e.target.value;
				saveDraft();
			}});
		const top = document.getElementById('top');
		keepFocus(top, () => top.replaceChildren(
			h('div', {class: 'brand'}, h('i', {}, 'F'), 'NBT Builder'),
			seg(MODES, S.mode, setMode, 'big'),
			h('label', {class: 'file', title: dirty(S.mode) ? 'Unsaved changes' : 'Saved'}, dirty(S.mode) ? h('b') : null, name, h('span', {}, '.nbt')),
			h('div', {class: 'bar'},
				btn('undo', 'Undo', () => travel(undo, redo, 'undo'), {class: 'icon ghost', disabled: !undo[S.mode].length, title: 'Undo (Ctrl+Z)'}),
				btn('redo', 'Redo', () => travel(redo, undo, 'redo'), {class: 'icon ghost', disabled: !redo[S.mode].length, title: 'Redo (Ctrl+Y)'}),
				btn('reset', 'New', newDoc, {text: 'New', title: 'Start a new file of this kind'}),
				btn('open', 'Open', openFile, {text: 'Open', title: 'Open a file (Ctrl+O)'}),
				btn('save', 'Save', saveFile, {class: 'primary', text: 'Save', title: 'Save (Ctrl+S)'})),
		));
	}

	function setMode(mode) {
		commit();
		S.mode = mode;
		S.swap = null;
		S.tuneOpen = null;
		saveDraft();
		render();
	}

	// --- rail ---

	function renderRail() {
		const rail = document.getElementById('rail');
		const scroller = rail.querySelector('.scroll');
		const top = scroller ? scroller.scrollTop : 0;
		keepFocus(rail, () => rail.replaceChildren(...{waves: railWaves, colosseum: railColosseum, temple: railTemple}[S.mode]()));
		const next = rail.querySelector('.scroll');
		if (next) next.scrollTop = top;
	}

	function railWaves() {
		const d = doc();
		const changed = Object.keys(d.waves).filter(w => !Model.isWritten(d, w)).length;
		const rows = [];
		for (let w = 1; w <= 40; w++) {
			const written = Model.isWritten(d, w), colosseum = d.colosseums.some(c => c.wave === w);
			if (S.onlyChanged && written && !colosseum) continue;
			rows.push(h('button', {type: 'button', class: `wave-row ${(w - 1) % 5 === 0 && w > 1 && !S.onlyChanged ? 'tier' : ''}`, 'aria-current': String(S.sel.waves === w),
				onclick: () => {
					commit();
					S.sel.waves = w;
					S.swap = null;
					S.tuneOpen = null;
					render();
				}},
				h('span', {class: 'no'}, w),
				colosseum ? h('span', {class: 'stack'}, h('em', {class: 'tag'}, 'COLOSSEUM')) : stack(d.waves[w]),
				h('span', {class: 'n'}, headcount(d.waves[w])),
				written ? h('span') : h('span', {class: 'mark', title: 'Changed from the game\'s table'})));
		}
		return [
			h('div', {class: 'rail-head'}, h('span', {class: 'eyebrow'}, `40 waves · ${changed} changed`),
				h('button', {type: 'button', class: 'chip', 'aria-pressed': String(S.onlyChanged), onclick: () => { S.onlyChanged = !S.onlyChanged; renderRail(); }}, 'Changed')),
			h('div', {class: 'scroll'}, rows.length ? rows : h('p', {class: 'empty'}, 'No changed waves yet')),
		];
	}

	function railColosseum() {
		const d = doc();
		const toggle = g => {
			const at = d.offGroups.indexOf(g);
			if (at >= 0) d.offGroups.splice(at, 1);
			else d.offGroups.push(g);
			hard();
		};
		const removeGroup = g => {
			d.groups--;
			d.offGroups = d.offGroups.filter(o => o !== g).map(o => (o > g ? o - 1 : o));
			for (const cell of Object.keys(d.cellGroups)) {
				if (d.cellGroups[cell] === g) delete d.cellGroups[cell];
				else if (d.cellGroups[cell] > g) d.cellGroups[cell]--;
			}
			hard();
		};
		const number = (label, key, limits, wide) => h('label', {class: `field ${wide ? 'wide' : ''}`}, h('span', {}, label),
			h('input', {inputmode: 'numeric', value: d[key], 'data-k': `col-${key}`,
				oninput: e => {
					d[key] = Model.clamp(parseInt(e.target.value, 10) || 0, limits);
					soft();
				},
				onblur: e => { e.target.value = d[key]; }}));
		return [
			h('div', {class: 'ring-wrap'}, ring()),
			h('div', {class: 'scroll'},
				h('div', {class: 'sect'},
					h('header', {}, h('span', {class: 'eyebrow'}, 'Release order')),
					h('div', {class: 'groups'},
						Array.from({length: d.groups}, (_, i) => i + 1).map(g => h('button', {type: 'button', class: `chip ${d.offGroups.includes(g) ? 'off' : ''}`, style: `--c:${GROUP_COLORS[(g - 1) % 15]}`,
							title: 'Click to switch on or off, Shift+click to remove', onclick: e => (e.shiftKey ? removeGroup(g) : toggle(g))}, h('i'), `Group ${g}`)),
						d.groups < LIMITS.cells ? h('button', {type: 'button', class: 'chip', onclick: () => { d.groups++; hard(); }}, '+ Group') : null)),
				h('div', {class: 'sect'},
					h('header', {}, h('span', {class: 'eyebrow'}, 'Map')),
					seg(SHAPES.map(v => [v, v[0].toUpperCase() + v.slice(1)]), d.shape, v => { d.shape = v; hard(); })),
				h('div', {class: 'sect'},
					h('header', {}, h('span', {class: 'eyebrow'}, 'Timing and pay')),
					h('div', {class: 'fields'},
						number('First gates, sec', 'startDelay', LIMITS.startDelay),
						number('Between groups, sec', 'delay', LIMITS.delay),
						number('Gate rise, sec', 'raise', LIMITS.raise),
						number('Win credits, 0 = own', 'reward', LIMITS.reward)))),
		];
	}

	/** The fifteen cells, round the floor as they stand in the game; the first three are the big ones. */
	function ring() {
		const d = doc();
		const cx = 120, cy = 120, inner = 58;
		const point = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
		const svg = s('svg', {class: 'ring', viewBox: '0 0 240 240', role: 'group', 'aria-label': 'Colosseum cells'});
		let total = 0;
		for (let c = 1; c <= 15; c++) {
			const from = -Math.PI / 2 + (c - 1) * (2 * Math.PI / 15) - Math.PI / 15 + 0.012, to = from + 2 * Math.PI / 15 - 0.024;
			const outer = c <= 3 ? 118 : 106;
			const [a, b, e, f] = [point(inner, from), point(outer, from), point(outer, to), point(inner, to)];
			const list = d.cells[c] || [], group = d.cellGroups[c];
			total += headcount(list);
			const fill = !list.length ? 'var(--raised)' : group ? GROUP_COLORS[(group - 1) % 15] : '#6f665d';
			const off = group && d.offGroups.includes(group);
			svg.append(s('path', {class: `cell ${S.sel.colosseum === c ? 'on' : ''}`, fill, opacity: off ? .35 : 1, d: `M${a}L${b}A${outer} ${outer} 0 0 1 ${e}L${f}A${inner} ${inner} 0 0 0 ${a}Z`, tabindex: 0, role: 'button', 'aria-label': `Cell ${c}`,
				onclick: () => pickCell(c),
				onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickCell(c); } }}));
			const [tx, ty] = point((inner + outer) / 2, (from + to) / 2);
			svg.append(s('text', {x: tx, y: ty, fill: list.length ? '#17120e' : 'var(--ink-3)'}, c));
		}
		svg.append(s('text', {class: 'mid', x: cx, y: cy - 6}, total), s('text', {class: 'sub', x: cx, y: cy + 13}, 'MOBS'));
		return svg;
	}

	function pickCell(c) {
		commit();
		S.sel.colosseum = c;
		S.swap = null;
		S.tuneOpen = null;
		render();
	}

	function railTemple() {
		const d = doc(), at = S.sel.temple;
		const pick = i => {
			commit();
			S.sel.temple = i;
			S.swap = null;
			render();
		};
		const inLevel = d.spawns.map((sp, i) => ({sp, i})).filter(({sp}) => sp.level === S.level);
		const rooms = new Map();
		for (const one of inLevel) {
			const key = one.sp.room || 0;
			if (!rooms.has(key)) rooms.set(key, []);
			rooms.get(key).push(one);
		}
		const pad = 26, xs = inLevel.map(o => o.sp.x), zs = inLevel.map(o => o.sp.z);
		const box = [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...zs) - Math.min(...zs) + pad * 2];
		const dotSize = Math.max(box[2], box[3]) / 42;
		const map = s('svg', {class: 'map', viewBox: box.join(' '), role: 'group', 'aria-label': `${S.level ? `Level ${S.level}` : 'Tunnels'} from above`});
		for (const {sp, i} of inLevel) {
			const first = sp.entries[0];
			map.append(s('circle', {cx: sp.x, cy: sp.z, r: dotSize * (at === i ? 1.7 : 1), fill: first ? factionColor(first.mob) : 'var(--f-other)',
				stroke: at === i ? 'var(--ink)' : 'none', 'stroke-width': dotSize / 2, onclick: () => pick(i)},
			s('title', {}, sp.entries.map(e => `${e.count} ${mobName(e.mob)}`).join(', ') || 'Empty')));
		}
		return [
			h('div', {class: 'pad'},
				h('button', {type: 'button', class: 'chip', style: 'width:100%;justify-content:center', 'aria-pressed': String(at === 'run'), onclick: () => pick('run')}, 'Boss, lives and rewards')),
			h('div', {style: 'padding:0 14px'},
				seg(LEVELS, S.level, level => { S.level = level; renderRail(); }),
				map),
			h('div', {class: 'scroll', style: 'margin-top:6px'}, [...rooms.entries()].map(([room, list]) => [
				h('div', {class: 'room-head eyebrow'}, room ? `Room ${room}` : 'Off the main path'),
				list.map(({sp, i}) => h('button', {type: 'button', class: 'spawn-row', 'aria-current': String(at === i), style: `--c:${sp.entries[0] ? factionColor(sp.entries[0].mob) : 'var(--f-other)'}`, onclick: () => pick(i)},
					h('i'), h('span', {}, sp.entries.map(e => `${e.count} ${mobName(e.mob)}`).join(', ') || 'Empty'), h('small', {}, `r${sp.range}`))),
			])),
		];
	}

	// --- editor ---

	function title() {
		const at = S.sel[S.mode];
		if (S.mode === 'waves') return `Wave ${at}`;
		if (S.mode === 'colosseum') return `Cell ${at}${at <= 3 ? ' · big cell' : ''}`;
		if (at === 'run') return 'Boss, lives and rewards';
		const sp = doc().spawns[at];
		return `${sp.room ? `Room ${sp.room}` : 'Tunnel'} Mob Spawn`;
	}

	function subtitle() {
		const list = lines();
		if (!list) return 'Temple run settings';
		const n = headcount(list);
		const parts = [`${n} mob${n === 1 ? '' : 's'}`, `${list.length} line${list.length === 1 ? '' : 's'}`];
		if (S.mode === 'waves') {
			parts.push('one player on Normal');
			return h('div', {class: 'sub'}, parts.join(' · '), Model.isWritten(doc(), S.sel.waves) ? null : h('b', {}, ' · changed'));
		}
		if (S.mode === 'temple') {
			const sp = doc().spawns[S.sel.temple];
			parts.push(`at ${sp.x}, ${sp.y}, ${sp.z}`);
		}
		return parts.join(' · ');
	}

	function renderHead() {
		const head = document.querySelector('.ed-head');
		if (!head) return;
		const sub = subtitle();
		const list = lines();
		const actions = list ? h('div', {class: 'bar'},
			S.mode === 'waves' && !Model.isWritten(doc(), S.sel.waves) ? btn('reset', 'Back to the game\'s table', () => {
				doc().waves[S.sel.waves] = Model.clone(DATA.waves[S.sel.waves]);
				hard();
			}, {class: 'small ghost', text: 'As written'}) : null,
			btn('copy', 'Copy line-up', copyLines, {class: 'small ghost', text: 'Copy', disabled: !list.length, title: 'Copy line-up (Ctrl+C)'}),
			btn('paste', 'Paste line-up', pasteLines, {class: 'small ghost', text: 'Paste', disabled: !S.clip, title: 'Paste over this line-up (Ctrl+V)'}),
			btn('clear', 'Clear line-up', clearLines, {class: 'small ghost danger', text: 'Clear', disabled: !list.length})) : null;
		head.replaceChildren(h('div', {}, h('h1', {}, title()), sub instanceof Node ? sub : h('div', {class: 'sub'}, sub)), actions || h('span'));
	}

	function renderEditor() {
		const editor = document.getElementById('editor');
		const scroller = editor.querySelector('.scroll');
		const top = scroller ? scroller.scrollTop : 0;
		keepFocus(editor, () => {
			const body = [];
			if (S.mode === 'colosseum') body.push(cellBar());
			const list = lines();
			body.push(h('div', {class: 'scroll'}, list ? lineList(list) : runSettings(), S.mode === 'waves' ? attachBar() : null));
			editor.replaceChildren(h('div', {class: 'ed-head'}), ...body);
		});
		renderHead();
		const next = editor.querySelector('.scroll');
		if (next) next.scrollTop = top;
		S.flash = null;
	}

	function cellBar() {
		const d = doc(), c = S.sel.colosseum, now = d.cellGroups[c] || 0;
		const options = [[0, 'First group'], ...Array.from({length: d.groups}, (_, i) => [i + 1, `Group ${i + 1}`])];
		return h('div', {class: 'ed-sub'}, h('span', {class: 'eyebrow'}, 'Released with'), options.map(([g, label]) => h('button', {type: 'button', class: 'chip', 'aria-pressed': String(g === now), style: g ? `--c:${GROUP_COLORS[(g - 1) % 15]}` : '', onclick: () => setGroup(g)}, g ? h('i') : null, label)),
			h('button', {type: 'button', class: 'chip', onclick: () => { d.groups++; setGroup(d.groups); }}, '+ New group'));
	}

	function setGroup(g) {
		const d = doc(), c = S.sel.colosseum;
		if (g && g > d.groups) return;
		if (g) d.cellGroups[c] = g;
		else delete d.cellGroups[c];
		hard();
	}

	function stepper(value, set, max, key, min = 1) {
		const input = h('input', {inputmode: 'numeric', 'aria-label': 'Count', value, 'data-k': key,
			onfocus: e => e.target.select(),
			oninput: e => {
				const n = parseInt(e.target.value, 10);
				if (Number.isNaN(n)) return;
				set(Math.max(min, Math.min(max, n)));
				soft();
			},
			onblur: e => { commit(); e.target.value = parseInt(e.target.value, 10) >= min ? Math.max(min, Math.min(max, parseInt(e.target.value, 10))) : min; },
			onkeydown: e => {
				if (e.key === 'Enter') searchBox()?.focus();
				if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
					e.preventDefault();
					nudge(e.key === 'ArrowUp' ? (e.shiftKey ? 5 : 1) : (e.shiftKey ? -5 : -1));
				}
			}});
		const nudge = by => {
			const next = Math.max(min, Math.min(max, (parseInt(input.value, 10) || 0) + by));
			input.value = next;
			set(next);
			soft();
		};
		return h('div', {class: 'step'},
			h('button', {type: 'button', tabindex: -1, 'aria-label': 'Fewer', onclick: e => nudge(e.shiftKey ? -5 : -1)}, '−'),
			input,
			h('button', {type: 'button', tabindex: -1, 'aria-label': 'More', onclick: e => nudge(e.shiftKey ? 5 : 1)}, '+'));
	}

	function lineList(list) {
		if (!list.length) {
			return h('div', {class: 'empty'}, h('b', {}, 'Nothing here yet'), 'Pick mobs from the list on the right, or press ', h('kbd', {}, '/'), ' and type a name like ', h('kbd', {}, 'orc 5'));
		}
		const temple = S.mode === 'temple';
		const box = h('div', {class: 'lines'}, temple ? rangeRow() : null);
		list.forEach((line, i) => box.append(temple ? spawnLine(line, i, list) : waveLine(line, i, list)));
		return box;
	}

	function who(line, i) {
		return h('button', {type: 'button', class: 'who', style: `--c:${factionColor(line.mob)}`, title: 'Swap for another mob',
			onclick: () => {
				S.swap = S.swap === i ? null : i;
				renderEditor();
				renderPalette();
				searchBox()?.focus();
			}},
		h('i'), h('span', {}, h('b', {}, mobName(line.mob)), h('small', {}, line.mob)));
	}

	const removeBtn = (list, i) => btn('close', 'Remove line', () => {
		list.splice(i, 1);
		S.swap = null;
		hard();
	}, {class: 'small icon ghost danger'});

	function rangeRow() {
		const sp = doc().spawns[S.sel.temple];
		const out = h('output', {}, sp.range);
		return h('label', {class: 'slide', style: 'grid-template-columns:auto minmax(0,1fr) 42px;margin-bottom:6px'}, 'Trigger range',
			h('input', {type: 'range', min: LIMITS.spawnRange[0], max: LIMITS.spawnRange[1], value: sp.range,
				oninput: e => {
					sp.range = +e.target.value;
					out.textContent = sp.range;
				},
				onchange: () => hard()}), out);
	}

	function spawnLine(line, i, list) {
		return h('div', {class: `row simple ${S.flash === line.mob ? 'flash' : ''} ${S.swap === i ? 'swapping' : ''}`},
			who(line, i),
			stepper(line.count, v => { line.count = v; }, LIMITS.spawnCount[1], `c${i}`),
			removeBtn(list, i));
	}

	function waveLine(line, i, list) {
		const rule = RULES[line.kind] || RULES.table;
		const tuneKey = `${S.mode}:${S.sel[S.mode]}:${line.mob}`;
		const tuned = !!effectiveTune(line.mob);
		const row = h('div', {class: `row ${S.flash === line.mob ? 'flash' : ''} ${S.swap === i ? 'swapping' : ''}`},
			who(line, i),
			rule.fixed ? h('div', {class: 'fixed', title: rule.hint}, rule.amount) : stepper(line.count, v => { line.count = v; }, LIMITS.count, `c${i}`),
			h('select', {'aria-label': 'Rule', title: rule.hint, 'data-k': `r${i}`, onchange: e => setRule(line, e.target.value)},
				Object.entries(RULES).map(([k, r]) => h('option', {value: k, selected: k === line.kind}, r.label))),
			btn('tune', 'Mob settings', () => {
				S.tuneOpen = S.tuneOpen === tuneKey ? null : tuneKey;
				renderEditor();
			}, {class: `small icon ghost ${tuned ? 'tuned' : ''}`, title: tuned ? 'Mob settings (changed)' : 'Mob settings', 'aria-expanded': String(S.tuneOpen === tuneKey)}),
			removeBtn(list, i), lineExtra(line, i));
		if (S.tuneOpen === tuneKey) row.append(tunePanel(line.mob));
		return row;
	}

	function setRule(line, kind) {
		const rule = RULES[kind];
		line.kind = kind;
		if (rule.mob) line.mob = rule.mob;
		line.other = kind === 'either' ? (line.other && MOBS.has(line.other) ? line.other : 'dynamic_difficulty:ogre') : kind === 'holding' ? 'minecraft:stone_axe' : '';
		line.count2 = kind === 'trolls' ? line.count + 1 : 0;
		if (rule.fixed) line.count = 1;
		hard();
	}

	function lineExtra(line, i) {
		if (line.kind === 'trolls') {
			return h('div', {class: 'extra'}, 'Team', stepper(line.count2, v => { line.count2 = v; }, LIMITS.count, `t${i}`, 0));
		}
		if (line.kind === 'either') {
			return h('div', {class: 'extra'}, 'or', mobSelect(line.other, id => {
				line.other = id;
				hard();
			}, `o${i}`));
		}
		if (line.kind === 'holding') {
			return h('div', {class: 'extra'}, 'with', h('input', {class: 'text', spellcheck: 'false', 'aria-label': 'Item id', value: line.other, 'data-k': `o${i}`,
				oninput: e => {
					line.other = e.target.value.trim();
					soft();
				}}));
		}
		return null;
	}

	function mobSelect(value, onchange, key) {
		const known = MOBS.has(value);
		return h('select', {'aria-label': 'Creature', 'data-k': key, onchange: e => onchange(e.target.value)},
			known || !value ? null : h('option', {value, selected: true}, value),
			FACTION_ORDER.map(f => h('optgroup', {label: FACTION_NAMES[f]},
				DATA.mobs.filter(m => m.faction === f).map(m => h('option', {value: m.id, selected: m.id === value}, m.name)))));
	}

	// --- creatures' settings: this wave or cell over every one, as the game reads them ---

	const tuneScope = () => (S.tuneScope === 'all' ? 0 : S.sel[S.mode]);
	const effectiveTune = mob => {
		const tunes = doc().tunes;
		return tunes[S.sel[S.mode]]?.[mob] || tunes[0]?.[mob] || null;
	};

	function tunePanel(mob) {
		const tunes = doc().tunes, scope = tuneScope();
		const shown = tunes[scope]?.[mob] || (scope ? tunes[0]?.[mob] : null) || Model.tune();
		const write = (key, value) => {
			const own = (tunes[scope] ??= {});
			own[mob] = {...(own[mob] || shown), [key]: value};
		};
		const slider = (key, label, limits) => {
			const out = h('output', {}, `${shown[key].toFixed(2)}×`);
			return h('label', {class: 'slide'}, label, h('input', {type: 'range', min: limits[0], max: limits[1], step: 0.05, value: shown[key],
				oninput: e => {
					write(key, Model.round2(+e.target.value));
					out.textContent = `${(+e.target.value).toFixed(2)}×`;
				},
				onchange: () => hard()}), out);
		};
		const gunPick = (key, label, options, none) => h('label', {class: 'field'}, h('span', {}, label),
			h('select', {onchange: e => { write(key, e.target.value); hard(); }},
				h('option', {value: '', selected: !shown[key]}, 'His own'),
				none ? h('option', {value: 'none', selected: shown[key] === 'none'}, 'None') : null,
				options.map(g => h('option', {value: g.id, selected: g.id === shown[key]}, g.name))));
		const word = S.mode === 'waves' ? 'wave' : 'cell';
		const own = tunes[scope]?.[mob];
		return h('div', {class: 'tune'},
			h('header', {}, seg([['this', `This ${word}`], ['all', `Every ${word}`]], S.tuneScope, v => { S.tuneScope = v; renderEditor(); }),
				own ? h('button', {type: 'button', class: 'btn small ghost', onclick: () => {
					delete tunes[scope][mob];
					if (!Object.keys(tunes[scope]).length) delete tunes[scope];
					hard();
				}}, 'Reset') : null),
			slider('size', 'Size', LIMITS.size), slider('health', 'Health', LIMITS.health), slider('speed', 'Speed', LIMITS.speed), slider('damage', 'Damage', LIMITS.damage),
			ARMED.includes(mob) ? [slider('gun', 'Gun', LIMITS.damage), slider('grenade', 'Grenade', LIMITS.damage),
				gunPick('primary', 'Main gun', DATA.guns.primary), gunPick('sidearm', 'Sidearm', DATA.guns.sidearm, true)] : null);
	}

	function attachBar() {
		const d = doc(), wave = S.sel.waves, now = d.colosseums.find(c => c.wave === wave);
		return h('div', {class: 'attached'},
			now ? h('span', {}, `Played in the Colosseum from ${now.name || 'a file'}, in place of this line-up.`) : h('span', {}, 'Played as this line-up.'),
			now ? h('button', {type: 'button', class: 'btn small', onclick: () => {
				d.colosseums = d.colosseums.filter(c => c !== now);
				hard();
			}}, 'Back to line-up') : h('button', {type: 'button', class: 'btn small', onclick: attachColosseum}, 'Use a Colosseum file…'));
	}

	async function attachColosseum() {
		const file = await chooseFile('colosseum');
		if (!file) return;
		try {
			const root = await NBT.parse(new Uint8Array(await file.bytes()));
			if (Model.kindOf(root) !== 'colosseum') return toast(`${file.name} is not a Colosseum file`, 'bad');
			const d = doc();
			d.colosseums = d.colosseums.filter(c => c.wave !== S.sel.waves);
			d.colosseums.push({wave: S.sel.waves, name: file.name, config: Model.readColosseum(root)});
			hard();
		} catch (e) {
			toast(`Could not read ${file.name}: ${e.message}`, 'bad');
		}
	}

	function runSettings() {
		const d = doc();
		const number = (label, get, set, limits, key) => h('label', {class: 'field'}, h('span', {}, `${label} (${limits[0].toLocaleString()}-${limits[1].toLocaleString()})`),
			h('input', {inputmode: 'decimal', value: get(), 'data-k': key,
				oninput: e => {
					set(Model.clamp(parseFloat(e.target.value) || 0, limits));
					soft();
				},
				onblur: e => { e.target.value = get(); }}));
		return h('div', {class: 'lines', style: 'max-width:560px'},
			h('div', {class: 'fields'},
				h('label', {class: 'field wide'}, h('span', {}, 'Boss'), mobSelect(d.boss, id => { d.boss = id; hard(); }, 'boss')),
				number('Size, times its own', () => d.bossScale, v => { d.bossScale = v; }, LIMITS.bossScale, 'scale'),
				number('Health', () => d.bossHealth, v => { d.bossHealth = v; }, LIMITS.bossHealth, 'health'),
				number('Lives per player', () => d.lives, v => { d.lives = Math.round(v); }, LIMITS.lives, 'lives'),
				h('span'),
				d.safeRewards.map((v, i) => number(`Safe room ${i + 1} credits`, () => d.safeRewards[i], n => { d.safeRewards[i] = Math.round(n); }, LIMITS.safeReward, `safe${i}`))));
	}

	// --- palette ---

	const searchBox = () => document.querySelector('#palette input');

	/** "orc 5", "5 orc", "orc x5" and "orc*5" all mean five orcs. */
	function parseQuery(text) {
		const t = text.trim();
		let hit = t.match(/^(.*?)[\s*x×]+(\d+)$/i);
		if (hit && hit[1]) return {name: hit[1].trim().toLowerCase(), count: +hit[2]};
		hit = t.match(/^(\d+)\s+(.+)$/);
		if (hit) return {name: hit[2].trim().toLowerCase(), count: +hit[1]};
		return {name: t.toLowerCase(), count: 1};
	}

	function matches() {
		const {name} = parseQuery(S.query);
		if (!name) return DATA.mobs.slice().sort((a, b) => FACTION_ORDER.indexOf(a.faction) - FACTION_ORDER.indexOf(b.faction));
		const words = name.split(/\s+/);
		const score = m => {
			const n = m.name.toLowerCase();
			if (!words.every(w => n.includes(w) || m.id.includes(w))) return -1;
			return (n.startsWith(name) ? 4 : 0) + (n.split(' ').some(w => w.startsWith(words[0])) ? 2 : 0) + (m.faction !== 'vanilla' ? 1 : 0);
		};
		const found = DATA.mobs.map(m => [score(m), m]).filter(([v]) => v >= 0).sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).map(([, m]) => m);
		if (name.includes(':') && !MOBS.has(name)) found.push({id: name, name: `Use id ${name}`, faction: 'other'});
		return found;
	}

	function usedMobs() {
		const d = doc(), seen = new Map();
		const count = list => list.forEach(l => seen.set(l.mob, (seen.get(l.mob) || 0) + 1));
		if (S.mode === 'waves') Object.values(d.waves).forEach(count);
		else if (S.mode === 'colosseum') Object.values(d.cells).forEach(count);
		else d.spawns.forEach(sp => count(sp.entries));
		return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
	}

	function renderPalette() {
		const root = document.getElementById('palette');
		const previous = searchBox();
		if (!previous) {
			root.replaceChildren(
				h('div', {class: 'search'},
					h('label', {}, icon('search'), h('input', {placeholder: 'Add a mob', 'aria-label': 'Add a mob', spellcheck: 'false', autocomplete: 'off',
						oninput: e => {
							S.query = e.target.value;
							S.hit = 0;
							paintPalette();
						},
						onkeydown: paletteKeys}), h('kbd', {}, '/')),
					h('p')),
				h('div', {class: 'used'}),
				h('div', {class: 'scroll', role: 'listbox', 'aria-label': 'Mobs'}));
		}
		paintPalette();
	}

	function paletteKeys(e) {
		const list = matches();
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			S.hit = (S.hit + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % Math.max(1, list.length);
			paintPalette();
			document.querySelector('.mob[aria-selected="true"]')?.scrollIntoView({block: 'nearest'});
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const mob = list[S.hit];
			if (!mob) return;
			addMob(mob.id, parseQuery(S.query).count);
			e.target.value = '';
			S.query = '';
			S.hit = 0;
			paintPalette();
		} else if (e.key === 'Escape') {
			if (S.swap != null) {
				S.swap = null;
				renderEditor();
			}
			e.target.value = '';
			S.query = '';
			S.hit = 0;
			paintPalette();
			e.target.blur();
		}
	}

	function paintPalette() {
		const root = document.getElementById('palette');
		const swapping = S.swap != null && lines()?.[S.swap];
		const {count} = parseQuery(S.query);
		root.querySelector('.search p').replaceChildren(...(swapping ? [h('b', {}, `Swap ${mobName(swapping.mob)} for…`), ' Esc cancels']
			: count > 1 ? [`Adds `, h('b', {}, `${count}`), ` with Enter`] : ['Click adds one, Shift+click five']));
		const used = root.querySelector('.used');
		used.replaceChildren(...(S.query ? [] : usedMobs().map(id => h('button', {type: 'button', style: `--c:${factionColor(id)}`, title: id, onclick: e => addMob(id, e.shiftKey ? 5 : 1)}, h('i'), h('span', {}, mobName(id))))));
		const list = matches();
		const scroller = root.querySelector('.scroll');
		const out = [];
		let group = null;
		list.forEach((m, i) => {
			if (!S.query && m.faction !== group) {
				group = m.faction;
				out.push(h('div', {class: 'fac eyebrow'}, FACTION_NAMES[group]));
			}
			out.push(h('button', {type: 'button', class: 'mob', role: 'option', 'aria-selected': String(!!S.query && i === S.hit), style: `--c:${factionColor(m.id)}`, title: m.id,
				onclick: e => addMob(m.id, e.shiftKey ? 5 : parseQuery(S.query).count)},
			h('i'), h('span', {}, m.name), h('kbd', {}, '↵')));
		});
		scroller.replaceChildren(...(out.length ? out : [h('p', {class: 'empty'}, 'No mob by that name. A full id with a colon works too.')]));
	}

	// --- footer ---

	function renderFoot() {
		const found = Model.issues(doc());
		const linked = S.folder && S.folderLive;
		document.getElementById('foot').replaceChildren(
			hasFolderApi() ? h('button', {type: 'button', class: `link ${linked ? 'ok' : ''}`, onclick: linkFolder, title: linked ? 'Change the linked game folder' : 'Save and open straight from the game folder'},
				icon('folder'), linked ? `Saving to ${S.folder.name} / ${FOLDERS[S.mode]}` : S.folder ? `Reconnect ${S.folder.name}` : 'Link game folder') : h('span', {}, 'Saves to Downloads'),
			found.length ? h('button', {type: 'button', class: 'link warn', onclick: () => ask(`${found.length} thing${found.length === 1 ? '' : 's'} to check`, h('div', {}, found.slice(0, 40).map(t => h('p', {}, t))))}, `${found.length} to check`)
				: h('span', {class: 'link ok'}, 'Valid for the game'),
			h('div', {class: 'hints'},
				h('span', {}, h('kbd', {}, '/'), ' add mob'),
				h('span', {}, h('kbd', {}, '['), ' ', h('kbd', {}, ']'), S.mode === 'waves' ? ' prev / next wave' : S.mode === 'colosseum' ? ' prev / next cell' : ' prev / next spawn'),
				S.mode === 'colosseum' ? h('span', {}, h('kbd', {}, '0'), '-', h('kbd', {}, '9'), ' set group') : null,
				h('span', {}, h('kbd', {}, 'Ctrl'), ' ', h('kbd', {}, 'S'), ' save'),
				h('button', {type: 'button', class: 'link', onclick: showKeys}, h('kbd', {}, '?'), ' all keys')));
	}

	function showKeys() {
		const rows = [['/', 'Find a mob. "orc 5" adds five with Enter'], ['Enter', 'From a count, back to the mob search'], ['↑ ↓', 'In a count, up or down one (Shift for five)'],
			['[ ]', 'Previous or next wave, cell or spawn'], ['Alt 1-3', 'Waves, Colosseum, Temple'], ['0-9', 'Colosseum: put this cell in a group'],
			['Ctrl C / V', 'Copy or paste a whole line-up'], ['Ctrl Z / Y', 'Undo or redo'], ['Ctrl S / O', 'Save or open']];
		ask('Keyboard', h('div', {class: 'keys'}, rows.flatMap(([k, t]) => [h('kbd', {}, k), h('span', {}, t)])));
	}

	// --- files ---

	const hasFolderApi = () => 'showDirectoryPicker' in window;
	const cleanName = name => (name.trim().replace(/\.nbt$/i, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)) || S.mode;

	async function folderFor(mode, create) {
		return S.folder.getDirectoryHandle(FOLDERS[mode], {create});
	}

	async function storeHandle(handle) {
		await new Promise(done => {
			const open = indexedDB.open('nbt_ui', 1);
			open.onupgradeneeded = () => open.result.createObjectStore('kv');
			open.onerror = () => done();
			open.onsuccess = () => {
				const tx = open.result.transaction('kv', 'readwrite');
				tx.objectStore('kv').put(handle, 'folder');
				tx.oncomplete = done;
				tx.onerror = done;
			};
		});
	}

	function loadHandle() {
		return new Promise(done => {
			const open = indexedDB.open('nbt_ui', 1);
			open.onupgradeneeded = () => open.result.createObjectStore('kv');
			open.onerror = () => done(null);
			open.onsuccess = () => {
				const get = open.result.transaction('kv').objectStore('kv').get('folder');
				get.onsuccess = () => done(get.result || null);
				get.onerror = () => done(null);
			};
		});
	}

	async function linkFolder() {
		try {
			if (S.folder && !S.folderLive) {
				S.folderLive = (await S.folder.requestPermission({mode: 'readwrite'})) === 'granted';
				if (S.folderLive) return renderFoot();
			}
			const handle = await window.showDirectoryPicker({id: 'fight-arena', mode: 'readwrite'});
			S.folder = handle;
			S.folderLive = true;
			await storeHandle(handle);
			const names = [];
			for await (const [name] of handle.entries()) names.push(name);
			if (!names.includes('colosseum') && !names.includes('wave saves')) toast('That folder has no colosseum or wave saves folder. It should be the Fight Arena instance folder.', 'bad');
			else toast(`Linked ${handle.name}`, 'good');
			renderFoot();
		} catch (e) {
			if (e.name !== 'AbortError') toast(`Could not link the folder: ${e.message}`, 'bad');
		}
	}

	async function ensureFolder() {
		if (!S.folder) return false;
		if (S.folderLive) return true;
		S.folderLive = (await S.folder.requestPermission({mode: 'readwrite'})) === 'granted';
		renderFoot();
		return S.folderLive;
	}

	async function saveFile() {
		commit();
		const mode = S.mode, name = `${cleanName(S.names[mode])}.nbt`;
		S.names[mode] = name.slice(0, -4);
		try {
			const bytes = await Model.toFile(S.docs[mode]);
			if (await ensureFolder()) {
				const dir = await folderFor(mode, true);
				let exists = false;
				try {
					await dir.getFileHandle(name);
					exists = true;
				} catch { /* A new file. */ }
				if (exists && S.opened[mode] !== name) {
					const go = await ask('Replace this file?', `${name} is already in ${FOLDERS[mode]}, and it is not the file you opened.`, [['Cancel', null], ['Replace', true, 'primary']]);
					if (!go) return;
				}
				const handle = await dir.getFileHandle(name, {create: true});
				const out = await handle.createWritable();
				await out.write(bytes);
				await out.close();
				toast(`Saved ${FOLDERS[mode]}/${name}`, 'good');
			} else if ('showSaveFilePicker' in window) {
				const handle = await window.showSaveFilePicker({suggestedName: name, types: [{description: 'NBT file', accept: {'application/octet-stream': ['.nbt']}}]});
				const out = await handle.createWritable();
				await out.write(bytes);
				await out.close();
				toast(`Saved ${name}. Put it in the game's ${FOLDERS[mode]} folder.`, 'good');
			} else {
				const url = URL.createObjectURL(new Blob([bytes]));
				h('a', {href: url, download: name}).click();
				setTimeout(() => URL.revokeObjectURL(url), 2000);
				toast(`Downloaded ${name}. Put it in the game's ${FOLDERS[mode]} folder.`, 'good');
			}
			S.opened[mode] = name;
			saved[mode] = snapshot(mode);
			saveDraft();
			renderTop();
		} catch (e) {
			if (e.name !== 'AbortError') toast(`Could not save: ${e.message}`, 'bad');
		}
	}

	function newDoc() {
		commit();
		S.docs[S.mode] = Model.fresh[S.mode]();
		S.names[S.mode] = S.mode;
		S.opened[S.mode] = null;
		S.sel[S.mode] = S.mode === 'temple' ? 'run' : 1;
		saved[S.mode] = snapshot(S.mode);
		hard();
		toast('New file. Undo brings the old one back.');
	}

	async function loadBytes(name, bytes) {
		let root, kind;
		try {
			root = await NBT.parse(bytes);
			kind = Model.kindOf(root);
		} catch (e) {
			return toast(`${name} could not be read: ${e.message}`, 'bad');
		}
		if (kind === 'castle') return toast('That is a Castle file. This app makes waves, Colosseum and Temple files.', 'bad');
		if (!kind) return toast(`${name} is not a waves, Colosseum or Temple file`, 'bad');
		commit();
		S.mode = kind;
		S.docs[kind] = Model.fromFile(root, kind);
		S.names[kind] = name.replace(OK_EXT, '');
		S.opened[kind] = name;
		S.sel[kind] = kind === 'temple' ? 'run' : 1;
		last[kind] = saved[kind] = snapshot(kind);
		undo[kind].length = 0;
		redo[kind].length = 0;
		S.swap = null;
		S.tuneOpen = null;
		saveDraft();
		render();
		toast(`Opened ${name}`, 'good');
	}

	/** A file picked: from the linked folder's list when there is one, else with the browser's picker. */
	async function chooseFile(mode) {
		if (await ensureFolder()) {
			const files = [];
			try {
				const dir = await folderFor(mode, false);
				for await (const [name, handle] of dir.entries()) {
					if (handle.kind !== 'file' || !OK_EXT.test(name)) continue;
					const file = await handle.getFile();
					files.push({name, file, when: file.lastModified});
				}
			} catch (e) {
				if (e.name !== 'NotFoundError') toast(e.message, 'bad');
			}
			files.sort((a, b) => b.when - a.when);
			const pick = await ask(`Open from ${FOLDERS[mode]}`, close => (files.length ? h('div', {class: 'files'}, files.map(f => h('button', {type: 'button', onclick: () => close(f.file)}, h('span', {}, f.name), h('small', {}, new Date(f.when).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})))))
				: h('p', {}, 'No .nbt files here yet.')), [['Cancel', null], ['Browse…', 'browse']]);
			if (pick !== 'browse') return pick && wrap(pick);
		}
		return new Promise(done => {
			const input = document.getElementById('picker');
			input.value = '';
			input.onchange = () => done(input.files[0] ? wrap(input.files[0]) : null);
			input.oncancel = () => done(null);
			input.click();
		});
	}

	const wrap = file => ({name: file.name, bytes: () => file.arrayBuffer()});

	async function openFile() {
		const file = await chooseFile(S.mode);
		if (file) await loadBytes(file.name, new Uint8Array(await file.bytes()));
	}

	// --- keeping the caret where it was ---

	function keepFocus(root, draw) {
		const active = document.activeElement;
		const key = root.contains(active) ? active.getAttribute('data-k') : null;
		const start = key && active.selectionStart != null ? active.selectionStart : null;
		draw();
		if (!key) return;
		const next = root.querySelector(`[data-k="${key}"]`);
		if (!next) return;
		next.focus();
		if (start != null) next.setSelectionRange(start, start);
	}

	function render() {
		renderTop();
		renderRail();
		renderEditor();
		renderPalette();
		renderFoot();
	}

	// --- keys and dropping files ---

	const typing = el => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);

	document.addEventListener('keydown', e => {
		if (document.querySelector('.veil')) return;
		const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
		if (ctrl && key === 's') { e.preventDefault(); saveFile(); return; }
		if (ctrl && key === 'o') { e.preventDefault(); openFile(); return; }
		if (ctrl && key === 'k') { e.preventDefault(); searchBox()?.focus(); return; }
		if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); travel(redo, undo, 'redo'); return; }
		if (ctrl && key === 'z') { e.preventDefault(); travel(undo, redo, 'undo'); return; }
		if (e.altKey && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); setMode(MODES[+e.key - 1][0]); return; }
		if (typing(e.target)) return;
		if (ctrl && key === 'c' && !String(window.getSelection())) { copyLines(); return; }
		if (ctrl && key === 'v') { pasteLines(); return; }
		if (ctrl || e.altKey) return;
		if (e.key === '/') { e.preventDefault(); searchBox()?.focus(); return; }
		if (e.key === '?') { showKeys(); return; }
		if (e.key === '[') nextTarget(-1);
		if (e.key === ']') nextTarget(1);
		if (S.mode === 'colosseum' && /^[0-9]$/.test(e.key)) setGroup(+e.key);
	});

	let dragging = 0;
	const dropZone = document.getElementById('drop');
	window.addEventListener('dragenter', e => {
		e.preventDefault();
		dragging++;
		dropZone.hidden = false;
	});
	window.addEventListener('dragleave', () => {
		dragging = Math.max(0, dragging - 1);
		if (!dragging) dropZone.hidden = true;
	});
	window.addEventListener('dragover', e => e.preventDefault());
	window.addEventListener('drop', async e => {
		e.preventDefault();
		dragging = 0;
		dropZone.hidden = true;
		const file = e.dataTransfer.files[0];
		if (file) await loadBytes(file.name, new Uint8Array(await file.arrayBuffer()));
	});
	window.addEventListener('beforeunload', () => {
		commit();
		saveDraft();
	});

	// --- away ---

	for (const mode of Object.keys(S.docs)) saved[mode] = snapshot(mode);
	loadDraft();
	for (const mode of Object.keys(S.docs)) last[mode] = snapshot(mode);
	render();
	if (hasFolderApi()) {
		loadHandle().then(async handle => {
			if (!handle) return;
			S.folder = handle;
			S.folderLive = (await handle.queryPermission({mode: 'readwrite'})) === 'granted';
			renderFoot();
		}).catch(() => {});
	}
})();
