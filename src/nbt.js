// Java-edition NBT: gzip-compressed, big-endian, an unnamed compound at the root - what NbtIo.writeCompressed makes.
// Values are kept typed as {t, v}, so what the app does not edit goes back out exactly as it came in.
const NBT = (() => {
	const BYTE = 1, SHORT = 2, INT = 3, LONG = 4, FLOAT = 5, DOUBLE = 6, BYTES = 7, STRING = 8, LIST = 9, COMPOUND = 10, INTS = 11, LONGS = 12;
	const text = new TextEncoder(), untext = new TextDecoder();

	function decode(bytes) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let at = 0;
		const u8 = () => view.getUint8(at++);
		const i32 = () => {
			const v = view.getInt32(at);
			at += 4;
			return v;
		};
		const str = () => {
			const n = view.getUint16(at);
			at += 2;
			const s = untext.decode(bytes.subarray(at, at + n));
			at += n;
			return s;
		};
		const value = t => {
			switch (t) {
				case BYTE: return view.getInt8(at++);
				case SHORT: { const v = view.getInt16(at); at += 2; return v; }
				case INT: return i32();
				case LONG: { const v = view.getBigInt64(at); at += 8; return v; }
				case FLOAT: { const v = view.getFloat32(at); at += 4; return v; }
				case DOUBLE: { const v = view.getFloat64(at); at += 8; return v; }
				case BYTES: { const n = i32(), v = bytes.slice(at, at + n); at += n; return v; }
				case STRING: return str();
				case LIST: {
					const of = u8(), n = i32(), v = [];
					for (let i = 0; i < n; i++) v.push(value(of));
					return {of, items: v};
				}
				case COMPOUND: {
					const v = {};
					for (let k = u8(); k !== 0; k = u8()) {
						const name = str();
						v[name] = {t: k, v: value(k)};
					}
					return v;
				}
				case INTS: {
					const n = i32(), v = [];
					for (let i = 0; i < n; i++) v.push(i32());
					return v;
				}
				case LONGS: {
					const n = i32(), v = [];
					for (let i = 0; i < n; i++) { v.push(view.getBigInt64(at)); at += 8; }
					return v;
				}
				default: throw new Error(`Bad NBT tag ${t} at byte ${at}`);
			}
		};
		const root = u8();
		if (root !== COMPOUND) throw new Error('Not an NBT compound');
		str();
		return value(COMPOUND);
	}

	function encode(root) {
		let buffer = new Uint8Array(4096), view = new DataView(buffer.buffer), at = 0;
		const room = n => {
			if (at + n <= buffer.length) return;
			const bigger = new Uint8Array(Math.max(buffer.length * 2, at + n));
			bigger.set(buffer);
			buffer = bigger;
			view = new DataView(buffer.buffer);
		};
		const u8 = v => { room(1); view.setUint8(at++, v); };
		const i32 = v => { room(4); view.setInt32(at, v); at += 4; };
		const str = s => {
			const d = text.encode(s);
			room(2 + d.length);
			view.setUint16(at, d.length);
			at += 2;
			buffer.set(d, at);
			at += d.length;
		};
		const value = (t, v) => {
			switch (t) {
				case BYTE: room(1); view.setInt8(at++, v); break;
				case SHORT: room(2); view.setInt16(at, v); at += 2; break;
				case INT: i32(v); break;
				case LONG: room(8); view.setBigInt64(at, v); at += 8; break;
				case FLOAT: room(4); view.setFloat32(at, v); at += 4; break;
				case DOUBLE: room(8); view.setFloat64(at, v); at += 8; break;
				case BYTES: i32(v.length); room(v.length); buffer.set(v, at); at += v.length; break;
				case STRING: str(v); break;
				case LIST:
					u8(v.items.length ? v.of : 0);
					i32(v.items.length);
					for (const item of v.items) value(v.of, item);
					break;
				case COMPOUND:
					for (const [name, tag] of Object.entries(v)) {
						u8(tag.t);
						str(name);
						value(tag.t, tag.v);
					}
					u8(0);
					break;
				case INTS: i32(v.length); for (const n of v) i32(n); break;
				case LONGS: i32(v.length); for (const n of v) { room(8); view.setBigInt64(at, n); at += 8; } break;
				default: throw new Error(`Bad NBT tag ${t}`);
			}
		};
		u8(COMPOUND);
		str('');
		value(COMPOUND, root);
		return buffer.slice(0, at);
	}

	async function pipe(bytes, stream) {
		const out = new Blob([bytes]).stream().pipeThrough(stream);
		return new Uint8Array(await new Response(out).arrayBuffer());
	}

	/** A file's bytes as a root compound; a file saved uncompressed is read as it is. */
	async function parse(bytes) {
		const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
		return decode(gzipped ? await pipe(bytes, new DecompressionStream('gzip')) : bytes);
	}

	const serialize = root => pipe(encode(root), new CompressionStream('gzip'));

	// Builders: compound values are written as tags, in the order given.
	const int = v => ({t: INT, v: Math.trunc(v)});
	const float = v => ({t: FLOAT, v});
	const string = v => ({t: STRING, v: v == null ? '' : String(v)});
	const ints = v => ({t: INTS, v: [...v]});
	const compound = v => ({t: COMPOUND, v});
	const list = (items, of = COMPOUND) => ({t: LIST, v: {of, items}});

	return {parse, serialize, decode, encode, int, float, string, ints, compound, list};
})();
if (typeof module !== 'undefined') module.exports = NBT;
