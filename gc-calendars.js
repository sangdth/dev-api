const { google } = require('googleapis');

let resourceId = '';
let channelToken = '';
let events = [];

module.exports.listCalendars = (auth, callback) => {
  const calendar = google.calendar({ version: 'v3', auth });

  calendar.calendarList.list((err, res) => {
    if (err) return console.log(`The API returned an error: ${err}`);

    const calendars = res.data.items;

    /*
    if (calendars.length) {
      calendars.map((calendar) => {
        console.log(`${calendar.id} - ${calendar.summary}`);
      });
    } else {
      console.log('No calendar found.');
    }
    */

    callback(calendars);
  });
};

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
  // console.log('and token is', req.headers['x-goog-channel-token']);
};

