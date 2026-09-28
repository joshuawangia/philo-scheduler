import { config } from './config.js';
import * as db from './db.js';
import * as scheduler from './scheduler.js';
import { sign } from './crypto.js';

// Applicant-supplied text must not be able to @channel or inject links in Slack.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const applicant = (iv) => esc(iv.applicant_name).slice(0, 120);

// Returns an error message, or null if the philo was disconnected.
function tryDisconnect(userId) {
  const n = db.organizedUpcoming(userId);
  if (n) return `You own the calendar invite for ${n} upcoming interview${n > 1 ? 's' : ''}. Ask the First Censor to reassign ${n > 1 ? 'them' : 'it'} first, then disconnect.`;
  db.disconnectMember(userId);
  scheduler.invalidate();
  return null;
}

const fmt = (d) => scheduler.formatTime(d, "ccc LLL d, h:mm a");
const mentions = (ids) => ids.map((id) => `<@${id}>`).join(', ') || '_nobody_';
const md = (text) => ({ type: 'section', text: { type: 'mrkdwn', text } });
const divider = { type: 'divider' };
const header = (text) => ({ type: 'header', text: { type: 'plain_text', text } });

async function connectLink(client, userId) {
  let name = null;
  try {
    const { user } = await client.users.info({ user: userId });
    name = user.real_name || user.name;
  } catch {}
  return `${config.baseUrl}/connect?s=${sign({ slackId: userId, name }, 24 * 3600)}`;
}

function settingsSummary(s) {
  const window = s.window_start ? `${s.window_start} → ${s.window_end}` : '_not set_';
  return [
    `*Booking:* ${s.booking_open === '1' ? 'open' : 'closed'}   *Window:* ${window}`,
    `*Daily hours:* ${s.day_start}–${s.day_end}   *Length:* ${s.slot_minutes} min, starting every ${s.step_minutes} min   *Philos per interview:* ${s.interviewers_per_slot}`,
    `*Location:* ${s.location}`,
  ].join('\n');
}

function interviewBlock(iv, withControls) {
  const block = md(`*${fmt(iv.start_utc)}* — ${applicant(iv)} (${esc(iv.applicant_email)})\nWith ${mentions(iv.interviewers)}`);
  if (withControls) {
    return [
      block,
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Edit' }, action_id: 'iv_edit', value: String(iv.id) },
          {
            type: 'button', text: { type: 'plain_text', text: 'Cancel' }, style: 'danger', action_id: 'iv_cancel', value: String(iv.id),
            confirm: {
              title: { type: 'plain_text', text: 'Cancel interview?' },
              text: { type: 'mrkdwn', text: `This cancels ${applicant(iv).slice(0, 80)}'s interview and emails everyone.` },
              confirm: { type: 'plain_text', text: 'Cancel it' }, deny: { type: 'plain_text', text: 'Keep' },
            },
          },
        ],
      },
    ];
  }
  return [block];
}

export async function publishHome(client, userId) {
  const member = db.getMember(userId);
  const censor = db.isFirstCensor(userId);
  const blocks = [header('Philomathean Interviews')];

  if (member?.refresh_token) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:white_check_mark: Google Calendar connected (${member.email}). Applicants only see times when you're free.` },
      accessory: { type: 'button', text: { type: 'plain_text', text: 'Disconnect' }, action_id: 'gcal_disconnect' },
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: 'Connect your Google Calendar so you can be scheduled for interviews. We only read free/busy — never event details.' },
      accessory: { type: 'button', text: { type: 'plain_text', text: 'Connect Google Calendar' }, style: 'primary', url: await connectLink(client, userId), action_id: 'gcal_connect' },
    });
  }
  blocks.push(md(`Applicant sign-up page: ${config.baseUrl}`));

  const mine = db.upcomingInterviews({ slackId: userId });
  blocks.push(divider, md('*Your upcoming interviews*'));
  if (!mine.length) blocks.push(md('_None yet._'));
  for (const iv of mine.slice(0, 15)) blocks.push(...interviewBlock(iv, false));

  if (censor) {
    const s = db.getSettings();
    const all = db.upcomingInterviews();
    const philos = db.connectedMembers();
    blocks.push(divider, header('First Censor'));
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: settingsSummary(s) },
      accessory: { type: 'button', text: { type: 'plain_text', text: 'Edit settings' }, action_id: 'open_settings' },
    });
    blocks.push(md(`*Connected philos (${philos.length}):* ${mentions(philos.map((p) => p.slack_id))}`));
    blocks.push(md(`*All upcoming interviews (${all.length})*`));
    if (!all.length) blocks.push(md('_None yet._'));
    const max = 30; // Slack caps a Home tab at 100 blocks
    for (const iv of all.slice(0, max)) blocks.push(...interviewBlock(iv, true));
    if (all.length > max) blocks.push(md(`_…and ${all.length - max} more. Use \`/philo list\` to see everything._`));
  }

  await client.views.publish({ user_id: userId, view: { type: 'home', blocks } });
}

