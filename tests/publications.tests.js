var assert = require('assert')
var _ = require('lodash').mixin({ 'defaultsDeep': require('merge-defaults') })
var async = require('async')
var amqplib = require('amqplib/callback_api')
var testConfig = require('../lib/config/tests')
var format = require('util').format
var uuid = require('node-uuid').v4
var Broker = require('..').Broker
var AmqpUtils = require('./utils/amqputils')

describe('Publications', function() {

    this.timeout(2000)
    this.slow(1000)

    var broker = undefined
    var amqputils = undefined
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
                    },
                    e2: {
                        assert: true
                    },
                    xx: {
                        assert: true
                    }
                },
                queues: {
                    q1: {
                        assert: true
                    },
                    q2: {
                        assert: true
                    }
                },
                bindings: {
                    b1: {
                        source: 'e1',
                        destination: 'q1'
                    },
                    b2: {
                        source: 'e2',
                        destination: 'q2'
                    }
                }
            }
        }

        amqplib.connect(function(err, connection) {
            if (err) return done(err)
            amqputils = AmqpUtils.init(connection)
            done()
        })
    })

    afterEach(function(done) {
        if (broker) return broker.nuke(done)
        done()
    })

    it('should report unknown publications', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'e1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('does-not-exist', 'test message', function(err) {
                assert.ok(err)
                assert.equal(err.message, 'Unknown publication: does-not-exist')
                done()
            })
        })
    })

    it('should publish text messages to normal exchanges', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'e1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', 'test message', function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(messageId) {
                    amqputils.assertMessage('q1', namespace, 'test message', done)
                })
            })
        })
    })

    it('should publish text messages using confirm channels to exchanges', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'e1',
                    confirm: true
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', 'test message', function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(messageId) {
                    amqputils.assertMessage('q1', namespace, 'test message', done)
                })
            })
        })
    })

    it('should publish text messages to queues', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    queue: 'q1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', 'test message', function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(messageId) {
                    amqputils.assertMessage('q1', namespace, 'test message', done)
                })
            })
        })
    })

    it('should decorate the message with a uuid', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'e1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', 'test message', function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(messageId) {
                    assert.ok(/\w+-\w+-\w+-\w+-\w+/.test(messageId), format('%s failed to match expected pattern', messageId))

                    amqputils.getMessage('q1', namespace, function(err, message) {
                        assert.ifError(err)
                        assert.ok(message)
                        assert.equal(messageId, message.properties.messageId)
                        done()
                    })
                })
            })
        })
    })

    it('should publish to using confirm channels to queues', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    queue: 'q1',
                    confirm: true
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', 'test message', function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(messageId) {
                    amqputils.assertMessage('q1', namespace, 'test message', done)
                })
            })
        })
    })

    it('should publish json messages to normal exchanges', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'e1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', { message: 'test message' }, function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(messageId) {
                    amqputils.assertMessage('q1', namespace, JSON.stringify({ message: 'test message' }), done)
                })
            })
        })
    })

    it('should publish messages with custom contentType to normal exchanges', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'e1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', { message: 'test message' }, { options: { contentType: 'application/vnd+custom.contentType.v1' } }, function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(messageId) {
                    amqputils.getMessage('q1', namespace, function(err, message) {
                        assert.ifError(err)
                        assert.ok(message, 'Message was not present')
                        assert.equal(message.properties.contentType, 'application/vnd+custom.contentType.v1')
                        assert.equal(message.content.toString(), JSON.stringify({ message: 'test message' }))
                        done()
                    })
                })
            })
        })
    })

    it('should publish buffer messages to normal exchanges', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'e1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', new Buffer('test message'), function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(messageId) {
                    amqputils.assertMessage('q1', namespace, 'test message', done)
                })
            })
        })
    })

    it('should allow publish overrides', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    queue: 'q1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', 'test message', { options: { expiration: 1 } }, function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(messageId) {
                    setTimeout(function() {
                        amqputils.assertMessageAbsent('q1', namespace, done)
                    }, 100)
                })
            })
        })
    })

    it('should report unrouted messages', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'xx'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)
            broker.publish('p1', 'test message', { options: { expiration: 1 } }, function(err, publication) {
                assert.ifError(err)
                publication.on('return', function(message) {
                    assert.ok(message)
                    done()
                })
            })
        })
    })

    it('should forward messages to publications', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'e1',
                    routingKey: 'rk1'
                },
                p2: {
                    exchange: 'e2',
                    routingKey: 'rk2'
                }
            },
            subscriptions: {
                s1: {
                    vhost: '/',
                    queue: 'q1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)

            var messageId

            broker.subscribe('s1', function(err, subscription) {
                assert.ifError(err)

                subscription.on('message', function(message, content, ackOrNack) {
                    broker.forward('p2', message, function(err, publication) {
                        publication.on('success', function() {
                            ackOrNack()

                            amqputils.getMessage('q2', namespace, function(err, message) {
                                assert.ifError(err)
                                assert.ok(message)
                                assert.equal(message.fields.routingKey, 'rk2')
                                assert.equal(message.properties.messageId, messageId)
                                assert.equal(message.properties.contentType, 'text/plain')
                                assert.equal(message.content.toString(), 'test message')
                                assert.ok(/\w+-\w+-\w+-\w+-\w+:q1/.test(message.properties.headers.rascal.originalQueue), format('%s failed to match expected pattern', message.properties.headers.rascal.originalQueue))
                                assert.equal(message.properties.headers.rascal.originalRoutingKey, 'rk1')
                                assert.equal(message.properties.headers.rascal.originalExchange, namespace + ':e1')
                                done()
                            })
                        })
                    })
                })
            })

            broker.publish('p1', 'test message', function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(_messageId) {
                    messageId = _messageId
                })
            })
        })
    })

    it('should forward messages to publications maintaining the original routing key when not overriden', function(done) {
        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    exchange: 'e1',
                    routingKey: 'rk1'
                },
                p2: {
                    exchange: 'e2'
                }
            },
            subscriptions: {
                s1: {
                    vhost: '/',
                    queue: 'q1'
                }
            }
        }, function(err, broker) {
            assert.ifError(err)

            var messageId

            broker.subscribe('s1', function(err, subscription) {
                assert.ifError(err)

                subscription.on('message', function(message, content, ackOrNack) {

                    broker.forward('p2', message, function(err, publication) {

                        publication.on('success', function() {
                            ackOrNack()

                            amqputils.getMessage('q2', namespace, function(err, message) {
                                assert.ifError(err)
                                assert.ok(message)
                                assert.equal(message.fields.routingKey, 'rk1')
                                done()
                            })
                        })
                    })
                })
            })

            broker.publish('p1', 'test message', function(err, publication) {
                assert.ifError(err)
                publication.on('success', function(_messageId) {
                    messageId = _messageId
                })
            })
        })
    })

    it('should publish lots of messages using normal channels', function(done) {

        this.timeout(10000)

        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    queue: 'q1',
                    confirm: false
                }
            }
        }, function(err, broker) {
            assert.ifError(err)

            async.timesSeries(1000, function(n, cb) {
                broker.publish('p1', 'test message', function(err, publication) {
                    assert.ifError(err)
                    publication.on('success', function(messageId) {
                        cb()
                    })
                })
            }, function(err) {
                assert.ifError(err)
                done()
            })
        })
    })

    it('should publish lots of messages using confirm channels', function(done) {

        this.timeout(20000)

        createBroker({
            vhosts: vhosts,
            publications: {
                p1: {
                    queue: 'q1',
                    confirm: true
                }
            }
        }, function(err, broker) {
            assert.ifError(err)

            async.timesSeries(1000, function(n, cb) {
                broker.publish('p1', 'test message', function(err, publication) {
                    assert.ifError(err)
                    publication.on('success', function(messageId) {
                        cb()
                    })
                })
            }, function(err) {
                assert.ifError(err)
                done()
            })
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