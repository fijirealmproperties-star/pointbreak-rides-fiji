const express = require('express');
const { DEFAULT_WEBSITE_CONTENT } = require('../website-content');

function readContent(db) {
  const row = db.prepare("SELECT value FROM website_settings WHERE key='content'").get();
  if (!row) return DEFAULT_WEBSITE_CONTENT;
  try {
    return { ...DEFAULT_WEBSITE_CONTENT, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_WEBSITE_CONTENT;
  }
}

module.exports = (db) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    const content = readContent(db);
    const posts = db.prepare(`
      SELECT id, title, summary, body, image_id, image_alt, published_at
      FROM website_posts WHERE published=1
      ORDER BY COALESCE(published_at, updated_at) DESC LIMIT 30
    `).all().map((post) => ({
      ...post,
      imageUrl: post.image_id ? `/api/website/media/${encodeURIComponent(post.image_id)}` : null,
    }));
    res.set('Cache-Control', 'no-store');
    res.json({
      content: {
        ...content,
        heroImageUrl: content.heroImageId
          ? `/api/website/media/${encodeURIComponent(content.heroImageId)}`
          : null,
        aboutImageUrl: content.aboutImageId
          ? `/api/website/media/${encodeURIComponent(content.aboutImageId)}`
          : null,
        theme: {
          ...content.theme,
          backgroundImageUrl: content.theme.backgroundImageId
            ? `/api/website/media/${encodeURIComponent(content.theme.backgroundImageId)}`
            : null,
        },
      },
      posts,
    });
  });

  router.get('/media/:id', (req, res) => {
    const media = db.prepare('SELECT id, mime, data FROM website_media WHERE id=?').get(req.params.id);
    if (!media) return res.status(404).json({ error: 'Photo not found' });
    const content = readContent(db);
    const publicUse = content.heroImageId === media.id ||
      content.aboutImageId === media.id ||
      content.theme.backgroundImageId === media.id ||
      !!db.prepare('SELECT id FROM website_posts WHERE image_id=? AND published=1 LIMIT 1').get(media.id);
    if (!publicUse) return res.status(404).json({ error: 'Photo not found' });
    res.set({
      'Content-Type': media.mime,
      'Content-Length': String(Buffer.from(media.data, 'base64').length),
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(Buffer.from(media.data, 'base64'));
  });

  return router;
};
