// All configuration comes from environment variables (see .env.example).
function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  timezone: process.env.TIMEZONE || 'America/New_York',
  dbPath: process.env.DB_PATH || 'data/philo.db',
  secret: process.env.SESSION_SECRET || '',

  slack: {
    botToken: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN, // set => Socket Mode (handy for local dev)
    notifyChannel: process.env.SLACK_NOTIFY_CHANNEL, // optional channel id for booking notices
    firstCensor: process.env.FIRST_CENSOR_SLACK_ID, // bootstraps the admin role
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
};

export function validateConfig() {
  required('SESSION_SECRET');
  required('SLACK_BOT_TOKEN');
  if (!config.slack.appToken) required('SLACK_SIGNING_SECRET');
  required('GOOGLE_CLIENT_ID');
  required('GOOGLE_CLIENT_SECRET');
  if (config.secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
}
