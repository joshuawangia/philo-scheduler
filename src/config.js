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
    firstCensor: process.env.FIRST_CENSOR_SLACK_ID, // bootstraps the admin role
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },

  email: {
    smtpUrl: process.env.SMTP_URL, // e.g. smtps://user%40gmail.com:app-password@smtp.gmail.com:465; unset => log only
    from: process.env.EMAIL_FROM || 'Philo Interviews <no-reply@philomathean.org>',
    digestTo: process.env.DIGEST_TO || 'firstcensor@philomathean.org',
    digestHour: Number(process.env.DIGEST_HOUR ?? 8), // local hour the daily digest goes out
    urgentWindowHours: Number(process.env.URGENT_WINDOW_HOURS ?? 24), // changes this close to an interview email immediately
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
