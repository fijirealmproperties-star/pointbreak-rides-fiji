const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { initSchema } = require('../src/config/schema');
const { generateTokens } = require('../src/config/jwt');
const { generateWebsiteTokens } = require('../src/config/website-jwt');

async function createApp(t, { seedWebsiteAdmin = true } = {}) {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const db = {
    exec: (sql) => raw.exec(sql),
    prepare(sql) {
      return {
        run: (...args) => {
          raw.run(sql, args);
          return { changes: raw.getRowsModified() };
        },
        all: (...args) => {
          const stmt = raw.prepare(sql);
          try {
            stmt.bind(args);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally { stmt.free(); }
        },
        get: (...args) => {
          const stmt = raw.prepare(sql);
          try {
            stmt.bind(args);
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally { stmt.free(); }
        },
      };
    },
  };
  initSchema(db);
  if (seedWebsiteAdmin) {
    db.prepare('INSERT INTO website_admins (id, username, email, password_hash) VALUES (?, ?, ?, ?)')
      .run('website-admin-id', 'owner', 'owner@example.com', await bcrypt.hash('a separate website password', 4));
  }
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/website-auth', require('../src/routes/website-auth')(db));
  app.use('/api/website', require('../src/routes/website')(db));
  app.use('/api/admin/website', require('../src/routes/admin-website')(db));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => { server.close(); raw.close(); });
  return {
    db,
    base: `http://127.0.0.1:${server.address().port}/api`,
    admin: generateTokens('admin-id', 'admin').accessToken,
    websiteAdmin: seedWebsiteAdmin ? generateWebsiteTokens('website-admin-id').accessToken : null,
    rider: generateTokens('rider-id', 'rider').accessToken,
  };
}

async function request(base, path, { method = 'GET', body, token } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  return {
    status: response.status,
    body: contentType.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()),
  };
}

test('website editor requires separate website admin credentials and validates website copy', async (t) => {
  const { base, admin, websiteAdmin, rider, db } = await createApp(t);
  assert.equal((await request(base, '/admin/website')).status, 401);
  assert.equal((await request(base, '/admin/website', { token: admin })).status, 401);
  assert.equal((await request(base, '/admin/website', { token: rider })).status, 401);

  const initial = await request(base, '/admin/website', { token: websiteAdmin });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.content.heroTitle, 'Find your way');
  assert.equal(initial.body.content.contactPhone, '');
  const updated = { ...initial.body.content, heroTitle: 'Bula, Fiji!' };
  const saved = await request(base, '/admin/website/content', { method: 'PUT', body: updated, token: websiteAdmin });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.content.heroTitle, 'Bula, Fiji!');

  const invalid = await request(base, '/admin/website/content', {
    method: 'PUT',
    body: { ...updated, contactEmail: 'not-an-email' },
    token: websiteAdmin,
  });
  assert.equal(invalid.status, 400);
  assert.equal(db.prepare("SELECT value FROM website_settings WHERE key='content'").get().value.includes('Bula, Fiji!'), true);

  const publicContent = await request(base, '/website');
  assert.equal(publicContent.status, 200);
  assert.equal(publicContent.body.content.heroTitle, 'Bula, Fiji!');
});

test('uploaded photos stay private until attached to public content; drafts are not published', async (t) => {
  const { base, websiteAdmin } = await createApp(t);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24, 1)]);
  const uploaded = await request(base, '/admin/website/media', {
    method: 'POST',
    body: { name: 'Fiji photo.png', mime: 'image/png', data: png.toString('base64') },
    token: websiteAdmin,
  });
  assert.equal(uploaded.status, 201);
  const imageId = uploaded.body.media.id;
  assert.equal((await request(base, `/website/media/${imageId}`)).status, 404);
  const adminPhoto = await request(base, `/admin/website/media/${imageId}`, { token: websiteAdmin });
  assert.equal(adminPhoto.status, 200);
  assert.deepEqual(adminPhoto.body, png);

  const content = (await request(base, '/admin/website', { token: websiteAdmin })).body.content;
  const savedContent = await request(base, '/admin/website/content', {
    method: 'PUT',
    body: { ...content, heroImageId: imageId },
    token: websiteAdmin,
  });
  assert.equal(savedContent.status, 200);
  const publicPhoto = await request(base, `/website/media/${imageId}`);
  assert.equal(publicPhoto.status, 200);
  assert.deepEqual(publicPhoto.body, png);

  const postBody = { title: 'Island news', summary: 'A new story from Fiji.', body: 'Full story body.', imageId, imageAlt: 'An island view', published: false };
  const draft = await request(base, '/admin/website/posts', { method: 'POST', body: postBody, token: websiteAdmin });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.post.published, false);
  assert.equal((await request(base, '/website')).body.posts.length, 0);

  const published = await request(base, `/admin/website/posts/${draft.body.post.id}`, {
    method: 'PUT',
    body: { ...postBody, published: true },
    token: websiteAdmin,
  });
  assert.equal(published.status, 200);
  const publicPosts = (await request(base, '/website')).body.posts;
  assert.equal(publicPosts.length, 1);
  assert.equal(publicPosts[0].title, 'Island news');
  assert.equal(publicPosts[0].imageUrl, `/api/website/media/${imageId}`);
});

