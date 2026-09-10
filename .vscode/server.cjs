const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

console.log('Starting local server');
http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end();
    }
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (_) {
        res.writeHead(400);
        return res.end('Bad request');
    }
    if (pathname === '/') pathname = '/index.html';
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) ||
        relative.split(/[\\/]/).some(part => part.startsWith('.')) ||
        pathname.includes(':') || pathname.includes('\0')) {
        res.writeHead(403);
        return res.end('Forbidden');
    }
    fs.readFile(file, (error, data) => {
        if (error) {
            res.writeHead(404);
            return res.end('Not found');
        }
        res.writeHead(200, {
            'X-Local-Preview': 'seikyuusyo-sakusei',
            'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        res.end(req.method === 'HEAD' ? undefined : data);
    });
}).on('error', error => {
    if (error.code === 'EADDRINUSE') {
        const probe = http.get('http://127.0.0.1:8080/index.html', response => {
            response.resume();
            if (response.headers['x-local-preview'] === 'seikyuusyo-sakusei') {
                console.log('Local server ready: http://127.0.0.1:8080/index.html');
            } else {
                console.error('ERROR Port 8080 is used by another server.');
                process.exitCode = 1;
            }
        });
        probe.setTimeout(3000, () => probe.destroy(new Error('Server check timed out')));
        probe.on('error', probeError => {
            console.error('ERROR ' + probeError.message);
            process.exitCode = 1;
        });
        return;
    }
    console.error('ERROR ' + error.message);
    process.exit(1);
}).listen(8080, '127.0.0.1', () => {
    console.log('Local server ready: http://127.0.0.1:8080/index.html');
});
