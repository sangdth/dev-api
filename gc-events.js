const { google } = require('googleapis');
const moment = require('moment');
const slotCalendarId = 'cognio.co_l3iti9228hclt7ej3d3q546kn8@group.calendar.google.com';

let resourceId = '';
let channelToken = '';
let events = [];
let slotEvents = [];

/**
 * Lists the next 20 events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */

function listEventsByCalendar(calendarId, auth) {
  const calendar = google.calendar({ version: 'v3', auth });

  calendar.events.list({
    calendarId,
    timeMin: (new Date()).toISOString(),
    maxResults: 20,
    singleEvents: true,
    orderBy: 'startTime',
  }, (err, res) => {
    // if (err) return console.log(`The API returned an error: ${err}`);
    slotEvents = res.data.items;
    if (slotEvents.length) {
      console.log('Upcoming 20 events:');
      slotEvents.map((event) => {
        const start = event.start.dateTime || event.start.date;
        console.log(`${start} - ${event.summary}`);
      });
    } else {
      console.log('No upcoming events found.');
    }
  });
}

module.exports.queryEventsByCalendarId = (calendarId, auth, callback) => {
  const calendar = google.calendar({ version: 'v3', auth });
  const  beginOfDay = moment().startOf('day').format();

  console.log(beginOfDay);
  calendar.events.list({
    calendarId,
    timeMin: beginOfDay,
    maxResults: 1000,
    singleEvents: true,
    orderBy: 'startTime',
  }, (err, res) => {
    if (err) throw err;
    const events = res.data.items;
    callback(events);
  });
};

/**
 * This is where GC send back data and we use it to keep our 
 * database up to date with GC.
 */
module.exports.hook = (req, auth, callback) => {
  // from here we can do something, let's say anytime google push us notification,
  // we try to list all current events
  // everything userful from Google API is sent in req.headers
  resourceId = req.headers['x-goog-resource-id'];
  channelToken = req.headers['x-goog-channel-token'];
  console.log('received signal from Google');
  console.log('listen on channel ID: ', req.headers['x-goog-channel-id']);
  // console.log('and resource ID is:', req.headers['x-goog-resource-id']);

  listEventsByCalendar(req.query.calendar, auth);
  callback(events);
  // listEvents(auth);
};

/**
 * Create new event into GC if we create new slots.
 */
module.exports.createEvent = (newEvent, auth, callback) => {
  const calendar = google.calendar({ version: 'v3', auth });

  calendar.events.insert({
    // calendarId: 'primary',
    calendarId: slotCalendarId,
    resource: {
      summary: newEvent.summary,
      start: newEvent.start,
      end: newEvent.end,
      colorId: newEvent.colorId,
    },
  }, (err, res) => {
    if (err) return err;
    // res will be the created event
    callback(res.data);
  });
};


/**
 * We update the event in GC everytime we change something in our database.
 */
module.exports.updateEvent = (editedEvent, auth, callback) => {
  const calendar = google.calendar({ version: 'v3', auth });

  calendar.events.update({
    // calendarId: 'primary',
    calendarId: slotCalendarId,
    eventId: editedEvent.id,
    resource: {
      summary: editedEvent.summary,
      start: editedEvent.start,
      end: editedEvent.end,
      colorId: editedEvent.colorId,
    },
  }, (err, res) => {
    if (err) return err;
    // res will be the updated event
    callback(res.data);
  });
};

/**
 * Try to watch a collection of events this should run only once
 * after that, we must regenerate new id
 * also we need to store the id in order to close this channel in future
 */
module.exports.createChannel = (data, auth, callback) => {
  console.log('data in createChannel', data);
  const calendar = google.calendar({ version: 'v3', auth });
  calendar.events.watch({ // post method
    calendarId: data.calendarId,
    resource: {
      id: data.channelId,
      type: 'web_hook',
      token: 'polku-token-' + data.channelId,
      // address: `https://super.eu.ngrok.io/notifications?channel=${data.channelId}&calendar=${data.calendarId}`,
      address: `https://${data.verifiedDomain}/notifications?channel=${data.channelId}&calendar=${data.calendarId}`,
    },
  }, (error, res) => {
    if (error) throw error;
    if (res) callback(res);
  });
};

/**
 * Close a watch channel
 * Note that we get resource ID (required) from the hook.
 * There are two way to get it: In headers request comes from Google API
 * or we can store it into our localStorage, database etc.
 */
module.exports.closeChannel = (id, auth, callback) => {
  const calendar = google.calendar({ version: 'v3', auth });
  calendar.channels.stop({
    resource: {
      id,
      resourceId,
      token: channelToken,
    },
  }, (error, result) => {
    if (error) throw error;
    if (result) callback('Close successfully!');
  });
};

