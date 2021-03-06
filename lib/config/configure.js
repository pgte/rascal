'use strict'

var debug = require('debug')('rascal:config:configure')
var format = require('util').format
var url = require('url')
var _ = require('lodash').runInContext().mixin({ 'defaultsDeep': require('merge-defaults') })
var uuid = require('node-uuid').v4
var emptyConfig = require('./empty')
var fqn = require('./fqn')
var XRegExp = require('xregexp').XRegExp

module.exports = _.curry(function(rascalConfig, next) {

    rascalConfig = _.defaultsDeep(rascalConfig, emptyConfig, { publications: {}, subscriptions: {} })
    configureVhosts(rascalConfig.vhosts)
    configurePublications(rascalConfig.publications)
    configureSubscriptions(rascalConfig.subscriptions)
    configureShovels(rascalConfig.shovels)

    return next(null, rascalConfig)

    function configureVhosts(vhosts) {
        _.each(rascalConfig.vhosts, function(vhostConfig, name) {
            configureVhost(name, vhostConfig)
            configureExchanges(vhostConfig)
            configureQueues(vhostConfig)
            configureBindings(vhostConfig)
            configureVhostPublications(vhostConfig)
            configureVhostSubscriptions(vhostConfig)
        })
    }

    function configureVhost(name, vhostConfig) {
        debug('Configuring vhost: %s', name)
        rascalConfig.vhosts[name] = _.defaultsDeep(vhostConfig, { name: name, namespace: rascalConfig.defaults.vhosts.namespace }, { defaults: rascalConfig.defaults.vhosts })
        rascalConfig.vhosts[name].namespace = vhostConfig.namespace === true ? uuid() : vhostConfig.namespace
        configureConnection(vhostConfig, name)
    }

    function configureConnection(vhostConfig, name) {
        vhostConfig.connection = _.defaultsDeep(vhostConfig.connection || {}, vhostConfig.defaults.connection)
        vhostConfig.connection.vhost = vhostConfig.connection.vhost !== undefined ? vhostConfig.connection.vhost : name,
        vhostConfig.connection.auth = vhostConfig.connection.user + ':' + vhostConfig.connection.password
        vhostConfig.connection.pathname = vhostConfig.connection.vhost === '/' ? '' : vhostConfig.connection.vhost
        vhostConfig.connection.query = vhostConfig.connection.options
        vhostConfig.connection.url = vhostConfig.connection.url || url.format(vhostConfig.connection)
        vhostConfig.connection.loggableUrl = vhostConfig.connection.url.replace(/:[^:]*?@/, ':***@')
    }

    function configureVhostPublications(vhostConfig) {
        _.each(vhostConfig.publications, function(publicationConfig, name) {
            publicationConfig.vhost = vhostConfig.name
            configurePublication(publicationConfig, name)
        })
        delete vhostConfig.publications
    }

    function configurePublications(publications) {
        _.each(publications, configurePublication)
    }

    function configurePublication(publicationConfig, name) {
        debug('Configuring publication: %s', name)
        rascalConfig.publications[name] = _.defaultsDeep(publicationConfig, { name: name }, rascalConfig.defaults.publications)
        if (!rascalConfig.vhosts[publicationConfig.vhost]) return
        var destination = publicationConfig.exchange ? rascalConfig.vhosts[publicationConfig.vhost].exchanges[publicationConfig.exchange]
                                                     : rascalConfig.vhosts[publicationConfig.vhost].queues[publicationConfig.queue]
        rascalConfig.publications[name].destination = destination.fullyQualifiedName
    }

    function configureVhostSubscriptions(vhostConfig) {
        _.each(vhostConfig.subscriptions, function(subscriptionConfig, name) {
            subscriptionConfig.vhost = vhostConfig.name
            configureSubscription(subscriptionConfig, name)
        })
        delete vhostConfig.subscriptions
    }

    function configureSubscriptions(subscriptions) {
        _.each(subscriptions, configureSubscription)
    }

    function configureSubscription(subscriptionConfig, name) {
        debug('Configuring subscription: %s', name)
        rascalConfig.subscriptions[name] = _.defaultsDeep(subscriptionConfig, { name: name }, rascalConfig.defaults.subscriptions)
        if (!rascalConfig.vhosts[subscriptionConfig.vhost]) return
        subscriptionConfig.source = rascalConfig.vhosts[subscriptionConfig.vhost].queues[subscriptionConfig.queue].fullyQualifiedName
    }

    function configureShovels(shovels) {
        rascalConfig.shovels = ensureKeyedCollection(shovels)
        _.each(rascalConfig.shovels, configureShovel)
    }

    function configureShovel(shovelConfig, name) {
        debug('Configuring shovel: %s', name)
        var parsedConfig = parseShovelName(name)
        rascalConfig.shovels[name] = _.defaultsDeep(shovelConfig, { name: name }, parsedConfig, rascalConfig.defaults.shovels)
    }

    function parseShovelName(name) {
        var pattern = XRegExp('(?<subscription>[\\w:]+)\\s*->\\s*(?<publication>[\\w:]+)')
        var match = XRegExp.exec(name, pattern)
        return match ? { name: name, subscription: match.subscription, publication: match.publication } : { name: name }
    }
})

