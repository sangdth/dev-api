const jsonServer = require('json-server');
const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();
const gcAuth = require('./gc-auth');
const gcCalendars = require('./gc-calendars.js');
const gcEvents = require('./gc-events.js');
const Zet = require('zet');

const db = router.db;

const slotCalendarId = 'cognio.co_l3iti9228hclt7ej3d3q546kn8@group.calendar.google.com';

// it is recommended to use the bodyParser middleware before any other middleware in your application
server.use(jsonServer.bodyParser);

server.use(middlewares);

// get auth for Google API
let auth;

gcAuth.init((result) => {
  auth = result;
// get calendar list, run once at beginning
// we can make refresh button in front, that call a trigger here later
  gcCalendars.listCalendars(auth, (calendars) => {
    db.set('calendars', calendars).write();
  });
});

const cMap = db.get('calendarMapping').value();


server.post('/slots', (req, res) => {
  gcEvents.createEvent(req.body, auth, (result) => {
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

  gcEvents.updateEvent(edited, auth, (result) => {
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

  const allEvents = db.get('events').value();
  // console.log('all slots', allSlots);

  gcEvents.listEventsByCalendarId(req.query.calendar, auth, (events) => {
    console.log('$$$$$$ calendarId from req', req.query.calendar);
    const calendarId = req.query.calendar.toString();
    const calendarName = getKeyByValue(cMap, calendarId);
    
    if (events.length > 0) {
      db.set(`events[${calendarName}]`, events).write();
    }
  });

  if (req.query.calendar === cMap['primary']) {
    console.log('### Primary calendar changed');
    // we use this to trigger the slot calculations
  }

  if (req.query.calendar === cMap['resources']) {
    console.log('### Resources calendar changed');
    // we use this to trigger the slot calculations
  }

  if (req.query.calendar === cMap['typeOne']) {
    console.log('### typeOne calendar changed');
    // we use this to trigger the slot calculations
  }

  if (req.query.calendar === cMap['typeTwo']) {
    console.log('### typeTwo calendar changed');
    // we use this to trigger the slot calculations
  }

  // after this the hook() can use allSlots to compare
  // with list events
  if (req.query.calendar === cMap['slots']) {
    console.log('### slot calendar changed');

  }

});

/**
 * req below is come from user: postman, vue front end etc
 * it is not the same with hook
 */
server.post('/channels/create', (req, res) => {
  gcEvents.createChannel(req.body, auth, (result) => {
    res.status(result.status).send({
      success: true,
      message: `Channel id ${req.body.id} was created successfully.`,
      data: result.data,
    });
  });
});

// closeChannel return empty result if successful
server.delete('/channels/close/:id', (req, res) => {
  gcEvents.closeChannel(req.params.id, auth, (result) => {
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


function getKeyByValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}
/*
     * do compare later, now just write directly into database
    const zetSlots = new Zet(allEvents.map(s => s.id));
    const zetEvents = new Zet(events.map(e => e.id));

    // events in local, but not in GC
    const localItems = Array.from(zetSlots.difference(zetEvents));

    // events on GC, but on in local
    const remoteItems = Array.from(zetEvents.difference(zetSlots));
      for (let i = 0, l = remoteItems.length; i < l; i++) {
        console.log('Found new event, add to database');
        const foundIndex = events.findIndex(e => e.id === remoteItems[i]);
        db.get('events').push(events[foundIndex]).write();
      }
    // in case admin delete the remote event, there is no way to prevent it,
    // we have to use the localItems to create new events
    // then, remember, we can not use local id, so after create new event on GC
    // we need to delete all localItems with old id, and download the 
    // re-created events from GC.
    */

    

