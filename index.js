'use strict'
var ssh2 = require('ssh2')
var inherits = require('util').inherits
var net = require('net')
var stoppable = require('stoppable')

function once (fn, context) {
  var result

  return function () {
    if (fn) {
      result = fn.apply(context || this, arguments)
      fn = null
    }

    return result
  }
}

function Client () {
  if (!(this instanceof Client)) {
    return new Client()
  }

  var this_ = this
  ssh2.Client.call(this)

  this._localServers = {}
  this._remoteTable = {}

  this.on('tcp connection', function (info, accept, reject) {
    var entry = this_._remoteTable[info.destPort]
    if (!entry) {
      reject()
      return
    }

    function _accept () {
      var client = net.createConnection(entry.port, entry.host, function () {
        var incoming = accept()
        incoming.pipe(client).pipe(incoming)
      }).on('error', function (err) {
        reject()
        this_.emit('remote forward error', err)
      })
    }

    this_.emit('remote forward', {
      remotePort: info.destPort,
      localHost: entry.host,
      localPort: entry.port,
      peerAddress: { address: info.srcIP, port: info.srcPort }
    }, once(_accept), once(reject)) || _accept()
  })
}

inherits(Client, ssh2.Client)

Client.prototype.localUnforward = function (localPort) {
  var this_ = this
  return new Promise(function (resolve, reject) {
    if (this_._localServers[localPort]) {
      this_._localServers[localPort].stop(function () {
        delete this_._localServers[localPort]
        resolve()
      })
    } else { resolve() }
  })
}

Client.prototype.localForward = function (localPort, remoteHost, remotePort) {
  var this_ = this
  if (remoteHost === undefined && remotePort === undefined) {
    return this.localUnforward(localPort)
  }
  return new Promise(function (resolve, reject) {
    var server = stoppable(net.createServer(function (client) {
      function _accept () {
        this_.forwardOut('127.0.0.1', localPort, remoteHost, remotePort, function (err, stream) {
          if (err) {
            this_.emit('local forward error', err)
            client.end()
          } else { stream.pipe(client).pipe(stream) }
        })
      }

      function _reject () {
        client.close()
      }

      this_.emit('local forward', {
        localPort: localPort,
        remoteHost: remoteHost,
        remotePort: remotePort,
        peerAddress: { address: client.remoteAddress, family: client.remoteFamily, port: client.remotePort }
      }, once(_accept), once(_reject)) || _accept()
    }).on('listening', function () {
      this_._localServers[server.address().port] = server
      server.removeAllListeners('error')
      server.on('error', function (err) {
        console.error(err)
        server.stop()
      })
      resolve(server.address())
    }).on('error', function (err) {
      server.stop(function () { reject(err) })
    }).listen({ host: '127.0.0.1', port: localPort, exclusive: true }))
  })
}

Client.prototype.remoteUnforward = function (remotePort) {
  var this_ = this
  return new Promise(function (resolve, reject) {
    this_.unforwardIn('127.0.0.1', remotePort, function (err) {
      if (err) reject(err)
      else resolve()
    })
  })
}

Client.prototype.remoteForward = function (remotePort, localIp, localPort) {
  var this_ = this
  if (localIp === undefined && localPort === undefined) {
    return this.remoteUnforward(localPort)
  }
  var prevEntry = this._remoteTable[remotePort]
  this._remoteTable[remotePort] = { port: localPort, host: localIp }
  if (!prevEntry) {
    return new Promise(function (resolve, reject) {
      this_.forwardIn('127.0.0.1', remotePort, function (err, port) {
        if (err) reject(err)
        else resolve(port)
      })
    })
  } else {
    return new Promise(function (resolve, reject) { resolve(remotePort) })
  }
}

module.exports = { Client: Client }
