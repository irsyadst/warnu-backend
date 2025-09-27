const express = require('express');
const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');
require('dotenv').config();

admin.initializeApp();
const db = admin.firestore();

const app = express();
app.use(express.json());
const path = require('path');

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});

let snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY
});

// Endpoint to CREATE transaction and order
app.post('/create-transaction', async (req, res) => {
    try {
        const { orderId, totalAmount, items, customerDetails, userId, sellerId, address } = req.body;

        if (!orderId || !totalAmount || !items || !customerDetails || !userId || !sellerId || !address) {
            return res.status(400).json({ error: 'Missing required fields in request body' });
        }

        await db.runTransaction(async (t) => {
            for (const item of items) {
                const productRef = db.collection('products').doc(item.id);
                const productDoc = await t.get(productRef);

                if (!productDoc.exists) {
                    throw new Error(`Product with ID ${item.id} not found!`);
                }

                const currentStock = productDoc.data().stock;
                const newStock = currentStock - item.quantity;
                
                if (newStock < 0) {
                    throw new Error(`Not enough stock for product ${item.name}. Only ${currentStock} left.`);
                }

                t.update(productRef, { stock: newStock });
            }
        });
        console.log(`Stock successfully updated for Order ID: ${orderId}`);

        const parameter = {
            "transaction_details": { "order_id": orderId, "gross_amount": totalAmount },
            "item_details": items,
            "customer_details": customerDetails,
            "callbacks": {
                "finish": "https://warnu.app/finish"
            }
        };

        const transaction = await snap.createTransaction(parameter);

        await db.collection('orders').doc(orderId).set({
            orderId: orderId,
            userId: userId,
            totalAmount: totalAmount,
            items: items, 
            customerName: customerDetails.name,
            paymentStatus: 'Pending',
            orderStatus: 'Pending',
            address: address,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ token: transaction.token });

    } catch (e) {
        console.error('Error creating transaction:', e.message);
        if (e.message.includes("Not enough stock")) {
            return res.status(400).json({ error: e.message });
        }
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

            console.log(`Notification for Order ID ${orderId}: ${transactionStatus}`);

            const orderRef = db.collection('orders').doc(orderId);
            let newStatus = 'pending';

            if (transactionStatus == 'settlement' || (transactionStatus == 'capture' && fraudStatus == 'accept')) {
                newStatus = 'settlement';
            } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire') {
                newStatus = 'failed';
            }

            await orderRef.update({ paymentStatus: newStatus });
            res.status(200).send('OK');
        })
        .catch((e) => {
            console.error('Error processing notification:', e.message);
            res.status(500).send('Error');
        });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});