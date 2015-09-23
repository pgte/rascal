var debug = require('debug')('rascal:Vhost')
var format = require('util').format
var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter
var async = require('async')
var tasks = require('./tasks')
var forwardEvents = require('forward-emitter')

module.exports = {
    create: function(config, next) {
        new Vhost(config).init(next)
    }
}

inherits(Vhost, EventEmitter)

function Vhost(config) {

    var self = this
    var connection
    var channelAllocator = async.queue(createChannel, 1)

    var init = async.compose(tasks.closeChannel, tasks.applyBindings, tasks.purgeQueues, tasks.checkQueues, tasks.assertQueues, tasks.checkExchanges, tasks.assertExchanges, tasks.createChannel, tasks.createConnection)
    var bounce = async.compose(init, tasks.closeConnection)
    var purge = async.compose(tasks.closeConnection, tasks.closeChannel, tasks.purgeQueues, tasks.createChannel, tasks.createConnection)
    var nuke = async.compose(tasks.closeConnection, tasks.closeChannel, tasks.deleteQueues, tasks.deleteExchanges, tasks.createChannel, tasks.createConnection)

    this.init = function(next) {
        debug(format('Initialising vhost: %s', config.name))
        channelAllocator.pause()
        init(config, {}, function(err, config, ctx) {
            if (err) return next(err)
            self.emit('connect');
            // TODO its possible a connection error has already triggered an init cycle, so may need to disconnect again
            ctx.connection.removeAllListeners('error')
            ctx.connection.once('error', handleConnectionError.bind(null, config))
            forwardEvents(ctx.connection, self, function(eventName) {
                return ['block', 'unblock'].indexOf(eventName) >= 0;
            })
            connection = ctx.connection
            channelAllocator.resume()
            return next(null, self)
        })
        return self
    }

    this.nuke = function(next) {
        debug(format('Nuking vhost: %s', config.name))
        channelAllocator.pause()
        nuke(config, {}, function(err, config, ctx) {
            if (err) return next(err)
            connection = undefined
            debug(format('Finished nuking vhost: %s', config.name))
            setImmediate(next)
        })
    }

    this.purge = function(next) {
        debug(format('Purging vhost: %s', config.name))
        purge(config, { purge: true }, function(err, config, ctx) {
            if (err) return next(err)
            debug(format('Finished purging vhost: %s', config.name))
            setImmediate(next)
        })
    }

    this.bounce = function(next) {
        debug(format('Bouncing vhost: %s', config.name))
        channelAllocator.pause()
        bounce(config, {}, function() {
            setImmediate(next)
        })
    }

    this.disconnect = function(next) {
        debug(format('Disconnecting vhost: %s', config.name))
        channelAllocator.pause()
        if (!connection) return next()
        connection.removeAllListeners()
        connection.on('error', function(err) {
            debug(format('Error disconnecting from %s. Original error was: %s', config.connection.loggableUrl, err.message))
        })
        connection.close(next)
    }

    this.getChannel = function(next) {
        channelAllocator.push({ confirm: false }, next)
        debug(format('Requested channel. Outstanding channel requests: %d', channelAllocator.length()))
    }

    this.getConfirmChannel = function(next) {
        channelAllocator.push({ confirm: true }, next)
        debug(format('Requested confirm channel. Outstanding channel requests: %d', channelAllocator.length()))
    }

    function createChannel(options, next) {
        options.confirm ? connection.createConfirmChannel(callback) : connection.createChannel(callback)

        function callback(err, channel) {
            if (err) return next(err)
            next(null, channel)
        }
    }

    function handleConnectionError(config, err) {
        debug(format('Handling connection error: %s from %s', err.message, config.connection.loggableUrl))
        channelAllocator.pause()
        connection = undefined
        self.emit('error', err)
        self.emit('disconnect');
        config.connection.retry && self.init(function(err) {
            if (err) return setTimeout(handleConnectionError.bind(null, config, err), config.connection.retry.delay)
        })
    }
}


