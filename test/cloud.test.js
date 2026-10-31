// The cloud calls the app makes, with fetch stood in for, and the session it keeps.
const assert = require('node:assert');
const test = require('node:test');

const store = new Map();
globalThis.localStorage = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k)};
globalThis.history = {replaceState: () => { globalThis.location.hash = ''; }};
globalThis.location = {protocol: 'http:', origin: 'http://localhost:5180', pathname: '/', search: '', hash: ''};

const Cloud = require('../src/cloud.js');

const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const at = (seconds) => Math.floor(Date.now() / 1000) + seconds;

function answer(calls, ...replies) {
	globalThis.fetch = async (url, options = {}) => {
		calls.push({url, ...options});
		const reply = replies.shift() || {};
		return {ok: (reply.status || 200) < 400, status: reply.status || 200, json: async () => reply.body};
	};
}

function signIn(expires = 3600) {
	location.hash = `#access_token=${jwt({sub: 'u1', email: 'a@b.c'})}&refresh_token=r1&expires_at=${at(expires)}`;
	return Cloud.takeRedirect();
}

test('a redirect signs in and clears the address', () => {
	assert.equal(signIn(), 'in');
	assert.equal(location.hash, '');
	assert.equal(Cloud.user(), 'a@b.c');
	assert.equal(Cloud.takeRedirect(), null);
	location.hash = '#error=access_denied&error_description=No+thanks';
	assert.equal(Cloud.takeRedirect(), 'No thanks');
});

test('saving upserts on the name, under the signed-in user', async () => {
	signIn();
	const calls = [];
	answer(calls, {status: 201});
	await Cloud.put('temple', 'run 1', {spawns: []});
	const [call] = calls;
	assert.match(call.url, /fa_files\?on_conflict=user_id,kind,name$/);
	assert.equal(call.method, 'POST');
	assert.match(call.headers.Prefer, /merge-duplicates/);
	assert.match(call.headers.Authorization, /^Bearer x\./);
	assert.deepEqual(JSON.parse(call.body), {user_id: 'u1', kind: 'temple', name: 'run 1', doc: {spawns: []}});
});

test('listing leaves the file bodies behind, and a missing file says so', async () => {
	signIn();
	const calls = [];
	answer(calls, {body: []}, {body: []});
	assert.deepEqual(await Cloud.list('waves'), []);
	assert.match(calls[0].url, /select=id,name,updated_at&kind=eq\.waves/);
	await assert.rejects(Cloud.get('nope'), /gone/);
});

test('an expiring session renews once, and a refused one signs out', async () => {
	signIn(10);
	const calls = [];
	answer(calls, {body: {access_token: jwt({sub: 'u1', email: 'a@b.c'}), refresh_token: 'r2', expires_at: at(3600)}}, {body: []}, {body: []});
	await Promise.all([Cloud.list('waves'), Cloud.list('temple')]);
	assert.equal(calls.filter(c => c.url.includes('/auth/v1/token')).length, 1);
	assert.equal(JSON.parse(calls[0].body).refresh_token, 'r1');
	signIn(10);
	answer([], {status: 400, body: {}});
	await assert.rejects(Cloud.list('waves'), /Sign in again/);
	assert.equal(Cloud.user(), null);
});
