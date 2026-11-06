const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const fsx = require('fs');
require('dotenv').config();

let stripe = null;
try {
  const Stripe = require('stripe');
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_')) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  else console.warn('⚠️ STRIPE_SECRET_KEY missing - payments disabled until added.');
} catch (e) { console.warn('⚠️ Stripe not installed'); }

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(session({ secret: process.env.SESSION_SECRET || 'cellblock_secret', resave: false, saveUninitialized: true }));

const client = new MongoClient(process.env.MONGODB_URI);
let db;

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
  console.log('✅ MongoDB connected');
  app.listen(process.env.PORT || 3000, () => console.log('🔒 CELLBLOCK KINGS online'));
}

const auth = async (req, res, next) => {
  if (req.session.userId) {
    try { req.user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) }); } catch (e) {}
    if (req.user) return next();
  }
  res.redirect('/login');
};

const isAdmin = (req, res, next) => {
  if (req.user && (req.user.is_admin === true || req.user.tag === 'Anubis')) return next();
  res.status(403).send('Access Denied: Admin privileges required');
};

const safeRender = (req, res, view, data) => {
  const file = path.join(__dirname, '../views', view + '.ejs');
  if (!fsx.existsSync(file)) return res.render('placeholder', { user: req.user, page: view });
  res.render(view, data, (err, html) => {
    if (err) { console.error(err.message); return res.render('placeholder', { user: req.user, page: view }); }
    res.send(html);
  });
};

// ---------- AUTH ----------
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { tag, pass } = req.body;
  const user = await db.collection('users').findOne({ tag });
  if (user && await bcrypt.compare(pass, user.pass)) {
    req.session.userId = user._id.toString();
    return res.redirect('/rap-sheet');
  }
  res.render('login', { error: 'Invalid credentials' });
});
app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { tag, email, pass, confirm } = req.body;
  if (pass !== confirm) return res.render('register', { error: 'Passwords mismatch' });
  try {
    const hash = await bcrypt.hash(pass, 10);
    const r = await db.collection('users').insertOne({
      tag, email, pass: hash, lvl: 1, hp: 200, max_hp: 200, en: 10, max_en: 10, nrv: 10, max_nrv: 10, stm: 100, max_stm: 100,
      str: 10, def: 10, spd: 10, exp: 0, cash: 500, favors: 0, prison: 'new_jersey', is_admin: false,
      character: { baseHead: 'default', layers: {}, colors: {}, presets: [null, null, null, null], unlockedPackages: ['default'] },
      equipped_weapon: 'fists', equipped_gear: null, inventory_weapons: ['fists'], inventory_gear: [],
      unlocked_prisons: ['new_jersey'], vip_until: 0, created: Date.now(), last_seen: Date.now(), online: true
    });
    req.session.userId = r.insertedId.toString();
    res.redirect('/rap-sheet');
  } catch (e) { res.render('register', { error: 'Tag already taken' }); }
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ---------- CORE ----------
app.get('/rap-sheet', auth, async (req, res) => {
  const news = await db.collection('news').find().sort({ date: -1 }).limit(5).toArray();
  safeRender(req, res, 'rap-sheet', { user: req.user, news });
});

// ---------- SURGEON ----------
app.get('/surgeon', auth, async (req, res) => {
  const packages = await db.collection('surgeon_packages').find({}).toArray();
  const items = await db.collection('surgeon_items').find({}).toArray();
  res.render('surgeon', { user: req.user, packages, items: JSON.stringify(items), character: req.user.character || {} });
});
app.get('/api/surgeon/items/:category', auth, async (req, res) => {
  res.json(await db.collection('surgeon_items').find({ category: req.params.category }).toArray());
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
  res.json({ msg: `Preset ${parseInt(slot) + 1} saved!` });
});
app.post('/api/surgeon/load-preset', auth, async (req, res) => {
  const presets = req.user.character?.presets || [null, null, null, null];
  const p = presets[req.body.slot];
  if (!p) return res.status(404).json({ msg: 'Empty slot' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { character: p } });
  res.json({ msg: 'Preset loaded!', character: p });
});
app.post('/api/surgeon/buy-package', auth, async (req, res) => {
  const pkg = await db.collection('surgeon_packages').findOne({ id: req.body.packageId });
  if (!pkg) return res.status(404).json({ msg: 'Package not found' });
  if ((req.user.favors || 0) < pkg.cost) return res.status(400).json({ msg: 'Not enough Favors' });
  const unlocked = req.user.character?.unlockedPackages || ['default'];
  if (unlocked.includes(pkg.id)) return res.status(400).json({ msg: 'Already owned' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { favors: -pkg.cost }, $push: { 'character.unlockedPackages': pkg.id } });
  res.json({ msg: `Purchased ${pkg.name}!` });
});

