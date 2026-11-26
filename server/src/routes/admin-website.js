const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireWebsiteAdmin } = require('../middleware/website-admin-auth');
const { DEFAULT_WEBSITE_CONTENT, validateWebsiteContent } = require('../website-content');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_POST_TITLE = 140;

function decodeImage(input) {
  const mime = input && input.mime;
  let encoded = String((input && input.data) || '');
  const dataUrl = encoded.match(/^data:([^;]+);base64,/);
  if (dataUrl) {
    if (mime && mime !== dataUrl[1]) return { error: 'Photo type does not match its data' };
    encoded = encoded.slice(dataUrl[0].length);
  }
  if (!IMAGE_TYPES.has(mime)) return { error: 'Photos must be JPG, PNG or WebP' };
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8 ||
      encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { error: 'Photo data is invalid or too large (maximum 3 MB)' };
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES || buffer.toString('base64') !== encoded) {
    return { error: 'Photo data is invalid or too large (maximum 3 MB)' };
  }
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  const isWebp = buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if ((mime === 'image/png' && !isPng) || (mime === 'image/jpeg' && !isJpeg) || (mime === 'image/webp' && !isWebp)) {
    return { error: 'Photo content does not match the selected image type' };
  }
  return { mime, data: encoded, size: buffer.length };
}

function readContent(db) {
  const row = db.prepare("SELECT value FROM website_settings WHERE key='content'").get();
  if (!row) return DEFAULT_WEBSITE_CONTENT;
  try {
    return { ...DEFAULT_WEBSITE_CONTENT, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_WEBSITE_CONTENT;
  }
}

function getPost(db, id) {
  const post = db.prepare(`
    SELECT id, title, summary, body, image_id, image_alt, published, published_at, created_at, updated_at
    FROM website_posts WHERE id=?
  `).get(id);
  return post ? { ...post, published: !!post.published } : null;
}

module.exports = (db) => {
  const router = express.Router();
  router.use(requireWebsiteAdmin);

  router.get('/', (req, res) => {
    const media = db.prepare('SELECT id, name, mime, size, created_at FROM website_media ORDER BY created_at DESC LIMIT 100').all();
    const posts = db.prepare(`
      SELECT id, title, summary, body, image_id, image_alt, published, published_at, created_at, updated_at
      FROM website_posts ORDER BY updated_at DESC LIMIT 100
    `).all().map((post) => ({ ...post, published: !!post.published }));
    res.json({ content: readContent(db), posts, media });
  });

  router.put('/content', (req, res) => {
    const result = validateWebsiteContent(req.body, db);
    if (result.error) return res.status(400).json({ error: result.error });
    const saved = db.prepare(`
      INSERT INTO website_settings (key, value, updated_at) VALUES ('content', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(JSON.stringify(result.content));
    if (!saved || saved.changes !== 1) return res.status(500).json({ error: 'Could not save website content' });
    res.json({ content: result.content });
  });

  router.post('/media', (req, res) => {
    const image = decodeImage(req.body);
    if (image.error) return res.status(400).json({ error: image.error });
    const id = uuidv4();
    const name = String((req.body && req.body.name) || 'website-photo')
      .replace(/[\\/\u0000-\u001f]/g, '').trim().slice(0, 100) || 'website-photo';
    const inserted = db.prepare('INSERT INTO website_media (id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, image.mime, image.size, image.data);
    if (!inserted || inserted.changes !== 1) return res.status(500).json({ error: 'Could not save the uploaded photo' });
    res.status(201).json({ media: { id, name, mime: image.mime, size: image.size, created_at: new Date().toISOString() } });
  });

  router.get('/media/:id', (req, res) => {
    const media = db.prepare('SELECT mime, data FROM website_media WHERE id=?').get(req.params.id);
    if (!media) return res.status(404).json({ error: 'Photo not found' });
    const buffer = Buffer.from(media.data, 'base64');
    res.set({
      'Content-Type': media.mime,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(buffer);
  });

  router.delete('/media/:id', (req, res) => {
    const content = readContent(db);
    const usedAsHero = content.heroImageId === req.params.id;
    const usedInAbout = content.aboutImageId === req.params.id;
    const usedAsBackground = content.theme.backgroundImageId === req.params.id;
    const usedInPost = !!db.prepare('SELECT id FROM website_posts WHERE image_id=? LIMIT 1').get(req.params.id);
    if (usedAsHero || usedInAbout || usedAsBackground || usedInPost) return res.status(409).json({ error: 'Remove this photo from the website and news posts before deleting it' });
    const result = db.prepare('DELETE FROM website_media WHERE id=?').run(req.params.id);
    if (result.changes !== 1) return res.status(404).json({ error: 'Photo not found' });
    res.json({ ok: true });
  });

  function savePost(req, res, id) {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    const article = typeof body.body === 'string' ? body.body.trim() : '';
    const imageId = body.imageId == null || body.imageId === '' ? null : String(body.imageId).slice(0, 80);
    const imageAlt = typeof body.imageAlt === 'string' ? body.imageAlt.trim().slice(0, 200) : '';
    if (!title || title.length > MAX_POST_TITLE) return res.status(400).json({ error: `Title is required (maximum ${MAX_POST_TITLE} characters)` });
    if (!summary || summary.length > 300) return res.status(400).json({ error: 'Summary is required (maximum 300 characters)' });
    if (!article || article.length > 6000) return res.status(400).json({ error: 'Article text is required (maximum 6,000 characters)' });
    if (typeof body.published !== 'boolean') return res.status(400).json({ error: 'Choose whether this story is a draft or published' });
    if (imageId && !db.prepare('SELECT id FROM website_media WHERE id=?').get(imageId)) {
      return res.status(400).json({ error: 'The selected photo does not exist' });
    }

    const isNew = !id;
    const postId = id || uuidv4();
    const existing = isNew ? null : getPost(db, id);
    if (!isNew && !existing) return res.status(404).json({ error: 'News story not found' });
    const publishedAt = body.published ? (existing && existing.published ? existing.published_at : new Date().toISOString()) : null;
    if (isNew) {
      db.prepare(`
        INSERT INTO website_posts (id, title, summary, body, image_id, image_alt, published, published_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(postId, title, summary, article, imageId, imageAlt, body.published ? 1 : 0, publishedAt);
    } else {
      db.prepare(`
        UPDATE website_posts SET title=?, summary=?, body=?, image_id=?, image_alt=?, published=?, published_at=?, updated_at=datetime('now')
        WHERE id=?
      `).run(title, summary, article, imageId, imageAlt, body.published ? 1 : 0, publishedAt, postId);
    }
    const post = getPost(db, postId);
    if (!post) return res.status(500).json({ error: 'Could not save the news story' });
    res.status(isNew ? 201 : 200).json({ post });
  }

  router.post('/posts', (req, res) => savePost(req, res, null));
  router.put('/posts/:id', (req, res) => savePost(req, res, req.params.id));
  router.delete('/posts/:id', (req, res) => {
    const result = db.prepare('DELETE FROM website_posts WHERE id=?').run(req.params.id);
    if (result.changes !== 1) return res.status(404).json({ error: 'News story not found' });
    res.json({ ok: true });
  });

  return router;
};
