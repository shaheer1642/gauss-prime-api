const { ApiError, Client, Environment } = require('square');

const square_test_client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Sandbox,
});

module.exports = square_test_client