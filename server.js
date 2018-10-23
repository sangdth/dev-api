const jsonServer = require('json-server');
const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();
const googleCalendar = require('./google-calendar.js');

const db = router.db;

// it is recommended to use the bodyParser middleware before any other middleware in your application
server.use(jsonServer.bodyParser);

server.use(middlewares);

server.put('/slots/:id', (req, res) => {
  const edited = db.get('slots')
    .find({ id: req.params.id })
    .assign(req.body)
    .value();

  console.log(edited);
  googleCalendar.updateEvent(edited, (result) => {
    // console.log('result after update in server.js', result);
  });

  res.status(200).send({
    success: true,
    message: edited,
  });
});

// Need to call custom route before server.use(router)
// req here comes from Google API, it has rich headers
server.post('/notifications', (req, res) => {
  const allSlots = db.get('slots').value();
  // console.log('all slots', allSlots);

  // after this the hook() can use allSlots to compare
  // with list events
  googleCalendar.hook(req, (events) => {
    for (let i = 0, l = events.length; i < l; i++) {
      if (allSlots.find(slot => slot.id === events[i].id)) {
        db.get('slots').find({ id: events[i].id }).assign(events[i]).write();
      } else {
        db.get('slots').push(events[i]).write();
      }
    }
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