// ---------- STRIPE ----------
app.get('/premium', auth, (req, res) => safeRender(req, res, 'premium', { user: req.user, items: PREMIUM_ITEMS, stripeEnabled: !!stripe }));
app.post('/api/stripe/create-checkout', auth, async (req, res) => {
  if (!stripe) return res.status(500).json({ msg: 'Stripe not configured on server.' });
  const item = PREMIUM_ITEMS.find(i => i.id === req.body.itemId);
  if (!item) return res.status(404).json({ msg: 'Item not found' });
  try {
    const s = await stripe.checkout.sessions.create({
      line_items: [{ price_data: { currency: 'usd', product_data: { name: `Cellblock Kings: ${item.name}` }, unit_amount: item.price }, quantity: 1 }],
      mode: 'payment',
      success_url: `${req.headers.origin}/api/stripe/verify?session_id={CHECKOUT_SESSION_ID}&itemId=${item.id}`,
      cancel_url: `${req.headers.origin}/premium`,
      metadata: { userId: req.user._id.toString(), itemId: item.id }
    });
    res.json({ url: s.url });
  } catch (e) { res.status(500).json({ msg: 'Stripe error: ' + e.message }); }
});
app.get('/api/stripe/verify', auth, async (req, res) => {
  if (!stripe) return res.redirect('/premium');
  try {
    const s = await stripe.checkout.sessions.retrieve(req.query.session_id);
    if (s.payment_status === 'paid') {
      const item = PREMIUM_ITEMS.find(i => i.id === req.query.itemId);
      const update = {};
      if (item.type === 'favors') update.$inc = { favors: item.amount };
      if (item.type === 'vip_days') update.$set = { vip_until: Date.now() + item.amount * 86400000 };
      if (item.type === 'pack') update.$push = { 'character.unlockedPackages': item.packId };
      await db.collection('users').updateOne({ _id: req.user._id }, update);
      await db.collection('transactions').insertOne({ user_id: req.user._id, type: 'stripe', amount: item.price / 100, description: item.name, date: Date.now() });
      return safeRender(req, res, 'stripe-success', { user: req.user, item });
    }
    res.redirect('/premium');
  } catch (e) { res.redirect('/premium'); }
});

// ---------- SHOP / COMBAT / PRISON ----------
app.get('/shop', auth, async (req, res) => safeRender(req, res, 'shop', { user: req.user, weapons: await db.collection('weapons').find({}).toArray() }));
app.post('/shop/buy/:id', auth, async (req, res) => {
  const w = await db.collection('weapons').findOne({ id: req.params.id });
  if (!w) return res.json({ msg: 'Not found', details: '' });
  if (req.user.cash < w.price) return res.json({ msg: 'Not enough cash', details: '' });
  const isGear = ['phone_book', 'leather_jacket', 'kevlar'].includes(w.id);
  const f = isGear ? 'inventory_gear' : 'inventory_weapons';
  if ((req.user[f] || []).includes(w.id)) return res.json({ msg: 'Already owned', details: '' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: -w.price }, $push: { [f]: w.id } });
  res.json({ msg: `Bought ${w.name}!`, details: '' });
});
app.post('/shop/equip/:id', auth, async (req, res) => {
  const w = await db.collection('weapons').findOne({ id: req.params.id });
  if (!w) return res.json({ msg: 'Not found', details: '' });
  const isGear = ['phone_book', 'leather_jacket', 'kevlar'].includes(w.id);
  const f = isGear ? 'inventory_gear' : 'inventory_weapons';
  const ef = isGear ? 'equipped_gear' : 'equipped_weapon';
  if (!(req.user[f] || []).includes(w.id)) return res.json({ msg: "You don't own this", details: '' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { [ef]: w.id } });
  res.json({ msg: `Equipped ${w.name}!`, details: '' });
});

app.get('/prison-transport', auth, async (req, res) => safeRender(req, res, 'prison-transport', { user: req.user, prisons: await db.collection('prisons').find({}).sort({ minLvl: 1 }).toArray() }));
app.post('/prison-transport/transfer', auth, async (req, res) => {
  const p = await db.collection('prisons').findOne({ id: req.body.prisonId });
  if (!p) return res.json({ msg: 'Prison not found' });
  if (req.user.lvl < p.minLvl) return res.json({ msg: `Need level ${p.minLvl}` });
  if (req.user.cash < p.cost) return res.json({ msg: `Need $${p.cost}` });
  const unlocked = req.user.unlocked_prisons || ['new_jersey'];
  if (!unlocked.includes(p.id)) unlocked.push(p.id);
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: { prison: p.id, unlocked_prisons: unlocked }, $inc: { cash: -p.cost } });
  res.json({ msg: `Transport approved! Welcome to ${p.name}.` });
});

