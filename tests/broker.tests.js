var assert = require('assert')
var _ = require('lodash').mixin({ 'defaultsDeep': require('merge-defaults') })
var async = require('async')
var testConfig = require('../lib/config/tests')
var format = require('util').format
var uuid = require('node-uuid').v4
var Broker = require('..').Broker


describe('Broker', function() {

    this.timeout(2000)
    this.slow(1000)

    var broker = undefined
    var namespace = undefined
    var vhosts = undefined

    beforeEach(function(done) {

        namespace = uuid()

        vhosts = {
            '/': {
                namespace: namespace,
                exchanges: {
                    e1: {
                        assert: true
                    }
                },
                queues: {
                    q1: {
                        assert: true
                    }
                }
            }
        }

        done()
    })

    afterEach(function(done) {
        if (broker) return broker.nuke(done)
        done()
    })

    it('should provide fully qualified name', function(done) {
        createBroker({
            vhosts: vhosts
        }, function(err, broker) {
            assert.ifError(err)
            assert.equal(namespace + ':q1', broker.getFullyQualifiedName('/', 'q1'))
            done()
        })
    })

    function createBroker(config, next) {
        config = _.defaultsDeep(config, testConfig)
        Broker.create(config, function(err, _broker) {
            broker = _broker
            next(err, broker)
        })
    }
})