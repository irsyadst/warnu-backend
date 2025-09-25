const express = require('express');
const midtransClient = require('midtrans-client');
const admin = require('firebase-admin');
require('dotenv').config();

// --- FIREBASE ADMIN INITIALIZATION ---
// Otentikasi otomatis saat di Google Cloud
admin.initializeApp();
const db = admin.firestore();
// ------------------------------------

const app = express();
app.use(express.json());
const path = require('path');

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});

let snap = new midtransClient.Snap({
    // isProduction diambil dari environment variable
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY
});

// Endpoint to CREATE transaction and order
app.post('/create-transaction', async (req, res) => {
    try {
        // 'items' received from the app has objects with an 'id' field
        const { orderId, totalAmount, items, customerDetails, userId, sellerId } = req.body;

        if (!orderId || !totalAmount || !items || !customerDetails || !userId || !sellerId) {
            return res.status(400).json({ error: 'Missing required fields in request body' });
        }
        
        // Midtrans expects 'item_details' with an 'id' field, which is already correct.
        const parameter = {
            "transaction_details": { "order_id": orderId, "gross_amount": totalAmount },
            "item_details": items, // No mapping needed, 'items' from app is correct
            "customer_details": customerDetails,
            "callbacks": {
                "finish": "https://warnu.app/finish"
            }
        };

        const transaction = await snap.createTransaction(parameter);

        // Save the original 'items' array (with 'id' field) to Firestore
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

            console.log(`Notification for Order ID ${orderId}: ${transactionStatus}`);

            const orderRef = db.collection('orders').doc(orderId);
            let newStatus = 'pending';

            if (transactionStatus == 'settlement' || (transactionStatus == 'capture' && fraudStatus == 'accept')) {
                newStatus = 'settlement';
                
                try {
                    await db.runTransaction(async (t) => {
                        const orderDoc = await t.get(orderRef);
                        const items = orderDoc.data().items;

                        for (const item of items) {
                            // --- 💡 PERBAIKAN FINAL: Gunakan 'item.id' ---
                            // Path ke dokumen produk sekarang menggunakan 'id' yang benar dari array 'items'
                            const productRef = db.collection('products').doc(item.id);
                            const productDoc = await t.get(productRef);

                            if (!productDoc.exists) {
                                throw `Product with ID ${item.id} not found!`;
                            }

                            const currentStock = productDoc.data().stock;
                            const newStock = currentStock - item.quantity;
                            
                            if (newStock < 0) {
                                throw `Not enough stock for product ${item.name}.`;
                            }

                            t.update(productRef, { stock: newStock });
                        }
                    });
                    console.log(`Stock updated successfully for Order ID: ${orderId}`);
                } catch (error) {
                    console.error(`Failed to update stock for Order ID: ${orderId}`, error);
                }
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