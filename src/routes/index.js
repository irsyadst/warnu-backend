const express = require('express');
const transactionController = require('../controllers/transactionController');
const router = express.Router();

// Route untuk halaman utama (opsional)
router.get('/', (req, res) => {
    // Mengirim response JSON sederhana, karena file statis sudah di-handle oleh express.static
    res.json({ message: 'Welcome to Warnu Backend API' });
});

// Route untuk transaksi
router.post('/create-multivendor-transaction', transactionController.createMultivendorTransaction);
router.post('/notification-handler', transactionController.notificationHandler);

module.exports = router;