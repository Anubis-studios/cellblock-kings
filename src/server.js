const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./database');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true }));

const auth = (req, res, next) => {
  if (req.session.userId) {
    req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (req.user) return next();
  }
  res.redirect('/login');
};

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { tag, pass } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE tag = ?').get(tag);
  if (user && await bcrypt.compare(pass, user.pass)) {
    req.session.userId = user.id;
    db.prepare('UPDATE users SET online=1 WHERE id=?').run(user.id);
    res.redirect('/home');
  } else res.render('login', { error: 'Invalid Tag/Passcode' });
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const { tag, email, pass, confirm, gender, rules } = req.body;
  if (pass !== confirm || !rules) return res.render('register', { error: 'Mismatch or Rules not accepted' });
  if (pass.length < 6) return res.render('register', { error: 'Passcode must be 6+ chars' });
  try {
    const hash = await bcrypt.hash(pass, 10);
    const info = db.prepare('INSERT INTO users (tag, email, pass, gender) VALUES (?, ?, ?, ?)').run(tag, email, hash, gender);
    db.prepare('INSERT INTO cells (user_id, combo) VALUES (?, ?)').run(info.lastInsertRowid, '00000');
    req.session.userId = info.lastInsertRowid;
    res.redirect('/home');
  } catch(e) { res.render('register', { error: 'Tag already taken' }); }
});

app.get('/home', auth, (req, res) => {
  const online = db.prepare('SELECT COUNT(*) as c FROM users WHERE online=1').get().c;
  res.render('home', { user: req.user, online });
});

app.post('/crime/:id', auth, (req, res) => {
  const crime = db.prepare('SELECT * FROM crimes WHERE id=?').get(parseInt(req.params.id));
  if (!crime) return res.json({ msg: 'Crime not found' });
  if (req.user.nrv < crime.cost) return res.json({ msg: 'Not enough Nerve!' });
  
  const success = Math.random() > 0.3; 
  if (success) {
    const cash = Math.floor(Math.random() * (crime.reward_max - crime.reward_min + 1)) + crime.reward_min;
    const exp = Math.floor(Math.random() * (crime.exp_max - crime.exp_min + 1)) + crime.exp_min;
    db.prepare('UPDATE users SET cash=cash+?, exp=exp+?, nrv=nrv-? WHERE id=?').run(cash, exp, crime.cost, req.user.id);
    res.json({ msg: `✅ Success! +$${cash} +${exp} EXP` });
  } else {
    db.prepare('UPDATE users SET nrv=nrv-? WHERE id=?').run(crime.cost, req.user.id);
    res.json({ msg: '❌ Failed! Lost Nerve.' });
  }
});

app.get('/logout', (req, res) => {
  if (req.session.userId) db.prepare('UPDATE users SET online=0 WHERE id=?').run(req.session.userId);
  req.session.destroy(() => res.redirect('/login'));
});

db.ready.then(() => {
  app.listen(process.env.PORT, () => console.log(`🔒 CELLBLOCK KINGS running on http://localhost:${process.env.PORT}`));
});
