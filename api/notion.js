/**
 * Gym Logger — Notion API Proxy
 * Vercel Serverless Function
 *
 * Handles all Notion API calls server-side to avoid CORS issues.
 * Set NOTION_TOKEN in your Vercel environment variables.
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// ── Your Notion Database IDs ──────────────────────────────────────────────────
const DB = {
  muscleGroups: '1ddf1256153781f09cbff554c81d32ea',
  exercises:    '1ddf12561537813eb539fefcacfb0ea4',
  workouts:     '1ddf125615378124baeccdc8fe75791b',
  logbook:      '1ddf12561537817dae9acd0367ba6ace',
};

// ── Notion fetch helper ───────────────────────────────────────────────────────
async function notion(path, method = 'GET', body = null) {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN environment variable is not set');

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${NOTION_API}${path}`, opts);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Notion API error ${res.status}: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS headers (allow your deployed URL or all origins)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    // ── GET: muscle-groups ───────────────────────────────────────────────────
    if (action === 'muscle-groups') {
      const data = await notion(`/databases/${DB.muscleGroups}/query`, 'POST', {
        sorts: [{ property: 'Name', direction: 'ascending' }],
        page_size: 50,
      });
      return res.json(data.results.map(p => ({
        id: p.id,
        name: p.properties.Name?.title?.[0]?.plain_text ?? 'Unknown',
      })));
    }

    // ── GET: exercises ───────────────────────────────────────────────────────
    if (action === 'exercises') {
      // Paginate to get all exercises (Notion max 100 per page)
      let all = [];
      let cursor = undefined;
      do {
        const data = await notion(`/databases/${DB.exercises}/query`, 'POST', {
          sorts: [{ property: 'Name', direction: 'ascending' }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        all = all.concat(data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);

      return res.json(all.map(p => ({
        id: p.id,
        name: p.properties.Name?.title?.[0]?.plain_text ?? 'Unknown',
        muscleGroupIds: (p.properties['Muscle Group']?.relation ?? []).map(r => r.id),
      })));
    }

    // ── POST: create-workout ─────────────────────────────────────────────────
    if (action === 'create-workout' && req.method === 'POST') {
      const { date, exerciseNames = [] } = req.body ?? {};

      // Build a readable name: "10 Mar — Bench Press, Squat +2"
      const shortDate = date
        ? new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
        : new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

      const exLabel = exerciseNames.length > 0
        ? exerciseNames.slice(0, 2).join(', ') + (exerciseNames.length > 2 ? ` +${exerciseNames.length - 2}` : '')
        : 'Custom Workout';

      const name = `${shortDate} — ${exLabel}`;

      const page = await notion('/pages', 'POST', {
        parent: { database_id: DB.workouts },
        properties: {
          Name: { title: [{ text: { content: name } }] },
          Date: { date: { start: date ?? new Date().toISOString().split('T')[0] } },
          'Is Template': { checkbox: false },
        },
      });

      return res.json({ id: page.id });
    }

    // ── POST: create-set ─────────────────────────────────────────────────────
    if (action === 'create-set' && req.method === 'POST') {
      const { workoutId, exerciseId, exerciseName, setNum, weight, reps } = req.body ?? {};

      const page = await notion('/pages', 'POST', {
        parent: { database_id: DB.logbook },
        properties: {
          Notes:    { title: [{ text: { content: `${exerciseName} · Set ${setNum}` } }] },
          Set:      { number: setNum },
          Weight:   { number: weight },
          Reps:     { number: reps },
          Done:     { checkbox: true },
          Exercise: { relation: [{ id: exerciseId }] },
          Workout:  { relation: [{ id: workoutId }] },
        },
      });

      return res.json({ id: page.id });
    }

    // ── GET: recent-workouts ─────────────────────────────────────────────────
    if (action === 'recent-workouts') {
      const data = await notion(`/databases/${DB.workouts}/query`, 'POST', {
        filter: { property: 'Is Template', checkbox: { equals: false } },
        sorts: [{ property: 'Date', direction: 'descending' }],
        page_size: 15,
      });

      return res.json(data.results.map(p => ({
        id: p.id,
        name: p.properties.Name?.title?.[0]?.plain_text ?? 'Workout',
        date: p.properties.Date?.date?.start ?? '',
      })));
    }

    // ── Unknown action ───────────────────────────────────────────────────────
    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('Notion proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
