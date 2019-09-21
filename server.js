'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const auth = require('basic-auth');
const SonosSystem = require('sonos-discovery');
const logger = require('sonos-discovery/lib/helpers/logger');
const SonosHttpAPI = require('./lib/sonos-http-api.js');
const nodeStatic = require('node-static');
const settings = require('./settings');
const url = require('url');

const WebSocketServer = require('websocket').server;

const fileServer = new nodeStatic.Server(settings.webroot);
const discovery = new SonosSystem(settings);
const api = new SonosHttpAPI(discovery, settings);

var requestHandler = function (req, res) {
  req.addListener('end', function () {
    fileServer.serve(req, res, function (err) {

      // If error, route it.
      // This bypasses authentication on static files!
      if (!err) {
        return;
      }

      if (settings.auth) {
        var credentials = auth(req);

        if (!credentials || credentials.name !== settings.auth.username || credentials.pass !== settings.auth.password) {
          res.statusCode = 401;
          res.setHeader('WWW-Authenticate', 'Basic realm="Access Denied"');
          res.end('Access denied');
          return;
        }
      }

      // Enable CORS requests
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.headers['access-control-request-headers']) {
        res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
      }

      if (req.method === 'OPTIONS') {
        res.end();
        return;
      }

      if (req.method === 'GET') {
        api.requestHandler(req, res);
      }
    });
  }).resume();
};

let server;

if (settings.https) {
  var options = {};
  if (settings.https.pfx) {
    options.pfx = fs.readFileSync(settings.https.pfx);
    options.passphrase = settings.https.passphrase;
  } else if (settings.https.key && settings.https.cert) {
    options.key = fs.readFileSync(settings.https.key);
    options.cert = fs.readFileSync(settings.https.cert);
  } else {
    logger.error("Insufficient configuration for https");
    return;
  }

  const secureServer = https.createServer(options, requestHandler);
  secureServer.listen(settings.securePort, function () {
    logger.info('https server listening on port', settings.securePort);
  });
}

server = http.createServer(requestHandler);
var wss = new WebSocketServer({ httpServer: server });

process.on('unhandledRejection', (err) => {
  logger.error(err);
});

wss.on('request',function (request) {
  var reqUrl = url.parse(request.resourceURL,true);
  if ( reqUrl.pathname == "/ws" ) {
    if ( request.requestedProtocols.includes('live') )
      request.accept("live",request.origin);
    else
      request.reject();
  } else {
    logger.info("got websocket attempt for wrong endpoint");
  }
});
 
wss.on('connect', function (connection) {
  if ( connection.protocol == 'live' ) {
    logger.info('got websocket connection');
    api.addWebsocketClient(connection);
  } else {
    connection.drop();
  }
});


let host = settings.ip;
server.listen(settings.port, host, function () {
  logger.info('http server listening on', host, 'port', settings.port);
});

server.on('error', (err) => {
  if (err.code && err.code === 'EADDRINUSE') {
    logger.error(`Port ${settings.port} seems to be in use already. Make sure the sonos-http-api isn't 
    already running, or that no other server uses that port. You can specify an alternative http port 
    with property "port" in settings.json`);
  } else {
    logger.error(err);
  }

  process.exit(1);
});


