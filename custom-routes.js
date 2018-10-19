module.exports = function(server) {
  // Add custom routes before server.use(router)
  server.get('/echo/:sth', (req, res) => {
    res.jsonp(req.params.sth);
  });

  server.get('/get-gc-events', (req, res) => {
  
  });
};
