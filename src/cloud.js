// Files kept in Supabase, in the fa_files table of the D&D DB project, one set per signed-in user. The key below is the project's
// public anon key: row level security is what keeps each user to their own files. Never put a service key here.
const Cloud = (() => {
	const URL = 'https://yfbtrvzpnmmlybapkpeh.supabase.co';
	const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmYnRydnpwbm1tbHliYXBrcGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM2MzI2ODIsImV4cCI6MjA2OTIwODY4Mn0.k1C2KlFgjHjMu2PiZAyWw0xtuFbJ-anh4lU08ofZR9g';
	const SESSION_KEY = 'nbt_ui.cloud.v1';
	const SOON = 60;

	let session = null, refreshing = null;

	const now = () => Math.floor(Date.now() / 1000);

	const claims = token => JSON.parse(decodeURIComponent(escape(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));

	function keep(next) {
		session = next;
		try {
			if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
			else localStorage.removeItem(SESSION_KEY);
		} catch { /* Private window: the session lasts as long as the page. */ }
	}

	function load() {
		try {
			session = JSON.parse(localStorage.getItem(SESSION_KEY));
		} catch { /* A session that cannot be read means signing in again. */ }
	}

	/** Google sends the browser back with the session in the address. Returns 'in', an error's text, or null. */
	function takeRedirect() {
		const hash = new URLSearchParams(location.hash.slice(1));
		const token = hash.get('access_token'), error = hash.get('error_description') || hash.get('error');
		if (!token && !error) return null;
		history.replaceState(null, '', location.pathname + location.search);
		if (error) return error;
		keep({access: token, refresh: hash.get('refresh_token'), expires: +hash.get('expires_at') || now() + +hash.get('expires_in')});
		return 'in';
	}

	/** Only a page on a web address can be sent back to after signing in, so not one opened from disk. */
	const canSignIn = () => location.protocol === 'http:' || location.protocol === 'https:';

	const user = () => (session ? claims(session.access).email : null);

	function signIn() {
		location.href = `${URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(location.origin)}`;
	}

	const signOut = () => keep(null);

	async function refresh() {
		const res = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, {method: 'POST', headers: {apikey: KEY, 'Content-Type': 'application/json'},
			body: JSON.stringify({refresh_token: session.refresh})});
		if (res.status === 400 || res.status === 401) {
			keep(null);
			throw new Error('Signed out. Sign in again from Cloud.');
		}
		if (!res.ok) throw new Error(`Sign-in could not be renewed (${res.status})`);
		const body = await res.json();
		keep({access: body.access_token, refresh: body.refresh_token, expires: body.expires_at || now() + body.expires_in});
	}

	async function token() {
		if (!session) throw new Error('Not signed in');
		if (session.expires - now() < SOON) {
			refreshing ??= refresh().finally(() => { refreshing = null; });
			await refreshing;
		}
		return session.access;
	}

	async function rest(path, options = {}) {
		const res = await fetch(`${URL}/rest/v1/fa_files?${path}`, {...options,
			headers: {apikey: KEY, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...options.headers}});
		if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `The cloud said ${res.status}`);
		return res.status === 204 || options.method === 'DELETE' ? null : res.json();
	}

	const list = kind => rest(`select=id,name,updated_at&kind=eq.${kind}&order=updated_at.desc`);

	async function get(id) {
		const [row] = await rest(`select=kind,name,doc&id=eq.${id}`);
		if (!row) throw new Error('That file is gone');
		return row;
	}

	/** Saves over the file of this kind and name, if there is one. */
	async function put(kind, name, doc) {
		await token();
		await rest('on_conflict=user_id,kind,name', {method: 'POST', headers: {Prefer: 'resolution=merge-duplicates,return=minimal'},
			body: JSON.stringify({user_id: claims(session.access).sub, kind, name, doc})});
	}

	const remove = id => rest(`id=eq.${id}`, {method: 'DELETE'});

	load();
	return {takeRedirect, canSignIn, user, signIn, signOut, list, get, put, remove};
})();
if (typeof module !== 'undefined') module.exports = Cloud;
