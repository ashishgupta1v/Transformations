const Redis = require('ioredis');

// We need two Redis instances: one for publishing, one for subscribing
const publisher = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

publisher.on('error', (err) => console.error('Redis Publisher Error:', err));
subscriber.on('error', (err) => console.error('Redis Subscriber Error:', err));

module.exports = {
  publisher,
  subscriber
};
