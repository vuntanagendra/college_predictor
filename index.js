const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

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
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASS,
  database: process.env.PG_NAME,
  port: process.env.PG_PORT || 5432,
});

pool.connect()
  .then(() => console.log("Connected to PostgreSQL database!"))
  .catch(err => console.error("Connection error:", err.stack));

// Routes

// Serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

// Handle login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT * FROM std_login WHERE email = $1 AND password = $2";
  try {
    const result = await pool.query(sql, [email, password]);

    if (result.rows.length > 0) {
      req.session.user = { email };
      res.redirect('/homepage.html');
    } else {
      res.send('Incorrect Email and/or Password!');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});

// Serve signup page
app.get('/signup.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'signup.html'));
});

// Handle signup
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  const confirmPassword = req.body['confirm-password'];

  if (password !== confirmPassword) {
    return res.send('Passwords do not match!');
  }

  const sql = "INSERT INTO std_login (username, email, password) VALUES ($1, $2, $3)";
  try {
    const result = await pool.query(sql, [username, email, password]);
    res.send("User registered successfully.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});

// Serve dashboard
app.get('/homepage.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'homepage.html'));
});

// Evaluate route using Gemini
app.post('/evaluate', async (req, res) => {
  const streamScores = req.body.streamScores;
  console.log('streamScores:', streamScores);
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
    const queryResult = await pool.query(sql, [selectedStream]);

    res.json({
      bestStream: selectedStream,
      explanation: text,
      colleges: queryResult.rows
    });

  } catch (err) {
    console.error("Gemini API error:", err);
    res.status(500).json({ error: "Gemini API failed" });
  }
});

// Profile
app.get('/profile', async (req, res) => {
  const userEmail = req.session.user?.email;

  if (!userEmail) {
    return res.status(401).send("Not logged in.");
  }

  const sql = "SELECT username, email FROM std_login WHERE email = $1";
  try {
    const result = await pool.query(sql, [userEmail]);

    if (result.rows.length === 0) return res.status(404).send("User not found.");

    const user = result.rows[0];
    res.json({
      name: user.username,
      email: user.email
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
});

// Start server
app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