function configureExchanges(config) {
    config.exchanges = ensureKeyedCollection(config.exchanges)
    _.each(config.exchanges, function(exchangeConfig, name) {
        debug('Configuring exchange: %s', name)
        config.exchanges[name] = _.defaultsDeep(exchangeConfig, { name: name, fullyQualifiedName: fqn.qualify(name, config.namespace) }, config.defaults.exchanges)
    })
}

function configureQueues(config) {
    config.queues = ensureKeyedCollection(config.queues)
    _.each(config.queues, function(queueConfig, name) {
        debug('Configuring queue: %s', name)
        queueConfig.replyTo = queueConfig.replyTo === true ? uuid() : queueConfig.replyTo
        qualifyArguments(config.namespace, queueConfig.options && queueConfig.options.arguments)
        config.queues[name] = _.defaultsDeep(queueConfig, { name: name, fullyQualifiedName: fqn.qualify(name, config.namespace, queueConfig.replyTo) }, config.defaults.queues)
    })
}

function configureBindings(config) {

    config.bindings = expandBindings(ensureKeyedCollection(config.bindings))

    _.each(config.bindings, function(bindingConfig, name) {
        debug('Configuring binding: %s', name)

        config.bindings[name] = _.defaultsDeep(bindingConfig, config.defaults.bindings)

        if (bindingConfig.qualifyBindingKeys) {
            config.bindings[name].bindingKey = fqn.qualify(bindingConfig.bindingKey, config.namespace)
        }
        if (bindingConfig.destinationType === 'queue') {
            var queue = config.queues[bindingConfig.destination]
            config.bindings[name].bindingKey = fqn.prefix(queue && queue.replyTo, bindingConfig.bindingKey, '.')
        }
    })
}

function parseBindingName(name) {
    var pattern = XRegExp('(?<source>[\\w:]+)\\s*(?:\\[\\s*(?<keys>.*)\\s*\\])?\\s*->\\s*(?<destination>[\\w:]+)')
    var match = XRegExp.exec(name, pattern)
    return match ? { name: name, source: match.source, destination: match.destination, bindingKeys: splitBindingKeys(match.keys) } : { name: name }
}

function splitBindingKeys(keys) {
    return keys ? _.compact(keys.split(/[,\s]+/)) : undefined
}

function expandBindings(definitions) {
    var result = {}
    _.each(definitions, function(bindingConfig, name) {
        var parsedConfig = parseBindingName(name)
        var bindingKeys = _.chain([]).concat(bindingConfig.bindingKeys, bindingConfig.bindingKey, parsedConfig.bindingKeys).compact().unique().value()
        if (bindingKeys.length <= 1) return result[name] = _({ bindingKey: bindingKeys[0] }).defaults(bindingConfig, parsedConfig).omit('bindingKeys').value()
        _.each(bindingKeys, function(bindingKey) {
            result[format('%s:%s', name, bindingKey)] = _({ bindingKey: bindingKey }).defaults(bindingConfig, parsedConfig).omit('bindingKeys').value()
        })
    })
    return result
}

function qualifyArguments(namespace, args) {
    if (!args) return
    _.each(['x-dead-letter-exchange'], function(name) {
        args[name] = args[name] !== undefined ? fqn.qualify(args[name], namespace) : args[name]
    })
}

function ensureKeyedCollection(collection) {
    if (!_.isArray(collection)) return collection
    return _.chain(collection).map(function(item) {
        return _.isString(item) ? { name: item } : _.defaults(item, { name: 'unnamed-' + uuid() })
    }).indexBy('name').value()
}
