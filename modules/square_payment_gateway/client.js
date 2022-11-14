const { ApiError, Client, Environment } = require('square');

const square_test_client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN_SANDBOX,
  environment: Environment.Sandbox,
});

const square_client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Production,
});

module.exports = {
  square_test_client,
  square_client
}