const express = require('express');
const app = express();

app.set('trust proxy', true);

function getIp(req) {
  return req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
}

// Key headers endpoint (replaces phoneinfo.php)
app.get('/phoneinfo.php', (req, res) => {
  const h = req.headers;
  res.json({
    'User Agent':      h['user-agent']          || null,
    'Client Address':  getIp(req),
    'Proxy Server':    h['via']                 || null,
    'Sub ID':          h['x-up-subno']          || null,
    'RDF File':        h['x-wap-profile']       || null,
    'Language':        h['accept-language']     || null,
    'Character Set':   h['accept-charset']      || null,
    'Connection':      h['connection']          || null,
    'Accept':          h['accept']              || null,
    'Expires':         h['expires']             || null,
    'Cache Control':   h['cache-control']       || null,
    'Client Port':     String(req.socket.remotePort || ''),
    'Method':          req.method,
    'Protocol':        (req.headers['x-forwarded-proto'] || 'http').toUpperCase() + '/1.1',
    'Encoding':        h['accept-encoding']     || null,
  });
});

// All headers endpoint
app.get('/api/headers', (req, res) => {
  const h = { ...req.headers };
  // Clean up proxy internals
  delete h['x-real-ip'];
  delete h['x-forwarded-for'];
  delete h['x-forwarded-proto'];
  res.json(h);
});

app.use(express.static(__dirname));
app.listen(3002, () => console.log('bitwerks running on 3002'));
