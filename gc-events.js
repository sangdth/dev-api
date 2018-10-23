const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const slotCalendarId = 'cognio.co_l3iti9228hclt7ej3d3q546kn8@group.calendar.google.com';

let auth;
let resourceId = '';
let channelToken = '';
let events = [];
let slotEvents = [];

// If modifying these scopes, delete token.json.
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];
const TOKEN_PATH = 'token.json';

// console.log('I can get req here', req);
// console.log('I can get also res here', res.status);
// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Google Calendar API.
  authorize(JSON.parse(content), listEvents);
  // authorize(JSON.parse(content), pushNotifications);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */

function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    auth = oAuth2Client;
    console.log('authorize always run');
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Lists the next 20 events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listEvents(client) {
  auth = client;
  const calendar = google.calendar({ version: 'v3', auth });
  calendar.events.list({
    calendarId: 'primary',
    timeMin: (new Date()).toISOString(),
    maxResults: 20,
    singleEvents: true,
    orderBy: 'startTime',
  }, (err, res) => {
    // if (err) return console.log(`The API returned an error: ${err}`);
    events = res.data.items;
    if (events.length) {
      console.log('Upcoming 20 events:');
      events.map((event) => {
        const start = event.start.dateTime || event.start.date;
        console.log(`${start} - ${event.summary}`);
      });
    } else {
      console.log('No upcoming events found.');
    }
  });
}

function listEventsByCalendar(calendarId) {
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
/**
 * This is where GC send back data and we use it to keep our 
 * database up to date with GC.
 */
module.exports.hook = (req, callback) => {
  // from here we can do something, let's say anytime google push us notification,
  // we try to list all current events
  // everything userful from Google API is sent in req.headers
  resourceId = req.headers['x-goog-resource-id'];
  channelToken = req.headers['x-goog-channel-token'];
  console.log('received signal from Google');
  console.log('listen on channel ID: ', req.headers['x-goog-channel-id']);
  // console.log('and resource ID is:', req.headers['x-goog-resource-id']);

  listEventsByCalendar(req.query.calendar);
  callback(events);
  // listEvents(auth);
};

/**
 * Create new event into GC if we create new slots.
 */
module.exports.createEvent = (newEvent, callback) => {
  listEvents(auth);
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
module.exports.updateEvent = (editedEvent, callback) => {
  listEvents(auth);
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
module.exports.createChannel = (data, callback) => {
  console.log('data in createChannel', data);
  const calendar = google.calendar({ version: 'v3', auth });
  calendar.events.watch({ // post method
    // auth,
    calendarId: data.calendarId,
    resource: {
      id: data.channelId,
      type: 'web_hook',
      token: 'polku-token-' + data.channelId,
      address: `https://super.eu.ngrok.io/notifications?channel=${data.channelId}&calendar=${data.calendarId}`,
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
module.exports.closeChannel = (id, callback) => {
  const calendar = google.calendar({ version: 'v3', auth });
  calendar.channels.stop({
    auth,
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

