import handler from './api/check-widgets.js';

console.log('Starting local widget check...');

const req = { method: 'GET' };

const res = {
  statusCode: 200,
  headers: {},
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader(key, value) {
    this.headers[key] = value;
  },
  json(payload) {
    this.body = payload;
    console.log('Response JSON:', JSON.stringify(payload, null, 2));
  }
};

handler(req, res)
  .then(() => {
    console.log('Handler completed.');
  })
  .catch(error => {
    console.error('Handler threw an error:', error);
  });

