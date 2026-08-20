/*
 * AutoLog — helper HTTP: static, body, json, cookie, auth.
 */
'use strict';

var fs = require('node:fs');
var path = require('node:path');
var crypto = require('node:crypto');

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function json(res, status, data, headers) {
  var body = JSON.stringify(data);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, headers || {}));
  res.end(body);
}

function error(res, status, message) {
  json(res, status, { error: message });
}

function readBody(req, limit) {
  limit = limit || 32 * 1024 * 1024;
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) { reject(new Error('Corpo della richiesta troppo grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

async function readJson(req) {
  var raw = await readBody(req);
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); }
  catch (e) { throw new Error('JSON non valido'); }
}

function parseCookies(req) {
  var out = {};
  var header = req.headers.cookie;
  if (!header) return out;
  header.split(';').forEach(function (part) {
    var i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/* ---------- static ---------- */

function safeJoin(root, urlPath) {
  var clean = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  var target = path.resolve(root, clean);
  var rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) return null;
  return target;
}

function serveStatic(root, urlPath, res, extraHeaders) {
  var file = safeJoin(root, urlPath || '');
  if (!file) return false;
  var stat;
  try { stat = fs.statSync(file); } catch (e) { return false; }
  if (stat.isDirectory()) {
    file = path.join(file, 'index.html');
    try { stat = fs.statSync(file); } catch (e) { return false; }
  }
  return sendFile(file, stat, res, extraHeaders);
}

function sendFile(file, stat, res, extraHeaders) {
  var ext = path.extname(file).toLowerCase();
  var etag = '"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + '"';
  var headers = Object.assign({
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'ETag': etag,
    'Cache-Control': 'no-cache'
  }, extraHeaders || {});
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
  return true;
}

/* ---------- autenticazione ---------- */

function sha256(v) { return crypto.createHash('sha256').update(String(v)).digest(); }

function passwordMatches(provided, expected) {
  if (!expected) return true;
  var a = sha256(provided || ''), b = sha256(expected);
  return crypto.timingSafeEqual(a, b);
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function makeToken(secret, days) {
  var exp = Date.now() + (days || 90) * 86400000;
  return exp + '.' + sign(exp, secret);
}

function tokenValid(token, secret) {
  if (!token) return false;
  var i = String(token).indexOf('.');
  if (i < 0) return false;
  var exp = String(token).slice(0, i), sig = String(token).slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  var expected = sign(exp, secret);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function cookieHeader(name, value, maxAgeSeconds) {
  var parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push('Max-Age=' + (maxAgeSeconds === 0 ? 0 : maxAgeSeconds));
  return parts.join('; ');
}

module.exports = {
  MIME: MIME,
  json: json,
  error: error,
  readBody: readBody,
  readJson: readJson,
  parseCookies: parseCookies,
  safeJoin: safeJoin,
  serveStatic: serveStatic,
  sendFile: sendFile,
  passwordMatches: passwordMatches,
  sign: sign,
  makeToken: makeToken,
  tokenValid: tokenValid,
  cookieHeader: cookieHeader
};
