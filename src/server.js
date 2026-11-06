const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(session({ secret: process.env.SESSION_SECRET || 'secret', resave: false, saveUninitialized: true }));

const client = new MongoClient(process.env.MONGODB_URI);
let db;

// --- PREMIUM STORE DATA ---
const PREMIUM_ITEMS = [
  { id: 'favors_100', name: '100 Surgeon Favors', price: 499, amount: 100, type: 'favors' },
  { id: 'favors_500', name: '500 Surgeon Favors', price: 1999, amount: 500, type: 'favors' },
  { id: 'respected_30', name: 'Respected Status (30 Days)', price: 1200, amount: 30, type: 'vip_days' },
  { id: 'pack_gangster', name: 'Gangster Surgeon Pack', price: 999, amount: 1, type: 'pack', packId: 'gangster' },
  { id: 'pack_luchador', name: 'Luchador Surgeon Pack', price: 1499, amount: 1, type: 'pack', packId: 'luchador' }
];

async function startServer() {
  await client.connect();
  db = client.db('cellblock');
  await db.collection('users').createIndex({ tag: 1 }, { unique: true });
  console.log('✅ Connected to MongoDB & Stripe Ready');
  app.listen(process.env.PORT || 3000, () => console.log('🔒 CELLBLOCK KINGS running'));
}

const auth = async (req, res, next) => {
  if (req.session.userId) {
    req.user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) });
    if (req.user) return next();
  }
  res.redirect('/login');
};

// --- AUTH ROUTES ---
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { tag, pass } = req.body;
  const user = await db.collection('users').findOne({ tag });
  if (user && await bcrypt.compare(pass, user.pass)) {
    req.session.userId = user._id.toString();
    res.redirect('/rap-sheet');
  } else res.render('login', { error: 'Invalid credentials' });
});
app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { tag, email, pass, confirm } = req.body;
  if (pass !== confirm) return res.render('register', { error: 'Passwords mismatch' });
  try {
    const hash = await bcrypt.hash(pass, 10);
    const result = await db.collection('users').insertOne({
      tag, email, pass: hash, lvl: 1, hp: 200, max_hp: 200, en: 10, max_en: 10, nrv: 10, max_nrv: 10, stm: 100, max_stm: 100,
      str: 10, def: 10, spd: 10, exp: 0, cash: 500, prison: 'new_jersey',
      character: { baseHead: 'default', layers: {}, colors: {}, presets: [null,null,null,null], unlockedPackages: ['default'] },
      equipped_weapon: 'fists', equipped_gear: null, inventory_weapons: ['fists'], inventory_gear: [],
      favors: 0, vip_until: 0, created: Date.now(), last_seen: Date.now()
    });
    req.session.userId = result.insertedId.toString();
    res.redirect('/rap-sheet');
  } catch(e) { res.render('register', { error: 'Tag taken' }); }
});
app.get('/logout', async (req, res) => {
  if (req.session.userId) await db.collection('users').updateOne({ _id: new ObjectId(req.session.userId) }, { $set: { online: false } });
  req.session.destroy(() => res.redirect('/login'));
});

// --- DASHBOARD ---
app.get('/rap-sheet', auth, async (req, res) => {
  const news = await db.collection('news').find().sort({ date: -1 }).limit(5).toArray();
  res.render('rap-sheet', { user: req.user, news });
});

// ==========================================
// 🔪 SURGEON CHARACTER CUSTOMIZATION (FIXED)
// ==========================================
app.get('/surgeon', auth, async (req, res) => {
  const packages = await db.collection('surgeon_packages').find({}).toArray();
  const items = await db.collection('surgeon_items').find({}).toArray();
  const userPackages = req.user.character?.unlockedPackages || ['default'];
  
  res.render('surgeon', { 
    user: req.user, 
    packages, 
    items: JSON.stringify(items),
    character: req.user.character || {}
  });
});

app.get('/api/surgeon/items/:category', auth, async (req, res) => {
  const items = await db.collection('surgeon_items').find({ category: req.params.category }).toArray();
  res.json(items);
});

app.post('/api/surgeon/save', auth, async (req, res) => {
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { character: req.body.character } });
  res.json({ msg: 'Character saved!' });
});

app.post('/api/surgeon/save-preset', auth, async (req, res) => {
  const { slot, preset } = req.body;
  const presets = req.user.character?.presets || [null, null, null, null];
  presets[slot] = { ...preset, savedAt: Date.now() };
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { 'character.presets': presets } });
  res.json({ msg: `Preset ${slot + 1} saved!` });
});

