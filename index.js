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

// ENDPOINT BARU UNTUK MULTI-VENDOR CHECKOUT
app.post('/create-multivendor-transaction', async (req, res) => {
    try {
        const { allItems, customerDetails, userId, address } = req.body;

        if (!allItems || !customerDetails || !userId || !address || allItems.length === 0) {
            return res.status(400).json({ error: 'Missing required fields in request body' });
        }

        const parentOrderId = `WARNUPARENT-${Date.now()}`;
        const grandTotal = allItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        await db.runTransaction(async (t) => {
            const productRefs = allItems.map(item => db.collection('products').doc(item.id));
            const productDocs = await t.getAll(...productRefs);
            const updates = [];

            for (let i = 0; i < productDocs.length; i++) {
                const productDoc = productDocs[i];
                const item = allItems[i];
                if (!productDoc.exists) throw new Error(`Product with ID ${item.id} not found!`);
                
                const currentStock = productDoc.data().stock;
                const newStock = currentStock - item.quantity;
                if (newStock < 0) throw new Error(`Not enough stock for product ${item.name}.`);
                
                updates.push({ ref: productRefs[i], newStock: newStock });
            }

            for (const update of updates) {
                t.update(update.ref, { stock: update.newStock });
            }
        });

        const ordersBySeller = allItems.reduce((acc, item) => {
            const { sellerId } = item;
            if (!acc[sellerId]) acc[sellerId] = [];
            acc[sellerId].push(item);
            return acc;
        }, {});
        
        const batch = db.batch();
        for (const sellerId in ordersBySeller) {
            const sellerItems = ordersBySeller[sellerId];
            const sellerTotal = sellerItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const childOrderId = `WARNU-${sellerId.substring(0, 4)}-${Date.now()}`;

            const orderData = {
                orderId: childOrderId,
                parentOrderId: parentOrderId,
                userId: userId,
                totalAmount: sellerTotal,
                items: sellerItems,
                customerName: customerDetails.name,
                customerPhone: customerDetails.phone,
                paymentStatus: 'pending',
                orderStatus: 'pending',
                address: address,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                sellerId: sellerId,
                storeName: sellerItems[0].storeName
            };
            const orderRef = db.collection('orders').doc(childOrderId);
            batch.set(orderRef, orderData);
        }
        await batch.commit();

        // --- BAGIAN UTAMA YANG DIPERBAIKI ---
        const parameter = {
            "transaction_details": { "order_id": parentOrderId, "gross_amount": grandTotal },
            "item_details": allItems,
            "customer_details": {
                "name": customerDetails.name,
                "email": customerDetails.email,
                "phone": customerDetails.phone,
                "shipping_address": { // <-- TAMBAHKAN OBJEK INI
                    "name": customerDetails.name,
                    "phone": customerDetails.phone,
                    "address": address
                }
            },
            "callbacks": { "finish": "https://warnu.app/finish" }
        };
        // --- SELESAI PERBAIKAN ---

        const transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token });

    } catch (e) {
        console.error('Error creating multi-vendor transaction:', e.message);
        if (e.message.includes("Not enough stock")) {
            return res.status(400).json({ error: e.message });
        }
        res.status(500).json({ error: "Failed to create transaction." });
    }
});


// ... (sisa kode Anda, termasuk notification-handler dan app.listen)
app.post('/notification-handler', (req, res) => {
    snap.transaction.notification(req.body)
        .then(async (statusResponse) => {
            const orderId = statusResponse.order_id;
            const transactionStatus = statusResponse.transaction_status;
            const fraudStatus = statusResponse.fraud_status;

            console.log(`Notification for Order ID ${orderId}: ${transactionStatus}`);
            
            let newStatus = 'pending';
            if (transactionStatus == 'settlement' || (transactionStatus == 'capture' && fraudStatus == 'accept')) {
                newStatus = 'settlement';
            } else if (transactionStatus == 'cancel' || transactionStatus == 'deny' || transactionStatus == 'expire') {
                newStatus = 'failed';
                // TODO: Logika untuk mengembalikan stok jika pembayaran gagal
            }

            if (orderId.startsWith('WARNUPARENT-')) {
                const ordersQuery = db.collection('orders').where('parentOrderId', '==', orderId);
                const querySnapshot = await ordersQuery.get();

                if (!querySnapshot.empty) {
                    const batch = db.batch();
                    querySnapshot.forEach(doc => {
                        const orderRef = db.collection('orders').doc(doc.id);
                        batch.update(orderRef, { paymentStatus: newStatus });
                    });
                    await batch.commit();
                }
            } else {
                const orderRef = db.collection('orders').doc(orderId);
                await orderRef.update({ paymentStatus: newStatus });
            }
            
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