app.get('/prison-jobs', auth, async (req, res) => safeRender(req, res, 'prison-jobs', { user: req.user, jobs: await db.collection('prison_jobs').find({ prison: req.user.prison }).toArray() }));
app.post('/prison-jobs/claim/:id', auth, async (req, res) => {
  const job = await db.collection('prison_jobs').findOne({ _id: new ObjectId(req.params.id) });
  if (!job) return res.json({ msg: 'Job not found' });
  if ((req.user[job.reqStat] || 0) < job.reqVal) return res.json({ msg: `Need ${job.reqVal} ${job.reqStat.toUpperCase()}` });
  if (req.user.en < job.energy) return res.json({ msg: 'Not enough energy' });
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash: job.pay, en: -job.energy, exp: Math.floor(job.pay / 10) }, $set: { job_name: job.name } });
  res.json({ msg: `Claimed ${job.name}! +$${job.pay}` });
});

app.get('/npcs', auth, async (req, res) => safeRender(req, res, 'npcs', { user: req.user, npcs: await db.collection('prison_npcs').find({ prison: req.user.prison }).toArray(), weapons: await db.collection('weapons').find({}).toArray() }));
app.post('/combat/attack/:id', auth, async (req, res) => {
  const npc = await db.collection('prison_npcs').findOne({ _id: new ObjectId(req.params.id) });
  if (!npc) return res.json({ msg: 'NPC not found', details: '' });
  if (req.user.en < 10) return res.json({ msg: 'Need 10 Energy to attack!', details: 'Rest or use an Energy Drink.' });
  const pw = await db.collection('weapons').findOne({ id: req.user.equipped_weapon || 'fists' });
  const pg = req.user.equipped_gear ? await db.collection('weapons').findOne({ id: req.user.equipped_gear }) : null;
  const nw = await db.collection('weapons').findOne({ id: npc.weapon || 'fists' });
  const ng = npc.gear ? await db.collection('weapons').findOne({ id: npc.gear }) : null;
  const pP = (req.user.str + (pw?.strBonus || 0)) * 1.5 + (req.user.spd + (pw?.spdBonus || 0) + (pg?.spdBonus || 0)) * 1.2 + (req.user.def + (pg?.defBonus || 0)) * 0.8;
  const nP = (npc.str + (nw?.strBonus || 0)) * 1.5 + (npc.spd + (nw?.spdBonus || 0) + (ng?.spdBonus || 0)) * 1.2 + (npc.def + (ng?.defBonus || 0)) * 0.8;
  const chance = pP / (pP + nP);
  await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { en: -10 } });
  if (Math.random() < chance) {
    const cash = Math.floor(npc.cash * (0.5 + Math.random() * 0.5));
    const exp = Math.floor(npc.lvl * 15);
    await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash, exp, battles_won: 1, total_battles: 1 } });
    res.json({ msg: `VICTORY! You defeated ${npc.tag}!`, details: `Stole $${cash} | +${exp} EXP | Win chance ${Math.round(chance * 100)}%` });
  } else {
    const hpLoss = Math.floor(20 + Math.random() * 30);
    await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { hp: -hpLoss, battles_lost: 1, total_battles: 1 }, $set: { hospitalized_until: Date.now() + 900000 } });
    res.json({ msg: `DEFEAT! ${npc.tag} beat you!`, details: `Lost ${hpLoss} HP | Med Bay 15 min | Win chance was ${Math.round(chance * 100)}%` });
  }
});

app.get('/shoutbox', auth, async (req, res) => {
  const m = await db.collection('shoutbox').find().sort({ time: -1 }).limit(50).toArray();
  safeRender(req, res, 'shoutbox', { user: req.user, messages: m.reverse() });
});
app.post('/shoutbox', auth, async (req, res) => {
  if (req.body.msg && req.body.msg.length < 200) await db.collection('shoutbox').insertOne({ user: req.user.tag, msg: req.body.msg, time: Date.now() });
  res.redirect('/shoutbox');
});

