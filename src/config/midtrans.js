const midtransClient = require('midtrans-client');
require('dotenv').config();

// Inisialisasi Midtrans Snap client
const snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY
});

module.exports = snap;