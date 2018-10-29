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
    slots = db.get('slots').value();
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

  if (req.query.calendar === cMap[calendarName]) {
    console.log(`### incoming signal from ${calendarName}`);
    // console.log('channel ID: ', req.headers['x-goog-channel-id']);
    // console.log('resource ID:', req.headers['x-goog-resource-id']);
    // console.log('token is', req.headers['x-goog-channel-token']);
  }

  gcEvents.queryEventsByCalendarId(calendarId, auth, (events) => {
    console.log('Got data from calendar named: ', calendarName);
    db.set(`events[${calendarName}]`, events).write();
  });


  // try to calculate the slot ranges
  const allEvents = db.get('events').value();

  let typeOneSlots = [];
  let typeTwoSlots = [];

  for (let i = 0; i < allEvents['primary'].length; i++) {
    const minPrimary = toMilli(allEvents['primary'][i].start.dateTime);
    const maxPrimary = toMilli(allEvents['primary'][i].end.dateTime);
    let min = minPrimary;
    let max = maxPrimary;
    // console.log('start min, start max', min, max);

    for (let j = 0; j < allEvents['resources'].length; j++) {
      const minResource = toMilli(allEvents['resources'][j].start.dateTime);
      const maxResource = toMilli(allEvents['resources'][j].end.dateTime);
      // console.log('minResource, maxResource', minResource, maxResource);

      if (_.inRange(minResource, minPrimary, maxPrimary)) {
        min = minResource;
      } else if (minResource < minPrimary) {
        min = minPrimary;
      } else {
        min = 0;
      }

      if (_.inRange(maxResource, minPrimary, maxPrimary)) {
        max = maxResource;
      } else if (maxResource > maxPrimary) {
        max = maxPrimary;
      } else {
        max = 0;
      }

      for (let m = 0; m < allEvents['typeOne'].length; m++) {
        const minTypeOne = toMilli(allEvents['typeOne'][m].start.dateTime);
        const maxTypeOne = toMilli(allEvents['typeOne'][m].end.dateTime);
        // console.log('minTypeOne', 'maxTypeOne', minTypeOne, maxTypeOne);

        if (_.inRange(minTypeOne, minResource, maxResource)) {
          min = minTypeOne;
        } else if (minTypeOne < minResource) {
          min = minResource;
        } else {
          min = 0;
        }

        if (_.inRange(maxTypeOne, minResource, maxResource)) {
          max = maxTypeOne;
        } else if (maxTypeOne > maxResource) {
          max = maxResource;
        } else {
          max =0;
        }

        if (min !== 0 && max !== 0) {
          typeOneSlots.push({ min, max });
        }
      }


      for (let n = 0; n < allEvents['typeTwo'].length; n++) {
        const minTypeTwo = toMilli(allEvents['typeTwo'][n].start.dateTime);
        const maxTypeTwo = toMilli(allEvents['typeTwo'][n].end.dateTime);

        if (_.inRange(minTypeTwo, minResource, maxResource)) {
          min = minTypeTwo;
        } else if (minTypeTwo < minResource) {
          min = minResource;
        } else {
          min = 0;
        }

        if (_.inRange(maxTypeTwo, minResource, maxResource)) {
          max = maxTypeTwo;
        } else if (maxTypeTwo > maxResource) {
          max = maxResource;
        } else {
          max =0;
        }

        if (min !== 0 && max !== 0) {
          typeTwoSlots.push({min, max});
        }
      }

    }
  }

  // console.log(typeOneSlots);
  // get slots from our db first

  for (let i = 0; i < typeOneSlots.length; i++) {
    const existSlots = db.get('slots.typeOne')
      .filter(slot => {
        if (typeOneSlots[i].min <= slot.start.timestamp &&
            typeOneSlots[i].max >= slot.end.timestamp) {
          return slot;
        }
      })
      .value();

    // if found existSlots, try to sync data with slots on GC.

    // if existSlots is empty, try to create new slots
    if (existSlots.length === 0) {
      const duration = typeOneSlots[i].max - typeOneSlots[i].min;
      const nSlots = Math.floor(duration / 1800000); // 30 minsa
      console.log('number of slot', nSlots);

      for (let j = 0; j < nSlots; j++) {
        const slotItem = {
          slotId: `slot-id-123-abc-${i}-${j}`,
          start: { timestamp: parseInt(typeOneSlots[i].min, 10) + j * 1800000 },
          end: { timestamp: parseInt(typeOneSlots[i].min, 10) + (j + 1) * 1800000 },
          status: 0,
          calendar: {
            type: 'google-calendar',
            calendarId: cMap['typeOne'],
          },
        };

        db.get('slots.typeOne')
          .push(slotItem)
          .write();
      }
    } else {
      console.log('found exist slot, need to sync', existSlots.length);
    }
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
  return moment(date).format('x');
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

