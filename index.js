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
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.PG_PORT || 5432,
  ssl: {
    rejectUnauthorized: false, // required for Render's PostgreSQL
  },
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
app.post('/signup', (req, res) => {
  const username = req.body.username;
  const email = req.body.email;
  const password = req.body.password;
  const confirmPassword = req.body['confirm-password'];

  if (password !== confirmPassword) {
    return res.send(`
      <html>
        <head>
          <script>
            alert("❌ Passwords do not match!");
            window.history.back();
          </script>
        </head>
        <body></body>
      </html>
    `);
  }

  const sql = 'INSERT INTO std_login (username, email, password) VALUES ($1, $2, $3)';
  const values = [username, email, password];

  pool.query(sql, values, (err, result) => {
    if (err) {
      console.error(err);
      return res.send(`
        <html>
          <head>
            <script>
              alert("❌ Error during registration. Try again.");
              window.history.back();
            </script>
          </head>
          <body></body>
        </html>
      `);
    }

    res.send(`
      <html>
        <head>
          <style>
            body {
              background-color: #f4f4f4;
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .popup {
              background-color: #fff;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.1);
              padding: 30px 40px;
              text-align: center;
              max-width: 400px;
              animation: fadeIn 0.3s ease-in-out;
            }
            .popup h2 {
              color: #28a745;
              font-size: 1.8em;
              margin-bottom: 10px;
            }
            .popup p {
              color: #555;
              font-size: 1em;
            }
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(-10px); }
              to { opacity: 1; transform: translateY(0); }
            }
          </style>
        </head>
        <body>
          <div class="popup">
            <h2>🎉 Registration Successful!</h2>
            <p>You will be redirected to the login page shortly...</p>
          </div>
          <script>
            setTimeout(() => {
              window.location.href = "/login.html";
            }, 3000);
          </script>
        </body>
      </html>
    `);
  });
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