app.post('/api/surgeon/load-preset', auth, async (req, res) => {
  const { slot } = req.body;
  const presets = req.user.character?.presets || [null, null, null, null];
  if (!presets[slot]) return res.status(404).json({ msg: 'Empty slot' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { character: presets[slot] } });
  res.json({ msg: 'Preset loaded!', character: presets[slot] });
});

app.post('/api/surgeon/buy-package', auth, async (req, res) => {
  const { packageId } = req.body;
  const pkg = await db.collection('surgeon_packages').findOne({ id: packageId });
  if (!pkg) return res.status(404).json({ msg: 'Package not found' });
  if (req.user.favors < pkg.cost) return res.status(400).json({ msg: 'Not enough Favors' });
  
  const unlocked = req.user.character?.unlockedPackages || ['default'];
  if (unlocked.includes(packageId)) return res.status(400).json({ msg: 'Already owned' });
  
  await db.collection('users').updateOne({ _id: req.user._id }, { 
    $inc: { favors: -pkg.cost },
    $push: { 'character.unlockedPackages': packageId }
  });
  res.json({ msg: `Purchased ${pkg.name}!` });
});

// ==========================================
// 💳 STRIPE PREMIUM PAYMENT SYSTEM
// ==========================================
app.get('/premium', auth, (req, res) => {
  res.render('premium', { user: req.user, items: PREMIUM_ITEMS });
});

app.post('/api/stripe/create-checkout', auth, async (req, res) => {
  const { itemId } = req.body;
  const item = PREMIUM_ITEMS.find(i => i.id === itemId);
  if (!item) return res.status(404).json({ msg: 'Item not found' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Cellblock Kings: ${item.name}`, images: ['https://cellblock-kings.onrender.com/logos/cellblock-kings-logo.svg'] },
          unit_amount: item.price, // Price in cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${req.headers.origin}/api/stripe/verify?session_id={CHECKOUT_SESSION_ID}&userId=${req.user._id.toString()}&itemId=${item.id}`,
      cancel_url: `${req.headers.origin}/premium`,
      metadata: { userId: req.user._id.toString(), itemId: item.id }
    });
    res.json({ id: session.id, url: session.url });
  } catch (error) {
    res.status(500).json({ msg: 'Stripe error: ' + error.message });
  }
});

app.get('/api/stripe/verify', auth, async (req, res) => {
  const { session_id, itemId } = req.query;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status === 'paid') {
      const item = PREMIUM_ITEMS.find(i => i.id === itemId);
      const update = {};
      
      if (item.type === 'favors') update.$inc = { favors: item.amount };
      if (item.type === 'vip_days') update.$set = { vip_until: Date.now() + (item.amount * 24 * 60 * 60 * 1000) };
      if (item.type === 'pack') update.$push = { 'character.unlockedPackages': item.packId };
      if (item.type === 'cash') update.$inc = { cash: item.amount };

      await db.collection('users').updateOne({ _id: req.user._id }, update);
      res.render('stripe-success', { user: req.user, item });
    } else {
      res.redirect('/premium?error=payment_failed');
    }
  } catch (error) {
    res.redirect('/premium?error=verification_failed');
  }
});

// --- BASIC PAGES ---
app.get('/shop', auth, async (req, res) => {
  const weapons = await db.collection('weapons').find({}).toArray();
  res.render('shop', { user: req.user, weapons });
});

app.get('/prison-transport', auth, async (req, res) => {
  const prisons = await db.collection('prisons').find({}).sort({ minLvl: 1 }).toArray();
  res.render('prison-transport', { user: req.user, prisons });
});

app.get('/npcs', auth, async (req, res) => {
  const npcs = await db.collection('prison_npcs').find({ prison: req.user.prison }).toArray();
  const weapons = await db.collection('weapons').find({}).toArray();
  res.render('npcs', { user: req.user, npcs, weapons });
});

app.get('/shoutbox', auth, async (req, res) => {
  const messages = await db.collection('shoutbox').find().sort({ time: -1 }).limit(50).toArray();
  res.render('shoutbox', { user: req.user, messages: messages.reverse() });
});
app.post('/shoutbox', auth, async (req, res) => {
  await db.collection('shoutbox').insertOne({ user: req.user.tag, msg: req.body.msg, time: Date.now() });
  res.redirect('/shoutbox');
});

startServer().catch(console.error);
