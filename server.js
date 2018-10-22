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
// req here comes from Google API, it has rich headers
server.post('/notifications', (req, res) => {
  googleCalendar.hook(req, res, (error, data) => {
    // if (error) throw error;
    console.log(req);

    if (data) {
      res.status(data.status).send({ data });
    }
  });
});

/**
 * req below is come from user(postman, vue front end etc
 * it is not the same with hook
 */
server.post('/channels/create', (req, res) => {
  googleCalendar.createChannel(req.body.id);
});

server.delete('/channels/close/:id', (req, res) => {
  googleCalendar.closeChannel(req.params.id);
});

server.use(router);
server.listen(3000, () => {
  console.log('JSON Server is running');
});
