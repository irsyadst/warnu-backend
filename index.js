const express = require('express');
const path = require('path');
const routes = require('./src/routes');
require('dotenv').config();

const app = express();

// Middleware untuk parsing JSON body
app.use(express.json());

// Middleware untuk menyajikan file statis dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Gunakan semua route yang telah didefinisikan
app.use('/api', routes); // Menambahkan prefix /api untuk semua rute

// Fallback untuk mengirim index.html jika tidak ada route API yang cocok
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});