// ---------- ADMIN ----------
app.get('/admin', isAdmin, async (req, res) => {
  const allUsers = await db.collection('users').find({}).toArray();
  const stats = { totalUsers: allUsers.length, onlineUsers: allUsers.filter(u => u.online).length, totalCash: allUsers.reduce((s, u) => s + (u.cash || 0), 0) };
  safeRender(req, res, 'admin', { user: req.user, stats, allUsers });
});
app.post('/admin/grant-favors', isAdmin, async (req, res) => {
  await db.collection('users').updateOne({ _id: new ObjectId(req.body.userId) }, { $inc: { favors: parseInt(req.body.amount) } });
  res.json({ msg: 'Favors granted!' });
});
app.post('/admin/set-level', isAdmin, async (req, res) => {
  await db.collection('users').updateOne({ _id: new ObjectId(req.body.userId) }, { $set: { lvl: parseInt(req.body.level) } });
  res.json({ msg: 'Level set!' });
});
app.post('/admin/add-cash', isAdmin, async (req, res) => {
  await db.collection('users').updateOne({ _id: new ObjectId(req.body.userId) }, { $inc: { cash: parseInt(req.body.amount) } });
  res.json({ msg: 'Cash added!' });
});

// ---------- UNIVERSAL PAGE ROUTER (no more Cannot GET) ----------
const PAGES = {
  '/my-account': 'my-account', '/profile': 'profile', '/referrals': 'referrals', '/transactions': 'transactions', '/notes': 'notes',
  '/my-cell': 'my-cell', '/cell-raids': 'cell-raids', '/bank': 'bank', '/equipment': 'equipment', '/inventory': 'inventory',
  '/marketplace': 'marketplace', '/open-market': 'open-market', '/gym': 'gym', '/infirmary': 'infirmary', '/infirmary/icu': 'icu',
  '/infirmary/isolation': 'isolation', '/explore-prison': 'explore-prison', '/prison-yard': 'prison-yard', '/prison-hall': 'prison-hall',
  '/game-room': 'game-room', '/hitlist': 'hitlist', '/warden': 'warden', '/warden/redeem-favors': 'redeem-favors',
  '/warden/get-favors': 'get-favors', '/warden/earn-favors': 'earn-favors', '/warden/become-respected': 'become-respected',
  '/warden/buy-amenities': 'buy-amenities', '/most-wanted': 'most-wanted', '/lottery': 'lottery', '/tutorial': 'tutorial',
  '/voting': 'voting', '/mail': 'mail', '/battles': 'battles', '/spy-log': 'spy-log', '/friends': 'friends', '/enemies': 'enemies',
  '/rules': 'rules', '/inmates-online': 'inmates-online', '/missions': 'missions', '/gangs': 'gangs', '/gangs/invites': 'gang-invites',
  '/contact': 'contact', '/guide': 'guide', '/activity-log': 'activity-log', '/medbay': 'medbay', '/director': 'director',
  '/store': 'store', '/forums': 'forums'
};
for (const [route, view] of Object.entries(PAGES)) {
  app.get(route, auth, async (req, res) => {
    const data = { user: req.user };
    try {
      if (view === 'open-market') { data.listings = await db.collection('market_listings').find({ active: true }).toArray(); data.category = req.query.cat || 'items'; }
      if (view === 'bank') data.account = await db.collection('banks').findOne({ user_id: req.user._id });
      if (view === 'my-cell') { data.cellStats = { str: 0, def: 0, spd: 0, nrv: 0, energy: 0, stamina: 0 }; data.amenities = []; }
      if (view === 'hitlist') { data.hits = await db.collection('hitlist').find({ active: true }).toArray(); data.allInmates = await db.collection('users').find({}).project({ tag: 1, lvl: 1 }).toArray(); }
      if (view === 'most-wanted') data.wanted = await db.collection('users').find({}).sort({ lvl: -1 }).limit(50).toArray();
      if (view === 'inmates-online') data.inmates = await db.collection('users').find({ online: true }).toArray();
      if (view === 'gangs' || view === 'gang-invites') data.gangs = await db.collection('gangs').find({}).toArray();
      if (view === 'icu') data.patients = await db.collection('users').find({ hospitalized_until: { $gt: Date.now() } }).toArray();
      if (view === 'isolation') data.isolated = [];
      if (view === 'inventory') data.inv = await db.collection('inventory').find({ user_id: req.user._id }).toArray();
      if (view === 'transactions') data.transactions = await db.collection('transactions').find({ user_id: req.user._id }).sort({ date: -1 }).limit(50).toArray();
    } catch (e) {}
    safeRender(req, res, view, data);
  });
}

// Catch-all: never show "Cannot GET" again
app.use((req, res) => {
  if (req.session.userId) return res.redirect('/rap-sheet');
  res.redirect('/login');
});

startServer().catch(console.error);
