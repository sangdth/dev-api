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
  const db = router.db;
  const allSlots = db.get('slots').value();
  console.log('all slots', allSlots);

  // after this the hook() can use allSlots to compare
  // with list events
  googleCalendar.hook(req, (result) => {
    res.status(result.status).send({
      success: true,
      message: 'Received and processed successfully!',
      data: result.data,
    });
  });
});

/**
 * req below is come from user(postman, vue front end etc
 * it is not the same with hook
 */
server.post('/channels/create', (req, res) => {
  googleCalendar.createChannel(req.body.id, (result) => {
    res.status(result.status).send({
      success: true,
      message: `Channel id ${req.body.id} was created successfully.`,
      data: result.data,
    });
  });
});

// closeChannel return empty result if successful
server.delete('/channels/close/:id', (req, res) => {
  googleCalendar.closeChannel(req.params.id, (result) => {
    res.status(200).send({
      success: true,
      message: 'Channel closed successfully',
      data: result,
    });
  });
});

server.use(router);
server.listen(3000, () => {
  console.log('JSON Server is running');
});