test('website photo uploads reject unsupported and mismatched image data', async (t) => {
  const { base, websiteAdmin } = await createApp(t);
  const unsupported = await request(base, '/admin/website/media', {
    method: 'POST',
    body: { name: 'file.svg', mime: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64') },
    token: websiteAdmin,
  });
  assert.equal(unsupported.status, 400);
  const mismatched = await request(base, '/admin/website/media', {
    method: 'POST',
    body: { name: 'file.png', mime: 'image/png', data: Buffer.from('not a png file').toString('base64') },
    token: websiteAdmin,
  });
  assert.equal(mismatched.status, 400);
});

test('About photos publish with website content and cannot be deleted while selected', async (t) => {
  const { base, websiteAdmin } = await createApp(t);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24, 1)]);
  const uploaded = await request(base, '/admin/website/media', {
    method: 'POST',
    body: { name: 'about.png', mime: 'image/png', data: png.toString('base64') },
    token: websiteAdmin,
  });
  const imageId = uploaded.body.media.id;
  assert.equal((await request(base, `/website/media/${imageId}`)).status, 404);

  const content = (await request(base, '/admin/website', { token: websiteAdmin })).body.content;
  const saved = await request(base, '/admin/website/content', {
    method: 'PUT',
    body: { ...content, aboutImageId: imageId, aboutImageAlt: 'A Fiji island at sunset' },
    token: websiteAdmin,
  });
  assert.equal(saved.status, 200);
  const publicContent = (await request(base, '/website')).body.content;
  assert.equal(publicContent.aboutImageUrl, `/api/website/media/${imageId}`);
  assert.equal(publicContent.aboutImageAlt, 'A Fiji island at sunset');
  assert.deepEqual((await request(base, `/website/media/${imageId}`)).body, png);
  assert.equal((await request(base, `/admin/website/media/${imageId}`, {
    method: 'DELETE', token: websiteAdmin,
  })).status, 409);

  const cleared = await request(base, '/admin/website/content', {
    method: 'PUT',
    body: { ...content, aboutImageId: null, aboutImageAlt: '' },
    token: websiteAdmin,
  });
  assert.equal(cleared.status, 200);
  assert.equal((await request(base, `/website/media/${imageId}`)).status, 404);
  assert.equal((await request(base, `/admin/website/media/${imageId}`, {
    method: 'DELETE', token: websiteAdmin,
  })).status, 200);
});

test('website design settings validate and publish background media and safe links', async (t) => {
  const { base, websiteAdmin } = await createApp(t);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24, 1)]);
  const uploaded = await request(base, '/admin/website/media', {
    method: 'POST',
    body: { name: 'background.png', mime: 'image/png', data: png.toString('base64') },
    token: websiteAdmin,
  });
  const imageId = uploaded.body.media.id;
  const content = (await request(base, '/admin/website', { token: websiteAdmin })).body.content;
  const customized = {
    ...content,
    contactPhone: '+679 123 4567',
    theme: {
      ...content.theme,
      backgroundColor: '#10243B',
      surfaceColor: '#1A2B3D',
      accentColor: '#2EB2A5',
      textColor: '#FFFFFF',
      borderColor: '#3A5264',
      borderRadius: 20,
      backgroundImageId: imageId,
    },
    sectionOrder: ['home', 'rides', 'features', 'booking', 'news', 'about', 'contact'],
    links: [{ label: 'Our story', url: '#about' }, { label: 'Email', url: 'mailto:owner@example.com' }],
  };
  const saved = await request(base, '/admin/website/content', {
    method: 'PUT',
    body: customized,
    token: websiteAdmin,
  });
  assert.equal(saved.status, 200);
  const publicContent = (await request(base, '/website')).body.content;
  assert.equal(publicContent.theme.backgroundImageUrl, `/api/website/media/${imageId}`);
  assert.deepEqual(publicContent.sectionOrder, customized.sectionOrder);
  assert.deepEqual(publicContent.links, customized.links);
  assert.equal(publicContent.contactPhone, '+679 123 4567');
  assert.equal((await request(base, `/website/media/${imageId}`)).status, 200);
  assert.equal((await request(base, `/admin/website/media/${imageId}`, { method: 'DELETE', token: websiteAdmin })).status, 409);

  const invalidCases = [
    { ...customized, theme: { ...customized.theme, accentColor: 'url(javascript:alert(1))' } },
    { ...customized, theme: { ...customized.theme, borderRadius: 33 } },
    { ...customized, sectionOrder: ['home', 'home', 'features', 'booking', 'news', 'about', 'contact'] },
    { ...customized, links: [{ label: 'Unsafe', url: 'javascript:alert(1)' }] },
    { ...customized, contactPhone: 'Call me!' },
  ];
  for (const body of invalidCases) {
    assert.equal((await request(base, '/admin/website/content', {
      method: 'PUT', body, token: websiteAdmin,
    })).status, 400);
  }

  const cleared = await request(base, '/admin/website/content', {
    method: 'PUT',
    body: { ...customized, theme: { ...customized.theme, backgroundImageId: null } },
    token: websiteAdmin,
  });
  assert.equal(cleared.status, 200);
  assert.equal((await request(base, `/admin/website/media/${imageId}`, { method: 'DELETE', token: websiteAdmin })).status, 200);
});

