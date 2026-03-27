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
  weightLog:    'a794383f29d641c88d6861b1c8b3dc67',
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

    // ── POST: update-set ─────────────────────────────────────────────────────
    if (action === 'update-set' && req.method === 'POST') {
      const { setId, exerciseName, setNum, weight, reps, isBodyweight, seconds } = req.body ?? {};
      if (!setId) return res.status(400).json({ error: 'setId required' });

      let notes = `${exerciseName} · Set ${setNum}`;
      if (isBodyweight) notes += ' · BW';
      if (seconds > 0) notes += ` · ${seconds}s`;

      await notion(`/pages/${setId}`, 'PATCH', {
        properties: {
          Notes:   { title: [{ text: { content: notes } }] },
          Weight:  { number: weight ?? null },
          Reps:    { number: reps ?? null },
          Seconds: { number: seconds > 0 ? seconds : null },
        },
      });
      return res.json({ ok: true });
    }

    // ── POST: delete-set ─────────────────────────────────────────────────────
    if (action === 'delete-set' && req.method === 'POST') {
      const { setId } = req.body ?? {};
      if (!setId) return res.status(400).json({ error: 'setId required' });
      await notion(`/pages/${setId}`, 'PATCH', { archived: true });
      return res.json({ ok: true });
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

    // ── POST: migrate-set-muscle-icons ─────────────────────────────────────
    if (action === 'migrate-set-muscle-icons' && req.method === 'POST') {
      const ICONS = {
        'Abs': '⚡', 'Core': '⚡', 'Back': '🏋️', 'Biceps': '💪',
        'Calves': '🦵', 'Chest': '🫁', 'Glutes': '🍑',
        'Hamstrings': '🦵', 'Lower Back': '🦴', 'Quadriceps': '🦵',
        'Shoulders': '💪', 'Traps': '🔱', 'Triceps': '💪',
      };
      const mgData = await notion(`/databases/${DB.muscleGroups}/query`, 'POST', { page_size: 50 });
      const tasks = mgData.results
        .map(p => ({ id: p.id, name: p.properties.Name?.title?.[0]?.plain_text }))
        .filter(({ name }) => ICONS[name])
        .map(({ id, name }) =>
          notion(`/pages/${id}`, 'PATCH', { icon: { type: 'emoji', emoji: ICONS[name] } })
            .then(() => ({ name, emoji: ICONS[name] }))
        );
      const results = await Promise.all(tasks);
      return res.json({ ok: true, updated: results });
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

    // ── GET: logbook-schema ──────────────────────────────────────────────────
    if (action === 'logbook-schema') {
      const db = await notion(`/databases/${DB.logbook}`);
      const props = Object.entries(db.properties).map(([name, p]) => ({ name, type: p.type }));
      return res.json(props);
    }

    // ── POST: backfill-seconds ───────────────────────────────────────────────
    if (action === 'backfill-seconds' && req.method === 'POST') {
      // Page through all logbook entries and populate Seconds from Notes text
      let all = [], cursor;
      do {
        const data = await notion(`/databases/${DB.logbook}/query`, 'POST', {
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        all = all.concat(data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);

      // Filter to entries that have seconds in Notes but null Seconds property
      const toUpdate = all.filter(p => {
        const notes = p.properties.Notes?.title?.[0]?.plain_text ?? '';
        const hasSeconds = / · \d+s/.test(notes);
        const currentSeconds = p.properties.Seconds?.number;
        return hasSeconds && (currentSeconds === null || currentSeconds === undefined);
      });

      // Update in parallel batches of 10 to avoid rate limits
      let updated = 0;
      for (let i = 0; i < toUpdate.length; i += 10) {
        const batch = toUpdate.slice(i, i + 10);
        await Promise.all(batch.map(p => {
          const notes = p.properties.Notes?.title?.[0]?.plain_text ?? '';
          const match = notes.match(/ · (\d+)s/);
          const seconds = match ? parseInt(match[1]) : null;
          const isBodyweight = notes.includes(' · BW');
          return notion(`/pages/${p.id}`, 'PATCH', {
            properties: {
              Seconds:    { number: seconds },
              Bodyweight: { checkbox: isBodyweight },
            },
          });
        }));
        updated += batch.length;
      }

      return res.json({ ok: true, total: all.length, backfilled: updated });
    }

    // ── GET: dashboard-weight ────────────────────────────────────────────────
    if (action === 'dashboard-weight') {
      let all = [], cursor;
      do {
        const data = await notion(`/databases/${DB.weightLog}/query`, 'POST', {
          sorts: [{ property: 'Date', direction: 'ascending' }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        all = all.concat(data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);

      const entries = all
        .map(p => ({
          date:    p.properties.Date?.date?.start ?? '',
          weight:  p.properties['Weight (kg)']?.number ?? null,
          bmi:     p.properties.BMI?.number ?? null,
          phase:   p.properties.Phase?.select?.name ?? null,
          delta:   p.properties['Δ vs Start (kg)']?.number ?? null,
          bodyFat: p.properties['Body Fat (%)']?.number ?? null,
          water:   p.properties['Water (%)']?.number ?? null,
          muscle:  p.properties['Muscle (%)']?.number ?? null,
          bone:    p.properties['Bone (kg)']?.number ?? null,
        }))
        .filter(e => e.date && e.weight !== null);

      const current = entries.length > 0 ? entries[entries.length - 1] : null;
      const start   = entries.length > 0 ? entries[0] : null;
      const currentBodyComp = [...entries].reverse().find(e =>
        e.bodyFat != null || e.water != null || e.muscle != null || e.bone != null
      ) ?? null;
      const startBodyComp = entries.find(e =>
        e.bodyFat != null || e.water != null || e.muscle != null || e.bone != null
      ) ?? null;

      return res.json({ entries, current, start, currentBodyComp, startBodyComp });
    }

    // ── POST: log-weight ─────────────────────────────────────────────────────
    if (action === 'log-weight' && req.method === 'POST') {
      const { date, weight, bmi, bodyFat, water, muscle, bone } = req.body ?? {};
      if (!weight) return res.status(400).json({ error: 'weight required' });

      const entryDate = date ?? new Date().toISOString().split('T')[0];
      const shortDate = new Date(entryDate + 'T00:00:00')
        .toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

      const props = {
        Name:          { title: [{ text: { content: `${shortDate} — ${weight}kg` } }] },
        Date:          { date: { start: entryDate } },
        'Weight (kg)': { number: weight },
      };
      if (bmi     != null) props['BMI']          = { number: bmi };
      if (bodyFat != null) props['Body Fat (%)'] = { number: bodyFat };
      if (water   != null) props['Water (%)']    = { number: water };
      if (muscle  != null) props['Muscle (%)']   = { number: muscle };
      if (bone    != null) props['Bone (kg)']    = { number: bone };

      const page = await notion('/pages', 'POST', {
        parent: { database_id: DB.weightLog },
        properties: props,
      });
      return res.json({ id: page.id });
    }

    // ── POST: batch-log-weight (kept for back-compat) ────────────────────────
    // Prefer upsert-weight-entries for new imports.
    if (action === 'batch-log-weight' && req.method === 'POST') {
      req.query.action = 'upsert-weight-entries';
      // fall through to upsert handler below
    }

    // ── POST: upsert-weight-entries ──────────────────────────────────────────
    // 1. Auto-migrates schema (adds body comp columns if missing)
    // 2. Fetches existing Notion entries in the CSV date range
    // 3. PATCHes entries that already exist (by date); POSTs new ones
    if ((action === 'upsert-weight-entries' || action === 'batch-log-weight') && req.method === 'POST') {
      const { entries } = req.body ?? {};
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'entries array required' });
      }

      // Step 1 — ensure body comp columns exist (idempotent)
      try {
        await notion(`/databases/${DB.weightLog}`, 'PATCH', {
          properties: {
            'Body Fat (%)': { number: { format: 'number' } },
            'Water (%)':    { number: { format: 'number' } },
            'Muscle (%)':   { number: { format: 'number' } },
            'Bone (kg)':    { number: { format: 'number' } },
          },
        });
      } catch (_) { /* columns may already exist */ }

      // Step 2 — fetch existing Notion pages in the import date range
      const sortedDates = entries.map(e => e.date).sort();
      const minDate = sortedDates[0];
      const maxDate = sortedDates[sortedDates.length - 1];

      let existing = [], cur;
      do {
        const data = await notion(`/databases/${DB.weightLog}/query`, 'POST', {
          filter: {
            and: [
              { property: 'Date', date: { on_or_after:  minDate } },
              { property: 'Date', date: { on_or_before: maxDate } },
            ],
          },
          page_size: 100,
          ...(cur ? { start_cursor: cur } : {}),
        });
        existing = existing.concat(data.results);
        cur = data.has_more ? data.next_cursor : undefined;
      } while (cur);

      // Build date → pageId map (first page per date wins)
      const existingByDate = new Map();
      for (const page of existing) {
        const d = page.properties.Date?.date?.start;
        if (d && !existingByDate.has(d)) existingByDate.set(d, page.id);
      }

      // Step 3 — upsert in batches of 5
      let updated = 0, created = 0;
      const errors = [];

      for (let i = 0; i < entries.length; i += 5) {
        const batch = entries.slice(i, i + 5);
        const results = await Promise.allSettled(batch.map(async (entry) => {
          const { date, weight, bodyFat, water, muscle, bone } = entry;
          if (!weight) throw new Error('missing weight');

          const compProps = {};
          if (bodyFat != null) compProps['Body Fat (%)'] = { number: bodyFat };
          if (water   != null) compProps['Water (%)']    = { number: water };
          if (muscle  != null) compProps['Muscle (%)']   = { number: muscle };
          if (bone    != null) compProps['Bone (kg)']    = { number: bone };

          if (existingByDate.has(date)) {
            // Update existing page — only overwrite body comp (preserve Phase etc.)
            await notion(`/pages/${existingByDate.get(date)}`, 'PATCH', {
              properties: {
                'Weight (kg)': { number: weight },
                ...compProps,
              },
            });
            return 'updated';
          } else {
            // Create new page
            const shortDate = new Date(date + 'T00:00:00')
              .toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
            await notion('/pages', 'POST', {
              parent: { database_id: DB.weightLog },
              properties: {
                Name:          { title: [{ text: { content: `${shortDate} — ${weight}kg` } }] },
                Date:          { date: { start: date } },
                'Weight (kg)': { number: weight },
                ...compProps,
              },
            });
            existingByDate.set(date, 'new'); // prevent duplicates if same date appears twice
            return 'created';
          }
        }));

        for (const r of results) {
          if (r.status === 'fulfilled') { if (r.value === 'updated') updated++; else created++; }
          else errors.push(r.reason?.message ?? 'unknown error');
        }
      }

      return res.json({ ok: true, updated, created, total: entries.length, errors });
    }

    // ── POST: migrate-weight-schema ──────────────────────────────────────────
    if (action === 'migrate-weight-schema' && req.method === 'POST') {
      await notion(`/databases/${DB.weightLog}`, 'PATCH', {
        properties: {
          'Body Fat (%)': { number: { format: 'number' } },
          'Water (%)':    { number: { format: 'number' } },
          'Muscle (%)':   { number: { format: 'number' } },
          'Bone (kg)':    { number: { format: 'number' } },
        },
      });
      return res.json({ ok: true, message: 'Added body composition columns to weight log' });
    }

    // ── GET: dashboard-training ──────────────────────────────────────────────
    if (action === 'dashboard-training') {
      // 1. Fetch muscle groups
      const mgData = await notion(`/databases/${DB.muscleGroups}/query`, 'POST', { page_size: 50 });
      const muscleGroupMap = new Map(
        mgData.results.map(p => [p.id, p.properties.Name?.title?.[0]?.plain_text ?? 'Unknown'])
      );

      // 2. Fetch all exercises (to map exercise → muscle groups)
      let allExercises = [], cur1;
      do {
        const data = await notion(`/databases/${DB.exercises}/query`, 'POST', {
          page_size: 100,
          ...(cur1 ? { start_cursor: cur1 } : {}),
        });
        allExercises = allExercises.concat(data.results);
        cur1 = data.has_more ? data.next_cursor : undefined;
      } while (cur1);

      const exerciseMap = new Map(
        allExercises.map(p => [
          p.id,
          { muscleGroupIds: (p.properties['Muscle Group']?.relation ?? []).map(r => r.id) },
        ])
      );

      // 3. Fetch workouts in last 8 weeks (non-templates)
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 56);
      const dateFrom = cutoff.toISOString().split('T')[0];

      let allWorkouts = [], cur2;
      do {
        const data = await notion(`/databases/${DB.workouts}/query`, 'POST', {
          filter: {
            and: [
              { property: 'Is Template', checkbox: { equals: false } },
              { property: 'Date', date: { on_or_after: dateFrom } },
            ],
          },
          sorts: [{ property: 'Date', direction: 'descending' }],
          page_size: 100,
          ...(cur2 ? { start_cursor: cur2 } : {}),
        });
        allWorkouts = allWorkouts.concat(data.results);
        cur2 = data.has_more ? data.next_cursor : undefined;
      } while (cur2);

      const workouts = allWorkouts.map(p => ({
        id:   p.id,
        name: p.properties.Name?.title?.[0]?.plain_text ?? 'Workout',
        date: p.properties.Date?.date?.start ?? '',
      }));

      // 4. Fetch logbook entries for each workout (parallel, cap at 25)
      const toFetch = workouts.slice(0, 25);
      const logbooksByWorkout = await Promise.all(
        toFetch.map(async w => {
          let sets = [], c;
          do {
            const d = await notion(`/databases/${DB.logbook}/query`, 'POST', {
              filter: { property: 'Workout', relation: { contains: w.id } },
              page_size: 100,
              ...(c ? { start_cursor: c } : {}),
            });
            sets = sets.concat(d.results);
            c = d.has_more ? d.next_cursor : undefined;
          } while (c);
          return { workoutId: w.id, sets };
        })
      );

      // 5. Aggregate: weekly sessions + muscle group totals + recent sessions
      const weeklyMap = new Map();
      const muscleGroupTotals = new Map();
      const recentSessions = [];

      for (const w of toFetch) {
        const logData = logbooksByWorkout.find(l => l.workoutId === w.id);
        if (!logData || !w.date) continue;

        // Muscle groups for this workout
        const workoutMGs = new Set();
        for (const entry of logData.sets) {
          const exId = entry.properties.Exercise?.relation?.[0]?.id;
          if (exId && exerciseMap.has(exId)) {
            for (const mgId of exerciseMap.get(exId).muscleGroupIds) {
              const mgName = muscleGroupMap.get(mgId);
              if (mgName) {
                workoutMGs.add(mgName);
                muscleGroupTotals.set(mgName, (muscleGroupTotals.get(mgName) ?? 0) + 1);
              }
            }
          }
        }

        // ISO week start (Monday)
        const d = new Date(w.date + 'T00:00:00');
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const weekKey   = monday.toISOString().split('T')[0];
        const weekLabel = monday.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
        if (!weeklyMap.has(weekKey)) weeklyMap.set(weekKey, { label: weekLabel, count: 0 });
        weeklyMap.get(weekKey).count++;

        if (recentSessions.length < 10) {
          recentSessions.push({
            id: w.id, name: w.name, date: w.date,
            muscleGroups: [...workoutMGs],
            setCount: logData.sets.length,
          });
        }
      }

      const weeklySessions = [...weeklyMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, v]) => ({ label: v.label, count: v.count }));

      const muscleGroupBreakdown = [...muscleGroupTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));

      return res.json({
        weeklySessions,
        muscleGroupBreakdown,
        recentSessions,
        totalWorkouts: workouts.length,
      });
    }

    // ── GET: dashboard-strength ──────────────────────────────────────────────
    if (action === 'dashboard-strength') {
      // 1. Fetch muscle groups
      const mgData = await notion(`/databases/${DB.muscleGroups}/query`, 'POST', { page_size: 50 });
      const muscleGroupMap = new Map(
        mgData.results.map(p => [p.id, p.properties.Name?.title?.[0]?.plain_text ?? 'Unknown'])
      );

      // 2. Fetch all exercises with Best Weight rollup
      let allExercises = [], cursor;
      do {
        const data = await notion(`/databases/${DB.exercises}/query`, 'POST', {
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        });
        allExercises = allExercises.concat(data.results);
        cursor = data.has_more ? data.next_cursor : undefined;
      } while (cursor);

      // Filter to exercises with a recorded Best Weight, take top 15
      const topExercises = allExercises
        .map(p => ({
          id:             p.id,
          name:           p.properties.Name?.title?.[0]?.plain_text ?? 'Unknown',
          bestWeight:     p.properties['Best Weight']?.rollup?.number ?? null,
          muscleGroupIds: (p.properties['Muscle Group']?.relation ?? []).map(r => r.id),
        }))
        .filter(e => e.bestWeight !== null && e.bestWeight > 0)
        .sort((a, b) => b.bestWeight - a.bestWeight)
        .slice(0, 15);

      // 3. Fetch logbook entries for each exercise in parallel
      const logbookByExercise = await Promise.all(
        topExercises.map(async ex => {
          let sets = [], c;
          do {
            const d = await notion(`/databases/${DB.logbook}/query`, 'POST', {
              filter: { property: 'Exercise', relation: { contains: ex.id } },
              page_size: 100,
              ...(c ? { start_cursor: c } : {}),
            });
            sets = sets.concat(d.results);
            c = d.has_more ? d.next_cursor : undefined;
          } while (c);
          return { exerciseId: ex.id, sets };
        })
      );

      // 4. Compute per-rep-range maxes (best weight for exact rep count)
      const exercises = topExercises.map(ex => {
        const logData = logbookByExercise.find(l => l.exerciseId === ex.id);
        const repMaxes = {};
        if (logData) {
          for (const set of logData.sets) {
            const reps   = set.properties.Reps?.number;
            const weight = set.properties.Weight?.number;
            if (reps != null && reps > 0 && weight != null && weight > 0) {
              if (repMaxes[reps] == null || weight > repMaxes[reps]) {
                repMaxes[reps] = weight;
              }
            }
          }
        }
        return {
          name:        ex.name,
          muscleGroup: ex.muscleGroupIds.length > 0
            ? (muscleGroupMap.get(ex.muscleGroupIds[0]) ?? 'Unknown')
            : 'Unknown',
          bestWeight:  ex.bestWeight,
          repMaxes,
        };
      });

      return res.json({ exercises });
    }

    // ── Unknown action ───────────────────────────────────────────────────────
    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('Notion proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
