const jsonServer = require('json-server');
const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();
const gcAuth = require('./gc-auth');
const gcCalendars = require('./gc-calendars.js');
const gcEvents = require('./gc-events.js');
const Zet = require('zet');
const moment = require('moment');
const _ = require('lodash');

const db = router.db;

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

// query slots events
server.get('/slots', (req, res) => {
  const min = req.query.from;
  const max = req.query.to;
  let slots = [];
  console.log('tyepadsf', typeof min);
  if (min && max) {
    slots = db.get('events.slots')
      .filter(slot => {
        // Google events use RFC 3339 time format
        // we need to convert back to milliseconds to compare
        const slotStart = moment(slot.start.dateTime).format('x');
        const slotEnd = moment(slot.end.dateTime).format('x');

        if (min < slotStart && slotEnd < max) {
          return slot;
        }
      })
      .value();
  } else {
    // do more if check
    slots = db.get('events.slots').value();
  }

  res.status(200).send({
    success: true,
    message: slots,
  });
});

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
  let calendarId;

  if (req.query.calendar) {
    calendarId = req.query.calendar.toString();
  } else {
    calendarId = cMap['primary'];
  }

  const calendarName = getKeyByValue(cMap, calendarId);

  gcEvents.queryEventsByCalendarId(calendarId, auth, (events) => {
    console.log('Receive notification, get data from calendar named: ', calendarName);
    db.set(`events[${calendarName}]`, events).write();
  });

  const allEvents = db.get('events').value();

  let typeOneSlots = [];
  let typeTwoSlots = [];

  for (let i = 0; i < allEvents['primary'].length; i++) {
    let min = toMilli(allEvents['primary'][i].start.dateTime);
    let max = toMilli(allEvents['primary'][i].end.dateTime);

    for (let j = 0; j < allEvents['resources'].length; j++) {
      const minResource = toMilli(allEvents['resources'][j].start.dateTime);
      const maxResource = toMilli(allEvents['resources'][j].end.dateTime);

      if (_.inRange(minResource, min, max)) {
        min = minResource;
      }
      if (_.inRange(maxResource, min, max)) {
        max = maxResource;
      }

      for (let m = 0; m < allEvents['typeOne'].length; m++) {
        const minTypeOne = toMilli(allEvents['typeOne'][j].start.dateTime);
        const maxTypeOne = toMilli(allEvents['typeOne'][j].end.dateTime);

        if (_.inRange(minTypeOne, min, max)) {
          min = minTypeOne;
        }
        if (_.inRange(maxTypeOne, min, max)) {
          max = maxTypeOne;
        }

        typeOneSlots.push({min, max});
      }

      /*
      for (let n = 0; n < allEvents['typeTwo'].length; n++) {
        if (min < toMilli(allEvents['typeTwo'][n].start.dateTime)) {
          min = toMilli(allEvents['typeTwo'][n].start.dateTime);
        }
        if (max > toMilli(allEvents['typeTwo'][n].end.dateTime)) {
          max = toMilli(allEvents['typeTwo'][n].end.dateTime);
        }
        typeTwoSlots = addToSlotsArray(typeTwoSlots, { min, max });
      }
      */
    }
  }
  console.log('typeOne range: ', typeOneSlots);

  if (req.query.calendar === cMap[calendarName]) {
    console.log(`### incoming signal from ${calendarName}`);
    // console.log('channel ID: ', req.headers['x-goog-channel-id']);
    // console.log('resource ID:', req.headers['x-goog-resource-id']);
    // console.log('token is', req.headers['x-goog-channel-token']);
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
      // message: `Channel id ${req.body.id} was created successfully.`,
      message: result.data,
    });
  });
});

// closeChannel return empty result if successful
server.delete('/channels/close/:id', (req, res) => {
  gcEvents.closeChannel(req.params.id, auth, (result) => {
    res.status(200).send({
      success: true,
      message: `Channel id ${req.params.id} was closed successfully.`,
    });
  });
});

server.use(router);
server.listen(3000, () => {
  console.log('Demo server is running');
});


function getKeyByValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}

function toMilli(date) {
  return parseInt(moment(date).format('x'), 10);
}

/*
 * old code, save for study
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

