const express = require('express');
const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');
require('dotenv').config();

// --- INISIALISASI FIREBASE ADMIN ---
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
// ------------------------------------

const app = express();
app.use(express.json());

let snap = new midtransClient.Snap({
    isProduction: false,
    serverKey: process.env.MIDTRANS_SERVER_KEY 
});

// Endpoint untuk MEMBUAT transaksi dan pesanan
app.post('/create-transaction', async (req, res) => {
    try {
        const { orderId, totalAmount, items, customerDetails, userId } = req.body;

        const parameter = {
            "transaction_details": { "order_id": orderId, "gross_amount": totalAmount },
            "item_details": items,
            "customer_details": customerDetails
        };

        const transaction = await snap.createTransaction(parameter);

        // --- SIMPAN PESANAN BARU KE FIRESTORE ---
        await db.collection('orders').doc(orderId).set({
            orderId: orderId,
            userId: userId, // Simpan ID pengguna
            totalAmount: totalAmount,
            items: items,

            customerName: customerDetails.first_name,
            paymentStatus: 'pending', // Status awal
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        // -----------------------------------------

        res.json({ token: transaction.token });

    } catch (e) {
        console.error('Error creating transaction:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Endpoint untuk MENANGANI notifikasi dari Midtrans
app.post('/notification-handler', (req, res) => {
    snap.transaction.notification(req.body)
        .then(async (statusResponse) => {
            const orderId = statusResponse.order_id;
            const transactionStatus = statusResponse.transaction_status;

            console.log(`Notifikasi diterima untuk Order ID ${orderId}: ${transactionStatus}`);

            // --- UPDATE STATUS PESANAN DI FIRESTORE ---
            const orderRef = db.collection('orders').doc(orderId);

            if (transactionStatus == 'settlement') {
                await orderRef.update({ paymentStatus: 'settlement' });
            } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire') {
                await orderRef.update({ paymentStatus: 'failed' });
            }
            // ------------------------------------------

            res.status(200).send('OK');
        })
        .catch((e) => {
            console.error('Error processing notification:', e.message);
            res.status(500).send('Error');
        });
});

const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});