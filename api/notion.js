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
        icon: p.icon?.type === 'emoji' ? p.icon.emoji : null,
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
      const { workoutId, exerciseId, exerciseName, setNum, weight, reps, isBodyweight, seconds } = req.body ?? {};

      // Build notes: "ExerciseName · Set N [· BW] [· Xs]"
      let notes = `${exerciseName} · Set ${setNum}`;
      if (isBodyweight) notes += ' · BW';
      if (seconds > 0) notes += ` · ${seconds}s`;

      const page = await notion('/pages', 'POST', {
        parent: { database_id: DB.logbook },
        properties: {
          Notes:      { title: [{ text: { content: notes } }] },
          Set:        { number: setNum },
          Weight:     { number: weight ?? null },
          Reps:       { number: reps ?? null },
          Done:       { checkbox: true },
          Bodyweight: { checkbox: isBodyweight ?? false },
          Seconds:    { number: seconds > 0 ? seconds : null },
          Exercise:   { relation: [{ id: exerciseId }] },
          Workout:    { relation: [{ id: workoutId }] },
        },
      });

      return res.json({ id: page.id });
    }

    // ── POST: delete-workout ─────────────────────────────────────────────────
    if (action === 'delete-workout' && req.method === 'POST') {
      const { workoutId } = req.body ?? {};
      if (!workoutId) return res.status(400).json({ error: 'workoutId required' });

      // Fetch all logbook entries for this workout (paginated)
      let all = [];
      let cursor = undefined;
      do {
        const data = await notion(`/databases/${DB.logbook}/query`, 'POST', {
          filter: { property: 'Workout', relation: { contains: workoutId } },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        all = all.concat(data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);

      // Archive (trash) all logbook entries
      await Promise.all(all.map(entry =>
        notion(`/pages/${entry.id}`, 'PATCH', { archived: true })
      ));

      // Archive the workout page itself
      await notion(`/pages/${workoutId}`, 'PATCH', { archived: true });

      return res.json({ ok: true, deleted: all.length + 1 });
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

    // ── GET: workout-detail ──────────────────────────────────────────────────
    if (action === 'workout-detail') {
      const { workoutId } = req.query;
      if (!workoutId) return res.status(400).json({ error: 'workoutId required' });

      // Fetch workout info
      const workout = await notion(`/pages/${workoutId}`);

      // Fetch all logbook entries for this workout (paginated)
      let all = [];
      let cursor = undefined;
      do {
        const data = await notion(`/databases/${DB.logbook}/query`, 'POST', {
          filter: { property: 'Workout', relation: { contains: workoutId } },
          sorts: [{ property: 'Set', direction: 'ascending' }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        all = all.concat(data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);

      // Group sets by exercise
      const exerciseMap = new Map();
      for (const entry of all) {
        const exRelations = entry.properties.Exercise?.relation ?? [];
        const exId = exRelations[0]?.id ?? 'unknown';

        // Extract exercise name from Notes field ("Exercise Name · Set N [· BW] [· Xs]")
        const notes = entry.properties.Notes?.title?.[0]?.plain_text ?? '';
        const exName = notes.split(' · Set ')[0] || 'Unknown Exercise';

        // Parse bodyweight and time from notes
        const isBodyweight = notes.includes(' · BW');
        const secMatch = notes.match(/ · (\d+)s(?:\s|$)/);
        const seconds = secMatch ? parseInt(secMatch[1]) : 0;

        const rawWeight = entry.properties.Weight?.number;
        const rawReps = entry.properties.Reps?.number;

        if (!exerciseMap.has(exId)) {
          exerciseMap.set(exId, { id: exId, name: exName, sets: [] });
        }

        exerciseMap.get(exId).sets.push({
          notionId: entry.id,
          setNum: entry.properties.Set?.number ?? (exerciseMap.get(exId).sets.length + 1),
          weight: rawWeight ?? null,
          reps: rawReps ?? null,
          isBodyweight: isBodyweight || rawWeight === null,
          repsNA: rawReps === null,
          seconds,
        });
      }

      // Sort sets within each exercise by set number
      const exercises = Array.from(exerciseMap.values()).map(ex => ({
        ...ex,
        sets: ex.sets.sort((a, b) => a.setNum - b.setNum),
      }));

      return res.json({
        id: workout.id,
        name: workout.properties.Name?.title?.[0]?.plain_text ?? 'Workout',
        date: workout.properties.Date?.date?.start ?? '',
        exercises,
      });
    }

    // ── POST: migrate-logbook-schema ────────────────────────────────────────
    if (action === 'migrate-logbook-schema' && req.method === 'POST') {
      await notion(`/databases/${DB.logbook}`, 'PATCH', {
        properties: {
          'Bodyweight': { checkbox: {} },
          'Seconds':    { number: { format: 'number' } },
        },
      });
      return res.json({ ok: true, message: 'Added Bodyweight + Seconds to logbook' });
    }

    // ── POST: migrate-merge-calf ─────────────────────────────────────────────
    if (action === 'migrate-merge-calf' && req.method === 'POST') {
      // 1. Find Calf and Calves pages
      const mgData = await notion(`/databases/${DB.muscleGroups}/query`, 'POST', { page_size: 50 });
      const calfPage   = mgData.results.find(p => p.properties.Name?.title?.[0]?.plain_text === 'Calf');
      const calvesPage = mgData.results.find(p => p.properties.Name?.title?.[0]?.plain_text === 'Calves');

      if (!calfPage)   return res.json({ ok: true, message: 'No Calf group found — already merged?' });
      if (!calvesPage) return res.status(400).json({ error: 'Calves group not found' });

      const calfId   = calfPage.id;
      const calvesId = calvesPage.id;

      // 2. Find all exercises linked to Calf (paginated)
      let exercises = [], cursor;
      do {
        const data = await notion(`/databases/${DB.exercises}/query`, 'POST', {
          filter: { property: 'Muscle Group', relation: { contains: calfId } },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        exercises = exercises.concat(data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);

      // 3. Re-link each exercise from Calf → Calves
      let updated = 0;
      for (const ex of exercises) {
        const ids = (ex.properties['Muscle Group']?.relation ?? []).map(r => r.id);
        const newIds = ids.filter(id => id !== calfId);
        if (!newIds.includes(calvesId)) newIds.push(calvesId);
        await notion(`/pages/${ex.id}`, 'PATCH', {
          properties: { 'Muscle Group': { relation: newIds.map(id => ({ id })) } },
        });
        updated++;
      }

      // 4. Archive the Calf page
      await notion(`/pages/${calfId}`, 'PATCH', { archived: true });

      return res.json({ ok: true, exercisesUpdated: updated, calfId, calvesId });
    }

    // ── POST: create-exercise ────────────────────────────────────────────────
    if (action === 'create-exercise' && req.method === 'POST') {
      const { name, muscleGroupId } = req.body ?? {};
      if (!name) return res.status(400).json({ error: 'name required' });

      const props = {
        Name: { title: [{ text: { content: name } }] },
      };
      if (muscleGroupId) {
        props['Muscle Group'] = { relation: [{ id: muscleGroupId }] };
      }

      const page = await notion('/pages', 'POST', {
        parent: { database_id: DB.exercises },
        properties: props,
      });

      return res.json({ id: page.id, name });
    }

    // ── Unknown action ───────────────────────────────────────────────────────
    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('Notion proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
