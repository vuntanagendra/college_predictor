const express = require('express');
const mysql = require('mysql');
const bodyParser = require('body-parser');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
const session = require('express-session');

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('templates')); // Serve static files from "templates" folder

app.use(session({
  secret: '@Giri', // use a strong secret in production
  resave: false,
  saveUninitialized: true
}));

// MySQL Connection (connect once)
const con = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "user"
});

con.connect(function (err) {
  if (err) throw err;
  console.log("Connected to MySQL database!");
});

// Routes

// Serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

// Handle login
app.post('/login', (req, res) => {
  const email = req.body.email;
  const password = req.body.password;

  const sql = "SELECT * FROM std_login WHERE email = ? AND password = ?";
  con.query(sql, [email, password], (err, results) => {
    if (err) throw err;

    if (results.length > 0) {
      req.session.user = { email }; // Store email in session
      res.redirect('/homepage.html');
    } else {
      res.send('Incorrect Email and/or Password!');
    }
  });
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
    return res.send('Passwords do not match!');
  }

  const sql = "INSERT INTO std_login (username, email, password) VALUES (?, ?, ?)";
  con.query(sql, [username, email, password], (err, result) => {
    if (err) throw err;
    res.send("User registered successfully with ID: " + result.insertId);
  });
});

// Serve dashboard
app.get('/homepage.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'homepage.html'));
});


const genAI = new GoogleGenerativeAI("_mNFaAEHQ0gnKkn8NJUuNi2g"); // Replace with actual API key


app.post('/evaluate', async (req, res) => {
  const streamScores = req.body.streamScores;
  console.log('streamScores :' ,streamScores);
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

    const sql = "SELECT name, location, category, logo_url FROM colleges WHERE category = ?";
    con.query(sql, [selectedStream], (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Database query failed" });
      }

      res.json({
        bestStream: selectedStream,
        explanation: text,
        colleges: results // Includes name, location, logo_url
 
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

  const sql = "SELECT username, email FROM std_login WHERE email = ?";
  con.query(sql, [userEmail], (err, results) => {
    if (err) return res.status(500).send("Server error.");
    if (results.length === 0) return res.status(404).send("User not found.");

    const user = results[0];
    res.json({
      name: user.username,
      email: user.email
    });
  });
});

// Start server
app.listen(3000, () => {
  console.log("Server is running on http://localhost:3000");
});
