const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('templates'));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

// PostgreSQL Connection Pool
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect()
  .then(() => console.log("Connected to PostgreSQL database!"))
  .catch(err => console.error("Connection error", err.stack));

// Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Routes

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const sql = "SELECT * FROM std_login WHERE email = $1 AND password = $2";

  pool.query(sql, [email, password], (err, results) => {
    if (err) throw err;

    if (results.rows.length > 0) {
      req.session.user = { email };
      res.redirect('/homepage.html');
    } else {
      res.send('Incorrect Email and/or Password!');
    }
  });
});

app.get('/signup.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'signup.html'));
});

app.post('/signup', (req, res) => {
  const { username, email, password } = req.body;
  const confirmPassword = req.body['confirm-password'];

  if (password !== confirmPassword) {
    return res.send('Passwords do not match!');
  }

  const sql = "INSERT INTO std_login (username, email, password) VALUES ($1, $2, $3)";
  pool.query(sql, [username, email, password], (err, result) => {
    if (err) throw err;
    res.send("User registered successfully.");
  });
});

app.get('/homepage.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'homepage.html'));
});

app.post('/evaluate', async (req, res) => {
  const streamScores = req.body.streamScores;
  if (!streamScores) {
    return res.status(400).json({ error: "streamScores required" });
  }

  const streams = ["Engineering", "Medical", "Law", "Management", "Agriculture"];
  const prompt = `A student has the following scores: ${JSON.stringify(streamScores)}.
Based on these, suggest the best suited stream from: ${streams.join(", ")}. Provide only one stream name and a short reason.`;

  try {
    const model = genAI.getGenerativeModel({ model: "models/gemini-2.5-pro-exp-03-25" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const selectedStream = streams.find(stream =>
      text.toLowerCase().includes(stream.toLowerCase())
    );

    if (!selectedStream) {
      return res.status(500).json({ error: "Could not extract stream from Gemini output" });
    }

    const sql = "SELECT name, location, category, logo_url FROM colleges WHERE category = $1";
    pool.query(sql, [selectedStream], (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Database query failed" });
      }

      res.json({
        bestStream: selectedStream,
        explanation: text,
        colleges: results.rows
      });
    });

  } catch (err) {
    console.error("Gemini API error:", err);
    res.status(500).json({ error: "Gemini API failed" });
  }
});

app.get('/profile', (req, res) => {
  const userEmail = req.session.user?.email;

  if (!userEmail) {
    return res.status(401).send("Not logged in.");
  }

  const sql = "SELECT username, email FROM std_login WHERE email = $1";
  pool.query(sql, [userEmail], (err, results) => {
    if (err) return res.status(500).send("Server error.");
    if (results.rows.length === 0) return res.status(404).send("User not found.");

    const user = results.rows[0];
    res.json({
      name: user.username,
      email: user.email
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
