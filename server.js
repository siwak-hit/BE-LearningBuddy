const app = require('./src/app');
const env = require('./src/config/env');

app.listen(env.PORT, () => {
  console.log(`AI Learning Buddy API running on port ${env.PORT}`);
});
