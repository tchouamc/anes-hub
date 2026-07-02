// ── Notion API Layer ──

const NOTION_VERSION = '2022-06-28';

// corsproxy.io requires the target URL as a `url` query param, fully encoded.
function proxied(url) {
  return 'https://corsproxy.io/?url=' + encodeURIComponent(url);
}

const DB = {
  requirements: 'bbe0b489-2326-4134-8d6c-1630b5306419',
  cases:        'a93f5658-c3b4-4a64-a169-b02c0bdcc6d7',
  resources:    'dba0a69e-f476-4c52-b14a-70a01656f566',
};

function notionHeaders() {
  return {
    'Authorization': `Bearer ${localStorage.getItem('notion_token')}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

async function notionGet(path) {
  const r = await fetch(proxied(`https://api.notion.com${path}`), { headers: notionHeaders() });
  if (!r.ok) throw new Error(`Notion GET ${path} → ${r.status}`);
  return r.json();
}

async function notionPost(path, body) {
  const r = await fetch(proxied(`https://api.notion.com${path}`), {
    method: 'POST', headers: notionHeaders(), body: JSON.stringify(body)
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Notion POST ${path} → ${r.status}: ${t}`); }
  return r.json();
}

async function notionPatch(path, body) {
  const r = await fetch(proxied(`https://api.notion.com${path}`), {
    method: 'PATCH', headers: notionHeaders(), body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Notion PATCH ${path} → ${r.status}`);
  return r.json();
}

async function queryDB(dbId) {
  let results = [], cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionPost(`/v1/databases/${dbId}/query`, body);
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

function txt(prop) { return prop?.rich_text?.[0]?.plain_text || ''; }
function title(prop) { return prop?.title?.[0]?.plain_text || ''; }

// ── Requirements (also stores EPAs, block goals, personal goals via Category) ──
async function fetchRequirements() {
  const pages = await queryDB(DB.requirements);
  return pages.map(p => ({
    _id: p.id,
    text: title(p.properties['Name']),
    cat: p.properties['Category']?.select?.name || 'Other',
    due: txt(p.properties['Due Date']),
    done: p.properties['Done']?.checkbox || false,
    notes: txt(p.properties['Notes']),
  })).filter(r => r.text);
}

async function createRequirement(req) {
  const page = await notionPost('/v1/pages', {
    parent: { database_id: DB.requirements },
    properties: {
      'Name': { title: [{ text: { content: req.text } }] },
      'Category': { select: { name: req.cat } },
      'Due Date': { rich_text: [{ text: { content: req.due || '' } }] },
      'Done': { checkbox: req.done || false },
      'Status': { select: { name: req.done ? 'Done' : 'Not started' } },
      'Notes': { rich_text: [{ text: { content: req.notes || '' } }] },
    }
  });
  return page.id;
}

async function updateRequirement(notionId, fields) {
  const properties = {};
  if ('done' in fields) {
    properties['Done'] = { checkbox: fields.done };
    properties['Status'] = { select: { name: fields.done ? 'Done' : 'Not started' } };
  }
  if ('notes' in fields) properties['Notes'] = { rich_text: [{ text: { content: fields.notes } }] };
  await notionPatch(`/v1/pages/${notionId}`, { properties });
}

async function deleteNotionPage(notionId) {
  await notionPatch(`/v1/pages/${notionId}`, { archived: true });
}

// ── Cases ──
async function fetchCases() {
  const pages = await queryDB(DB.cases);
  return pages.map(p => ({
    _id: p.id,
    title: title(p.properties['Case Title']),
    date: txt(p.properties['Date']),
    rotation: txt(p.properties['Rotation / Site']),
    tags: p.properties['Tags']?.multi_select?.map(t => t.name) || [],
    pearl: txt(p.properties['Pearl']),
    drugs: txt(p.properties['Drugs / Doses']),
  })).filter(c => c.title);
}

async function createCase(c) {
  const validTags = ['Airway','Cardiac','Regional','Paeds','OB','Trauma','ICU','Pain'];
  const tags = (c.tags || []).filter(t => validTags.includes(t));
  const page = await notionPost('/v1/pages', {
    parent: { database_id: DB.cases },
    properties: {
      'Case Title': { title: [{ text: { content: c.title } }] },
      'Date': { rich_text: [{ text: { content: c.date || '' } }] },
      'Rotation / Site': { rich_text: [{ text: { content: c.rotation || '' } }] },
      'Tags': { multi_select: tags.map(t => ({ name: t })) },
      'Pearl': { rich_text: [{ text: { content: [c.pearl || '', c.procs && c.procs.length ? '[Procedures: ' + c.procs.join(', ') + ']' : ''].filter(Boolean).join(' ') } }] },
      'Drugs / Doses': { rich_text: [{ text: { content: c.drugs || '' } }] },
    }
  });
  return page.id;
}

// ── Resources (also stores journal entries via Type='Journal') ──
async function fetchResources() {
  const pages = await queryDB(DB.resources);
  return pages.map(p => ({
    _id: p.id,
    name: title(p.properties['Name']),
    type: p.properties['Type']?.select?.name || 'Link',
    url: p.properties['URL']?.url || '',
    topic: txt(p.properties['Topic']),
  })).filter(r => r.name);
}

async function createResource(res) {
  const page = await notionPost('/v1/pages', {
    parent: { database_id: DB.resources },
    properties: {
      'Name': { title: [{ text: { content: res.name } }] },
      'Type': { select: { name: res.type } },
      'URL': { url: res.url || null },
      'Topic': { rich_text: [{ text: { content: res.topic || '' } }] },
    }
  });
  return page.id;
}

async function validateToken(token) {
  const r = await fetch(proxied('https://api.notion.com/v1/users/me'), {
    headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': NOTION_VERSION }
  });
  return r.ok;
}
