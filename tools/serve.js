// A small static server for `npm start`. The app also runs by opening index.html directly.
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 5180;
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};

http.createServer((req, res) => {
	const url = decodeURIComponent(req.url.split('?')[0]);
	const file = path.join(ROOT, url === '/' ? 'index.html' : url);
	if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		res.writeHead(404);
		res.end('Not found');
		return;
	}
	res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
	fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`NBT builder at http://localhost:${PORT}`));
