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
const shortid = require('shortid')

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

// create new booking

server.post('/bookings', (req, res) => {
  const bookingItem = {
    id: `booking-id-${shortid.generate()}`,
    start: { timestamp: req.body.slot.start.timestamp, },
    end: { timestamp: req.body.slot.end.timestamp, },
    status: 'confirmed', // confirmed, overdue, cancelled
    slot: req.body.slot,
    customer: req.body.customer,
  };

  db.get('bookings')
    .push(bookingItem)
    .write();

  db.get('slots.typeOne')
    .find({ id: req.body.slot.id })
    .assign({ status: 1 })
    .write();

  res.status(200).send({
    success: true,
    message: db.get('bookings').find({ id: bookingItem.id }).value(),
  });
});

// query slots events
server.get('/slots', (req, res) => {
  const min = req.query.from;
  const max = req.query.to;
  const typeName = req.query.type;

  let slots = [];

  if (min && max) {
    slots = db.get(`slots[${typeName}]`)
      .filter(slot => {
        // Google events use RFC 3339 time format
        // we need to convert back to milliseconds to compare
        // const slotStart = moment(slot.start.dateTime).format('x');
        // const slotEnd = moment(slot.end.dateTime).format('x');

        // if (min < slotStart && slotEnd < max) {
        if (min < slot.start.timestamp && slot.end.timestamp < max) {
          console.log('----- query min: ', moment.unix(min / 1000).format('dddd HH:mm DD.MM.YYYY'));
          console.log(slot.summary);
          return slot;
        }
      })
      .value();
  } else {
    // do more if check
    slots = db.get(`slots[${typeName}]`).value();
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
    const summaryPrimary = allEvents['primary'][i].summary;
    const eventIdPrimary = allEvents['primary'][i].id;

    let min = minPrimary;
    let max = maxPrimary;

    // console.log('start min, start max', min, max);

    for (let j = 0; j < allEvents['resources'].length; j++) {
      const minResource = toMilli(allEvents['resources'][j].start.dateTime);
      const maxResource = toMilli(allEvents['resources'][j].end.dateTime);
      const summaryResources = allEvents['resources'][j].summary;
      const eventIdResources = allEvents['resources'][j].id;
      // console.log('minResource, maxResource', minResource, maxResource);

      if (_.inRange(minResource, min, max)) {
        min = minResource;
      } else if (minResource < min) {
        min = min;
      } else {
        min = 0;
      }

      if (_.inRange(maxResource, min, max)) {
        max = maxResource;
      }

      for (let m = 0; m < allEvents['typeOne'].length; m++) {
        const minTypeOne = toMilli(allEvents['typeOne'][m].start.dateTime);
        const maxTypeOne = toMilli(allEvents['typeOne'][m].end.dateTime);
        // console.log('minTypeOne', 'maxTypeOne', minTypeOne, maxTypeOne);

        if ((min !== 0 && max !==0) && _.inRange(minTypeOne, min, max)) {
          min = minTypeOne;
        } else if (minTypeOne < min) {
          min = min;
        } else {
          min = 0;
        }

        if ((min !== 0 && max !==0) && _.inRange(maxTypeOne, min, max)) {
          max = maxTypeOne;
        }

        if (min !== 0 && max !== 0 && max - min >= 1800000) {
          typeOneSlots.push({
            min,
            max,
            primary: { summary: summaryPrimary, id: eventIdPrimary },
            resources: { summary: summaryResources, id: eventIdResources },
          });
        }
      }

      /*
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
        } else if (maxTypeTwo >= maxResource) {
          max = maxResource;
        } else {
          max =0;
        }

        if (min !== 0 && max !== 0 && max - min >= 3600000) {
          typeTwoSlots.push({ min, max });
        }
      }
      */

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

    // if existSlots is not empty, try to delete free slots
    if (existSlots.length !== 0) {
      db.get('slots.typeOne')
        .remove({ status: 0 })
        .write();
    }
    console.log('min: ', moment.unix(typeOneSlots[i].min / 1000).format('dddd HH:mm DD.MM.YYYY'));
    // then create new slots
    const duration = typeOneSlots[i].max - typeOneSlots[i].min;
    const nSlots = Math.floor(duration / 1800000); // 30 mins
    console.log('number of slot', nSlots);

    for (let j = 0; j < nSlots; j++) {
      // console.log(
      //   `item ${j}`, moment.unix(typeOneSlots[i].min/1000).format('dddd HH:mm'),
      //   moment.unix(typeOneSlots[i].max/1000).format('HH:mm DD.MM.YYYY')
      // );
      const startTime = parseInt(typeOneSlots[i].min, 10) + j * 1800000;
      const endTime = parseInt(typeOneSlots[i].min, 10) + (j + 1) * 1800000;
      // WHY THE FUCK THIS SHIT DOES NOT CREATE SLOT
      // FOR TODAY ???????
      // FUCK FUCK FUCK FUCK
      const slotItem = {
        summary: moment(startTime).format('HH:mm') + ' - ' + moment(endTime).format('HH:mm'),
        id: `slot-id-${shortid.generate()}`,
        start: { timestamp: startTime, },
        end: { timestamp: endTime, },
        status: 0, // 0 is free, 1 is booked, 2 is locked
        calendar: {
          type: 'google-calendar',
          calendarId: cMap['typeOne'],
          calendarName: 'typeOne',
        },
        primary: typeOneSlots[i].primary,
        resources: typeOneSlots[i].resources,
      };

      db.get('slots.typeOne')
        .push(slotItem)
        .write();
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

