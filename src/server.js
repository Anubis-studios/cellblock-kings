const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true }));

const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function startServer() {
  await client.connect();
  db = client.db('cellblock');
  
  await db.collection('users').createIndex({ tag: 1 }, { unique: true });
  console.log('✅ Connected to MongoDB Atlas');
  
  app.listen(process.env.PORT, () => console.log(`🔒 CELLBLOCK KINGS v2.0 running`));
}

const auth = async (req, res, next) => {
  if (req.session.userId) {
    req.user = await db.collection('users').findOne({ _id: new ObjectId(req.session.userId) });
    if (req.user) return next();
  }
  res.redirect('/login');
};

const isAdmin = (req, res, next) => {
  if (req.user && req.user.tag === process.env.ADMIN_TAG) return next();
  res.status(403).send('Admin access only.');
};

app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
  const { tag, pass } = req.body;
  const user = await db.collection('users').findOne({ tag });
  if (user && await bcrypt.compare(pass, user.pass)) {
    if (user.banned) return res.render('login', { error: 'You are BANNED.' });
    req.session.userId = user._id.toString();
    res.redirect('/home');
  } else res.render('login', { error: 'Invalid Tag/Passcode' });
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { tag, email, pass, confirm } = req.body;
  if (pass !== confirm) return res.render('register', { error: 'Passwords do not match' });
  try {
    const hash = await bcrypt.hash(pass, 10);
    const result = await db.collection('users').insertOne({
      tag, email, pass: hash,
      lvl: 1, hp: 200, max_hp: 200, en: 10, max_en: 10, nrv: 5, max_nrv: 5, stm: 100,
      str: 10, def: 10, spd: 10, exp: 0, cash: 1000, bank_balance: 0,
      online: true, banned: false, combo: '00000'
    });
    req.session.userId = result.insertedId.toString();
    res.redirect('/home');
  } catch(e) { res.render('register', { error: 'Tag already taken' }); }
});

app.get('/home', auth, async (req, res) => {
  const online = await db.collection('users').countDocuments({});
  res.render('home', { user: req.user, online });
});

app.post('/crime/:id', auth, async (req, res) => {
  const crimes = { 1: { cost: 1, min: 50, max: 150, exp: 15 }, 2: { cost: 2, min: 100, max: 300, exp: 30 } };
  const crime = crimes[req.params.id];
  if (!crime || req.user.nrv < crime.cost) return res.json({ msg: 'Not enough Nerve!' });
  
  if (Math.random() > 0.3) {
    const cash = Math.floor(Math.random() * (crime.max - crime.min + 1)) + crime.min;
    await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { cash, exp: crime.exp, nrv: -crime.cost } });
    res.json({ msg: `Success! +$${cash} +${crime.exp} EXP` });
  } else {
    await db.collection('users').updateOne({ _id: req.user._id }, { $inc: { nrv: -crime.cost } });
    res.json({ msg: 'Failed! Lost Nerve.' });
  }
});

app.get('/chat', auth, async (req, res) => {
  const messages = await db.collection('chat').find().sort({ time: -1 }).limit(50).toArray();
  res.render('chat', { user: req.user, messages: messages.reverse() });
});
app.post('/chat', auth, async (req, res) => {
  const { msg } = req.body;
  if (msg && msg.length < 200) {
    await db.collection('chat').insertOne({ tag: req.user.tag, msg, time: Date.now() });
  }
  res.redirect('/chat');
});

app.get('/leaderboard', auth, async (req, res) => {
  const top = await db.collection('users').find().sort({ exp: -1 }).limit(10).project({ tag: 1, lvl: 1, exp: 1 }).toArray();
  res.render('leaderboard', { user: req.user, top });
});

app.get('/admin', auth, isAdmin, async (req, res) => {
  const users = await db.collection('users').find().project({ tag: 1, lvl: 1, cash: 1, banned: 1 }).toArray();
  res.render('admin', { user: req.user, users });
});

app.get('/logout', async (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

startServer().catch(console.error);
