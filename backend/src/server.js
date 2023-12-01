const app = require('./app');

const TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || 3000;

app.listen(TEST_SERVER_PORT, () => {
  console.log(`Server running on port ${TEST_SERVER_PORT}`);
});
