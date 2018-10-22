const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

let auth;

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
 * Lists the next 10 events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listEvents(client) {
  auth = client;
  // const appRes = res;
  const calendar = google.calendar({ version: 'v3', auth });
  calendar.events.list({
    calendarId: 'primary',
    timeMin: (new Date()).toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  }, (err, res) => {
    // if (err) return console.log(`The API returned an error: ${err}`);
    const events = res.data.items;
    if (events.length) {
      console.log('Upcoming 20 events:');
      events.map((event, i) => {
        const start = event.start.dateTime || event.start.date;
        console.log(`${start} - ${event.summary}`);
        // console.log(JSON.stringify(event));
      });
    } else {
      console.log('No upcoming events found.');
    }
    // try to run the watching right after listing
    // to make sure I have authed creds :D

    // appRes.status(200).send({ events });
  });
}

function compareWithSlots() {

}

module.exports.hook = (req, res, callback) => {
  // from here we can do something, let's say anytime google push us notification,
  // we try to list all current events
  // everything userful from Google API is sent in req.headers
  console.log('received notification from Google, start listing events');
  console.log(req.headers);
  // listEvents(auth);
};

/**
 * Try to watch a collection of events this should run only once
 * after that, we must regenerate new id
 * also we need to store the id in order to close this channel in future
 */
module.exports.createChannel = (id) => {
  const calendar = google.calendar({ version: 'v3', auth });
  calendar.events.watch({ // post method
    auth,
    calendarId: 'primary',
    resource: {
      id: id,
      type: 'web_hook',
      address: `https://super.eu.ngrok.io/notifications?id=${id}`,
    },
  }, (error, response) => {
    if (error) console.log('error after create', error.message);
    console.log(response);
  });
};

/**
 * Close a watch channel
 */
module.exports.closeChannel = (channelId, resourceId) => {
  console.log('start running close channel');
  const calendar = google.calendar({ version: 'v3', auth });
  calendar.channels.stop({ // post method
    auth,
    calendarId: 'primary',
    resource: {
      id: channelId,
      channelId: channelId,
      resourceId, resourceId,
    },
  }, (error, response) => {
    if (error) {
      console.log(error);
    }
    console.log(response.status);
  });
};

