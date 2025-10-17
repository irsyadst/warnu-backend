const express = require('express');
const path = require('path');
const routes = require('./src/routes');
require('dotenv').config();

const app = express();

// Middleware untuk parsing JSON body
app.use(express.json());

// Middleware untuk menyajikan file statis dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Gunakan semua route API yang telah didefinisikan dengan prefix /api
app.use('/api', routes);

// Fallback untuk mengirim index.html jika tidak ada route API yang cocok.
// Sintaks '/*any' sudah kompatibel dengan Express v5.
app.get('/*any', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});