const option = (text, value) => ({ text: { type: 'plain_text', text }, value: String(value) });

function settingsModal(s) {
  const opt = (v, suffix = '') => option(`${v}${suffix}`, v);
  const input = (block_id, label, element, optional = false) => ({ type: 'input', block_id, optional, label: { type: 'plain_text', text: label }, element: { action_id: 'v', ...element } });
  const withInitial = (el, key, val) => (val ? { ...el, [key]: val } : el);
  return {
    type: 'modal',
    callback_id: 'settings_submit',
    title: { type: 'plain_text', text: 'Interview settings' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks: [
      input('booking_open', 'Applicant sign-ups', {
        type: 'checkboxes', options: [option('Open for booking', '1')],
        ...(s.booking_open === '1' ? { initial_options: [option('Open for booking', '1')] } : {}),
      }, true),
      input('window_start', 'First interview day', withInitial({ type: 'datepicker' }, 'initial_date', s.window_start)),
      input('window_end', 'Last interview day', withInitial({ type: 'datepicker' }, 'initial_date', s.window_end)),
      input('day_start', 'Earliest start each day', { type: 'timepicker', initial_time: s.day_start }),
      input('day_end', 'Latest end each day', { type: 'timepicker', initial_time: s.day_end }),
      input('slot_minutes', 'Interview length', { type: 'static_select', options: [30, 60, 90, 120, 150, 180].map((v) => opt(v, ' minutes')), initial_option: opt(Number(s.slot_minutes), ' minutes') }),
      input('step_minutes', 'Offer a start time every', { type: 'static_select', options: [30, 60, 120].map((v) => opt(v, ' minutes')), initial_option: opt(Number(s.step_minutes), ' minutes') }),
      input('interviewers_per_slot', 'Philos per interview', { type: 'static_select', options: [1, 2, 3, 4].map((v) => opt(v)), initial_option: opt(Number(s.interviewers_per_slot)) }),
      input('min_notice_hours', 'Minimum notice (hours)', { type: 'number_input', is_decimal_allowed: false, min_value: '0', initial_value: String(s.min_notice_hours) }),
      input('location', 'Location', { type: 'plain_text_input', initial_value: s.location }),
    ],
  };
}

function editModal(iv) {
  return {
    type: 'modal',
    callback_id: 'edit_submit',
    private_metadata: String(iv.id),
    title: { type: 'plain_text', text: 'Edit interview' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks: [
      md(`*${applicant(iv)}* (${iv.applicant_email})\nCurrently ${fmt(iv.start_utc)}`),
      { type: 'input', block_id: 'start', label: { type: 'plain_text', text: 'New time' }, element: { type: 'datetimepicker', action_id: 'v', initial_date_time: Math.floor(new Date(iv.start_utc) / 1000) } },
      { type: 'input', block_id: 'interviewers', label: { type: 'plain_text', text: 'Interviewers' }, element: { type: 'multi_users_select', action_id: 'v', initial_users: iv.interviewers } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Interviewers get an updated calendar invite. The applicant sees the new time on their confirmation link, so let them know. Conflicts are allowed but you will be warned.' }] },
    ],
  };
}

const HELP = [
  '*/philo connect* — connect your Google Calendar',
  '*/philo disconnect* — stop being scheduled',
  '*/philo list* — your upcoming interviews (First Censor: all of them)',
  '*/philo link* — the applicant sign-up link',
  '_First Censor only:_ */philo settings*, */philo open*, */philo close*, */philo censor @someone* (hand off the role)',
].join('\n');

export function registerSlack(app) {
  const refreshHomes = (ids) => Promise.all([...new Set([...ids, db.getSetting('first_censor')].filter(Boolean))].map((id) => publishHome(app.client, id).catch(() => {})));
  const dm = (id, text) => app.client.chat.postMessage({ channel: id, text }).catch((e) => console.error('[slack] dm failed', e.data?.error || e.message));

  // ---- notifications from the scheduler ----
  scheduler.events.on('booked', (iv) => {
    for (const id of iv.interviewers) dm(id, `:calendar: You're interviewing *${applicant(iv)}* on *${fmt(iv.start_utc)}* with ${mentions(iv.interviewers.filter((x) => x !== id))}. A calendar invite is on its way.`);
    refreshHomes(iv.interviewers);
  });
  scheduler.events.on('cancelled', (iv, { by } = {}) => {
    const who = by === 'applicant' ? 'the applicant' : `<@${by}>`;
    for (const id of iv.interviewers) dm(id, `:x: *${applicant(iv)}*'s interview on ${fmt(iv.start_utc)} was cancelled by ${who}.`);
    refreshHomes(iv.interviewers);
  });
  scheduler.events.on('rescheduled', (iv, { by, before }) => {
    const affected = [...new Set([...before.interviewers, ...iv.interviewers])];
    for (const id of affected) {
      const text = iv.interviewers.includes(id)
        ? `:arrows_counterclockwise: <@${by}> updated *${applicant(iv)}*'s interview: now *${fmt(iv.start_utc)}* with ${mentions(iv.interviewers)}.`
        : `:arrows_counterclockwise: <@${by}> took you off *${applicant(iv)}*'s interview (${fmt(before.start_utc)}).`;
      dm(id, text);
    }
    refreshHomes(affected);
  });

  // ---- App Home ----
  app.event('app_home_opened', async ({ event, client }) => {
    if (event.tab === 'home') await publishHome(client, event.user);
  });

  app.action('gcal_connect', async ({ ack }) => ack()); // URL button; Slack still sends an action

  app.action('gcal_disconnect', async ({ ack, body, client }) => {
    await ack();
    const err = tryDisconnect(body.user.id);
    if (err) await client.chat.postMessage({ channel: body.user.id, text: err });
    await publishHome(client, body.user.id);
  });

  // ---- First Censor controls ----
  const requireCensor = async (userId, respond) => {
    if (db.isFirstCensor(userId)) return true;
    await respond('Only the First Censor can do that.');
    return false;
  };
  const ephemeralTo = (client, userId) => (text) => client.chat.postMessage({ channel: userId, text });

  app.action('open_settings', async ({ ack, body, client }) => {
    await ack();
    if (!(await requireCensor(body.user.id, ephemeralTo(client, body.user.id)))) return;
    await client.views.open({ trigger_id: body.trigger_id, view: settingsModal(db.getSettings()) });
  });

  app.view('settings_submit', async ({ ack, body, view, client }) => {
    const v = view.state.values;
    const val = (b) => v[b].v;
    if (!db.isFirstCensor(body.user.id)) return ack({ response_action: 'errors', errors: { location: 'Only the First Censor can change settings.' } });
    const next = {
      booking_open: val('booking_open').selected_options?.length ? '1' : '0',
      window_start: val('window_start').selected_date,
      window_end: val('window_end').selected_date,
      day_start: val('day_start').selected_time,
      day_end: val('day_end').selected_time,
      slot_minutes: val('slot_minutes').selected_option.value,
      step_minutes: val('step_minutes').selected_option.value,
      interviewers_per_slot: val('interviewers_per_slot').selected_option.value,
      min_notice_hours: val('min_notice_hours').value,
      location: val('location').value,
    };
    const errors = {};
    if (next.window_end < next.window_start) errors.window_end = 'Must be on or after the first day.';
    if (next.day_end <= next.day_start) errors.day_end = 'Must be after the earliest start.';
    if (Object.keys(errors).length) return ack({ response_action: 'errors', errors });
    await ack();
    for (const [k, value] of Object.entries(next)) db.setSetting(k, value);
    scheduler.invalidate();
    await publishHome(client, body.user.id);
  });

  app.action('iv_edit', async ({ ack, body, action, client }) => {
    await ack();
    if (!(await requireCensor(body.user.id, ephemeralTo(client, body.user.id)))) return;
    const iv = db.getInterview(Number(action.value));
    if (!iv || iv.status !== 'booked') return;
    await client.views.open({ trigger_id: body.trigger_id, view: editModal(iv) });
  });

  app.view('edit_submit', async ({ ack, body, view, client }) => {
    if (!db.isFirstCensor(body.user.id)) return ack({ response_action: 'errors', errors: { start: 'Only the First Censor can edit interviews.' } });
    const startSec = view.state.values.start.v.selected_date_time;
    const interviewers = view.state.values.interviewers.v.selected_users;
    if (!interviewers?.length) return ack({ response_action: 'errors', errors: { interviewers: 'Pick at least one interviewer.' } });
    await ack();
    const tell = ephemeralTo(client, body.user.id);
    try {
      const { interview, conflicts, unconnected } = await scheduler.reschedule(Number(view.private_metadata), {
        startIso: new Date(startSec * 1000).toISOString(), interviewers, by: body.user.id,
      });
      const notes = [];
      if (conflicts.length) notes.push(`:warning: ${mentions(conflicts)} look busy then.`);
      if (unconnected.length) notes.push(`:warning: ${mentions(unconnected)} haven't connected Google Calendar, so they won't get a calendar invite.`);
      await tell(`Saved: *${applicant(interview)}* is now ${fmt(interview.start_utc)} with ${mentions(interview.interviewers)}.${notes.length ? '\n' + notes.join('\n') : ''}`);
    } catch (e) {
      console.error(e);
      await tell(`Couldn't update that interview: ${e.message}`);
    }
  });

  app.action('iv_cancel', async ({ ack, body, action, client }) => {
    await ack();
    const tell = ephemeralTo(client, body.user.id);
    if (!(await requireCensor(body.user.id, tell))) return;
    try {
      await scheduler.cancel(Number(action.value), { by: body.user.id });
    } catch (e) {
      await tell(`Couldn't cancel: ${e.message}`);
    }
  });

  // ---- /philo slash command ----
  app.command('/philo', async ({ ack, command, client, respond }) => {
    await ack();
    const [sub = 'help', ...rest] = command.text.trim().split(/\s+/);
    const userId = command.user_id;
    const censor = db.isFirstCensor(userId);

    switch (sub.toLowerCase()) {
      case 'connect':
        return respond({
          response_type: 'ephemeral',
          blocks: [{
            type: 'section', text: { type: 'mrkdwn', text: 'Connect your Google Calendar (we only read free/busy):' },
            accessory: { type: 'button', text: { type: 'plain_text', text: 'Connect Google Calendar' }, style: 'primary', url: await connectLink(client, userId), action_id: 'gcal_connect' },
          }],
          text: 'Connect your Google Calendar',
        });
      case 'disconnect':
        return respond(tryDisconnect(userId) || 'Disconnected. You will not be offered for new interviews.');
      case 'link':
        return respond(`Applicant sign-up page: ${config.baseUrl}`);
      case 'list': {
        const list = censor ? db.upcomingInterviews() : db.upcomingInterviews({ slackId: userId });
        if (!list.length) return respond('No upcoming interviews.');
        return respond(list.map((iv) => `• *${fmt(iv.start_utc)}* — ${applicant(iv)} with ${mentions(iv.interviewers)}`).join('\n'));
      }
      case 'settings':
        if (!(await requireCensor(userId, respond))) return;
        return client.views.open({ trigger_id: command.trigger_id, view: settingsModal(db.getSettings()) });
      case 'open':
      case 'close':
        if (!(await requireCensor(userId, respond))) return;
        db.setSetting('booking_open', sub === 'open' ? '1' : '0');
        scheduler.invalidate();
        return respond(`Applicant sign-ups are now *${sub === 'open' ? 'open' : 'closed'}*.`);
      case 'censor': {
        const target = rest.join(' ').match(/<@([UW][A-Z0-9]+)/)?.[1];
        const current = db.getSetting('first_censor');
        if (!target) return respond(current ? `The First Censor is <@${current}>.` : 'No First Censor is set. Set FIRST_CENSOR_SLACK_ID.');
        if (!(await requireCensor(userId, respond))) return;
        db.setSetting('first_censor', target);
        await Promise.all([publishHome(client, userId), publishHome(client, target)].map((p) => p.catch(() => {})));
        dm(target, `:scroll: <@${userId}> made you the *First Censor*. Open the Home tab of this app to manage interviews.`);
        return respond(`<@${target}> is now the First Censor.`);
      }
      default:
        return respond(HELP);
    }
  });
}