test('first website admin setup is one-time and creates separate account tokens', async (t) => {
  const previousKey = process.env.WEBSITE_ADMIN_SETUP_KEY;
  process.env.WEBSITE_ADMIN_SETUP_KEY = 'test-website-setup-key-with-more-than-32-characters';
  t.after(() => {
    if (previousKey === undefined) delete process.env.WEBSITE_ADMIN_SETUP_KEY;
    else process.env.WEBSITE_ADMIN_SETUP_KEY = previousKey;
  });
  const { base, admin, db } = await createApp(t, { seedWebsiteAdmin: false });
  const status = await request(base, '/website-auth/status');
  assert.equal(status.body.setupRequired, true);
  assert.equal(status.body.setupConfigured, true);
  assert.equal((await request(base, '/website-auth/setup', {
    method: 'POST', body: { setupKey: 'wrong', username: 'pointbreakweb', password: 'a secure website password' },
  })).status, 403);
  assert.equal((await request(base, '/website-auth/setup', {
    method: 'POST', body: { setupKey: process.env.WEBSITE_ADMIN_SETUP_KEY, username: 'pointbreakweb', password: 'short' },
  })).status, 400);
  assert.equal((await request(base, '/website-auth/setup', {
    method: 'POST',
    body: { setupKey: process.env.WEBSITE_ADMIN_SETUP_KEY, username: 'x', password: 'a secure website password' },
  })).status, 400);
  const created = await request(base, '/website-auth/setup', {
    method: 'POST',
    body: {
      setupKey: process.env.WEBSITE_ADMIN_SETUP_KEY,
      username: ' PointBreakWeb ',
      password: 'a secure website password',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.username, 'pointbreakweb');
  assert.equal(created.body.user.email, null);
  assert.equal(created.body.user.role, 'website_admin');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  assert.equal((await request(base, '/website-auth/setup', {
    method: 'POST',
    body: {
      setupKey: process.env.WEBSITE_ADMIN_SETUP_KEY,
      username: 'otheradmin',
      password: 'another secure password',
    },
  })).status, 409);

  assert.equal((await request(base, '/admin/website', { token: admin })).status, 401);
  const login = await request(base, '/website-auth/login', {
    method: 'POST', body: { username: 'POINTBREAKWEB', password: 'a secure website password' },
  });
  assert.equal(login.status, 200);
  assert.equal((await request(base, '/admin/website', { token: login.body.accessToken })).status, 200);
  const refresh = await request(base, '/website-auth/refresh', {
    method: 'POST', body: { refreshToken: login.body.refreshToken },
  });
  assert.equal(refresh.status, 200);
});

test('existing website-admin email logins remain compatible after username migration', async (t) => {
  const { base } = await createApp(t);
  const login = await request(base, '/website-auth/login', {
    method: 'POST',
    body: { username: 'OWNER@EXAMPLE.COM', password: 'a separate website password' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.username, 'owner');
});

test('legacy website-admin tables migrate email addresses into usernames', async (t) => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  raw.exec(`
    CREATE TABLE website_admins (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  raw.run(
    'INSERT INTO website_admins (id, email, password_hash) VALUES (?, ?, ?)',
    ['legacy-admin', 'owner@example.com', 'legacy-hash']
  );
  const db = {
    exec: (sql) => raw.exec(sql),
    prepare(sql) {
      return {
        run: (...args) => {
          raw.run(sql, args);
          return { changes: raw.getRowsModified() };
        },
        all(...args) {
          const stmt = raw.prepare(sql);
          try {
            stmt.bind(args);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
          } finally { stmt.free(); }
        },
        get(...args) {
          const stmt = raw.prepare(sql);
          try {
            stmt.bind(args);
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally { stmt.free(); }
        },
      };
    },
  };
  t.after(() => raw.close());
  initSchema(db);
  const migrated = db.prepare('SELECT id, username, email, password_hash FROM website_admins WHERE id=?')
    .get('legacy-admin');
  assert.deepEqual(migrated, {
    id: 'legacy-admin',
    username: 'owner@example.com',
    email: 'owner@example.com',
    password_hash: 'legacy-hash',
  });
});
