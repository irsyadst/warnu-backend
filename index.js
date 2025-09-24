const express = require('express');
const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');
require('dotenv').config();

// --- FIREBASE ADMIN INITIALIZATION ---
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

// Endpoint to CREATE transaction and order
app.post('/create-transaction', async (req, res) => {
    try {
        const { orderId, totalAmount, items, customerDetails, userId, sellerId } = req.body;

        if (!orderId || !totalAmount || !items || !customerDetails || !userId || !sellerId) {
            return res.status(400).json({ error: 'Missing required fields in request body' });
        }
        
        const itemDetails = items.map(item => ({
            id: item.productId,
            price: item.price,
            quantity: item.quantity,
            name: item.name
        }));

        const parameter = {
            "transaction_details": { "order_id": orderId, "gross_amount": totalAmount },
            "item_details": itemDetails,
            "customer_details": customerDetails,
            // --- 💡 PERBAIKAN DITAMBAHKAN DI SINI ---
            "callbacks": {
                "finish": "https://warnu.app/finish" // URL redirect yang aman
            }
        };

        const transaction = await snap.createTransaction(parameter);

        // --- SAVE NEW ORDER TO FIRESTORE ---
        await db.collection('orders').doc(orderId).set({
            orderId: orderId,
            userId: userId,
            totalAmount: totalAmount,
            items: items,
            customerName: customerDetails.first_name,
            paymentStatus: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            sellerId: sellerId
        });
        // -----------------------------------------

        res.json({ token: transaction.token });

    } catch (e) {
        console.error('Error creating transaction:', e.message);
        res.status(500).json({ error: "Failed to create transaction. Check server logs." });
    }
});

// Endpoint to HANDLE notifications from Midtrans
app.post('/notification-handler', (req, res) => {
    snap.transaction.notification(req.body)
        .then(async (statusResponse) => {
            const orderId = statusResponse.order_id;
            const transactionStatus = statusResponse.transaction_status;
            const fraudStatus = statusResponse.fraud_status;

            console.log(`Notification received for Order ID ${orderId}: ${transactionStatus}`);

            // --- UPDATE ORDER STATUS IN FIRESTORE ---
            const orderRef = db.collection('orders').doc(orderId);
            let newStatus = 'pending';

            if (transactionStatus == 'capture') {
                if (fraudStatus == 'accept') {
                    newStatus = 'settlement';
                }
            } else if (transactionStatus == 'settlement') {
                newStatus = 'settlement';
            } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire') {
                newStatus = 'failed';
            }

            await orderRef.update({ paymentStatus: newStatus });
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