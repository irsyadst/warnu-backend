const transactionService = require('../services/transactionService');

const createMultivendorTransaction = async (req, res) => {
    try {
        const { allItems, customerDetails } = req.body;
        const { userId, address } = customerDetails || {};

        if (!allItems || !customerDetails || !userId || !address || allItems.length === 0) {
            return res.status(400).json({ error: 'Missing required fields in request body' });
        }

        const token = await transactionService.createTransaction(allItems, customerDetails);
        res.json({ token });

    } catch (e) {
        console.error('Error in createMultivendorTransaction controller:', e.message);
        if (e.message.includes("Stok") || e.message.includes("Produk")) {
            return res.status(400).json({ error: e.message });
        }
        res.status(500).json({ error: "Failed to create transaction." });
    }
};

const notificationHandler = async (req, res) => {
    try {
        console.log('Received Midtrans notification:', req.body);
        await transactionService.handleNotification(req.body);
        res.status(200).send('OK');
    } catch (e) {
        console.error('Error processing notification:', e.message);
        res.status(500).send('Error processing notification.');
    }
};

module.exports = {
    createMultivendorTransaction,
    notificationHandler
};