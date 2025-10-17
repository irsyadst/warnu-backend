const express = require('express');
const path = require('path');
// const routes = require('./src/routes'); // <-- Sementara nonaktifkan baris ini
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// app.use('/api', routes); // <-- Sementara nonaktifkan baris ini

app.get('/*any', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
