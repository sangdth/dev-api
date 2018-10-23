const jsonServer = require('json-server');
const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();
const gcCalendars = require('./gc-calendars.js');
const gcEvents = require('./gc-events.js');
const Zet = require('zet');

const db = router.db;
const slotCalendarId = 'cognio.co_l3iti9228hclt7ej3d3q546kn8@group.calendar.google.com';

// it is recommended to use the bodyParser middleware before any other middleware in your application
server.use(jsonServer.bodyParser);

server.use(middlewares);


server.post('/slots', (req, res) => {

  gcEvents.createEvent(req.body, (result) => {
    const created = db.get('slots').push(result).write();

    res.status(200).send({
      success: true,
      message: 'created successfully',
    });
  });
});

server.put('/slots/:id', (req, res) => {
  const edited = db.get('slots')
    .find({ id: req.params.id })
    .assign(req.body)
    .value();

  gcEvents.updateEvent(edited, (result) => {
    res.status(200).send({
      success: true,
      message: edited,
      data: result,
    });
  });

});

// Need to call custom route before server.use(router)
// req here comes from Google API, it has rich headers
server.post('/notifications', (req, res) => {
  const allSlots = db.get('slots').value();
  // console.log('all slots', allSlots);

  // after this the hook() can use allSlots to compare
  // with list events
  if (req.query.calendar === slotCalendarId) {
    gcEvents.hook(req, (events) => {
      const zetSlots = new Zet(allSlots.map(s => s.id));
      const zetEvents = new Zet(events.map(e => e.id));

      // events in local, but not in GC
      const localItems = Array.from(zetSlots.difference(zetEvents));

      // events on GC, but on in local
      const remoteItems = Array.from(zetEvents.difference(zetSlots));

      // console.log(localItems, remoteItems);
      // download from GC to local
      // right now I just download directly, in future we need to 
      // run createSlot() with slot details
      if (remoteItems.length > 0) {
        for (let i = 0, l = remoteItems.length; i < l; i++) {
          console.log('Found new event, add to database');
          const foundIndex = events.findIndex(e => e.id === remoteItems[i]);
          db.get('slots').push(events[foundIndex]).write();
        }
      }

      // in case admin delete the remote event, there is no way to prevent it,
      // we have to use the localItems to create new events
      // then, remember, we can not use local id, so after create new event on GC
      // we need to delete all localItems with old id, and download the 
      // re-created events from GC.
    });
  }

  if (req.query.calendar === 'sang.dang@polku.io') {
    console.log('primary calendar changed');
    gcCalendars.hook(req, (calendars) => {
      console.log('calendars hook run');
      // from here we can get events from slot
    });
  }
});

/**
 * req below is come from user(postman, vue front end etc
 * it is not the same with hook
 */
server.post('/channels/create', (req, res) => {
  gcEvents.createChannel(req.body, (result) => {
    res.status(result.status).send({
      success: true,
      message: `Channel id ${req.body.id} was created successfully.`,
      data: result.data,
    });
  });
});

// closeChannel return empty result if successful
server.delete('/channels/close/:id', (req, res) => {
  gcEvents.closeChannel(req.params.id, (result) => {
    res.status(200).send({
      success: true,
      message: result,
    });
  });
});

server.use(router);
server.listen(3000, () => {
  console.log('JSON Server is running');
});
