const jsonServer = require('json-server');
const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();
const googleCalendar = require('./google-calendar.js');

// it is recommended to use the bodyParser middleware before any other middleware in your application
server.use(jsonServer.bodyParser);

server.use(middlewares);

// Need to call custom route before server.use(router)
server.get('/trigger', (req, res) => {
  googleCalendar.trigger(req, res);
  //res.status(200).send({ data: 'test successfully' });
});

// Need to call custom route before server.use(router)
server.post('/notifications', (req, res) => {
  // console.log('post notification', req.body)
  googleCalendar.hook(req, res);
  /*
  update('/slots', find event_id with slot_id) time user info
  can not find, create new slot
  */
  //res.status(200).send({ data: 'test successfully' });
});

server.use(router);
server.listen(3000, () => {
  console.log('JSON Server is running');
});
